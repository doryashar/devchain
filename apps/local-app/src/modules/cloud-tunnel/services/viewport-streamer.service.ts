import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  TUNNEL_VIEWPORT_FRAME_TYPE,
  TUNNEL_VIEWPORT_FRAME_VERSION,
  type TunnelViewportFrame,
  type ViewportBody,
  type ViewportScreen,
} from '@devchain/shared';
import { ActiveSessionLookup } from '../../sessions/services/active-session-lookup.service';
import { TerminalViewportFacade } from '../../terminal/services/terminal-viewport/terminal-viewport.facade';
import { AppError, ForbiddenError, NotFoundError } from '../../../common/errors/error-types';
import { createLogger } from '../../../common/logging/logger';
import { ViewportFrameSink } from './viewport-frame-sink';
import { TunnelViewportCryptoService } from './tunnel-viewport-crypto.service';

const logger = createLogger('ViewportStreamer');

/**
 * Output-gated capture cadence: a re-capture is scheduled only when NEW PTY bytes arrived,
 * and never more often than this interval — a ~2-3 fps ceiling that bounds tmux/CPU cost.
 */
const MIN_CAPTURE_INTERVAL_MS = 350;

interface ViewportSubscription {
  readonly subscriptionId: string;
  readonly sessionId: string;
  /** Per-subscription monotonic counter, assigned to each frame actually SENT. */
  seq: number;
  /** Last screen the bridge received (diff baseline); `null` ⇒ next send is a full. */
  lastScreen: ViewportScreen | null;
  /** Detach the output-gated PTY `data` listener. Read-only — never tears down the PTY. */
  detachData: () => void;
  disposed: boolean;
  // Throttle state (output-gated + coalescing).
  dirty: boolean;
  capturing: boolean;
  lastCaptureAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Server half of the live viewport (MobileLiveViewport, Task 4). Owns the per-subscription
 * lifecycle for `terminal.viewport.subscribe`/`unsubscribe`:
 *
 * - Source-side ownership check (`{sessionId, projectId}` via `ActiveSessionLookup`) BEFORE
 *   any streaming — a cross-project sessionId is rejected, never streamed.
 * - Output-gated capture: re-captures only when new PTY bytes arrived, throttled to a
 *   ~2-3 fps ceiling with per-subscription coalescing.
 * - Full screen on subscribe and on tunnel reconnect; line-diffs in steady state (no diff
 *   replay buffer — a full always re-anchors).
 * - Emits `type:'viewport'` tunnel frames; the PTY is a read-only consumer and is never
 *   torn down here.
 */
@Injectable()
export class ViewportStreamerService implements OnModuleInit, OnModuleDestroy {
  private readonly subscriptions = new Map<string, ViewportSubscription>();
  private subscriptionSeq = 0;
  private detachReadyListener: (() => void) | null = null;

  constructor(
    private readonly activeSessions: ActiveSessionLookup,
    private readonly terminalViewport: TerminalViewportFacade,
    // The ViewportFrameSink ABSTRACTION (not the concrete TunnelClientService) — the import
    // graph stays acyclic (streamer → port leaf, no edge back to TunnelClient). The provider
    // binds this token to the tunnel client via a ModuleRef-lazy factory, so there is no
    // construction-time DI cycle either (see cloud-tunnel.module.ts).
    @Inject(ViewportFrameSink) private readonly sink: ViewportFrameSink,
    // Viewport E2EE seam (Phase 4): decides plaintext/encrypted/blocked and seals the screen.
    private readonly viewportCrypto: TunnelViewportCryptoService,
  ) {}

  onModuleInit(): void {
    // On every (re)connect, re-anchor each live subscription with a fresh full screen so
    // the bridge's latest-only buffer is re-primed (full-on-reconnect, no replay).
    this.detachReadyListener = this.sink.onPushReady(() => this.reanchorAll());
  }

  /**
   * `terminal.viewport.subscribe({ sessionId, projectId, cols?, rows? })` — validate
   * ownership, start streaming, and return the server-assigned `subscriptionId`. `cols`/
   * `rows` are accepted for forward-compat but ignored in v1 (single shared tmux pane, no
   * mobile resize). Emits the initial FULL screen before resolving.
   */
  async subscribe(params: Record<string, unknown>): Promise<{ subscriptionId: string }> {
    const sessionId = params['sessionId'] as string;
    const projectId = params['projectId'] as string;

    // SOURCE-SIDE auth: the session must belong to the requested project BEFORE streaming.
    await this.assertSessionInProject(sessionId, projectId);

    if (!this.terminalViewport.hasSession(sessionId)) {
      throw new AppError(
        'No running terminal session for this session id. Launch/restore it first.',
        'SESSION_NOT_RUNNING',
        409,
        { sessionId, projectId },
      );
    }

    const subscriptionId = `vp-${++this.subscriptionSeq}`;
    const sub: ViewportSubscription = {
      subscriptionId,
      sessionId,
      seq: 0,
      lastScreen: null,
      detachData: () => {},
      disposed: false,
      dirty: false,
      capturing: false,
      lastCaptureAt: 0,
      timer: null,
    };
    this.subscriptions.set(subscriptionId, sub);

    // Output-gated trigger: each `data` frame marks the subscription dirty + schedules a
    // throttled capture. Registering the listener never affects the PTY lifecycle.
    sub.detachData = this.terminalViewport.onData(sessionId, () => this.markDirty(sub));

    // Initial full screen (lastScreen === null ⇒ full).
    await this.captureAndSend(sub);

    return { subscriptionId };
  }

  /** `terminal.viewport.unsubscribe({ subscriptionId })` — stop streaming; PTY survives. */
  unsubscribe(params: Record<string, unknown>): { ok: boolean } {
    const subscriptionId = params['subscriptionId'] as string;
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return { ok: false };
    this.teardown(sub);
    return { ok: true };
  }

  onModuleDestroy(): void {
    this.detachReadyListener?.();
    this.detachReadyListener = null;
    for (const sub of [...this.subscriptions.values()]) {
      this.teardown(sub);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private markDirty(sub: ViewportSubscription): void {
    if (sub.disposed) return;
    sub.dirty = true;
    this.scheduleCapture(sub);
  }

  /** Schedule a throttled capture, coalescing bursts and honoring the fps ceiling. */
  private scheduleCapture(sub: ViewportSubscription): void {
    if (sub.disposed || sub.timer || sub.capturing) return;
    const elapsed = Date.now() - sub.lastCaptureAt;
    const delay = Math.max(0, MIN_CAPTURE_INTERVAL_MS - elapsed);
    sub.timer = setTimeout(() => {
      sub.timer = null;
      void this.runScheduledCapture(sub);
    }, delay);
    if (typeof sub.timer.unref === 'function') sub.timer.unref();
  }

  private async runScheduledCapture(sub: ViewportSubscription): Promise<void> {
    if (sub.disposed) return;
    sub.capturing = true;
    sub.dirty = false;
    try {
      await this.captureAndSend(sub);
    } finally {
      sub.capturing = false;
    }
    // New bytes arrived mid-capture → coalesce into one more scheduled tick.
    if (!sub.disposed && sub.dirty) this.scheduleCapture(sub);
  }

  /** Capture the visible screen and send a full or diff frame (skips if nothing changed). */
  private async captureAndSend(sub: ViewportSubscription): Promise<void> {
    if (sub.disposed) return;
    sub.lastCaptureAt = Date.now();

    const capture = await this.terminalViewport.capture(sub.sessionId);
    if (sub.disposed) return;

    if (!capture) {
      // Session gone for good → stop. Transient capture failure with a live session →
      // skip this tick and wait for the next data-gated trigger.
      if (!this.terminalViewport.hasSession(sub.sessionId)) {
        logger.debug({ sessionId: sub.sessionId }, 'Viewport session ended; tearing down');
        this.teardown(sub);
      }
      return;
    }

    const screen: ViewportScreen = {
      lines: capture.lines,
      cursor: capture.cursor,
      cols: capture.cols,
      rows: capture.rows,
    };

    // Decide how this frame may travel to the paired mobile. The terminal screen can carry
    // secrets, so it is sealed when the lane is E2EE-capable; otherwise it rides plaintext
    // (back-compat), or is withheld entirely when E2EE is required but the peer is incapable.
    const channel = await this.viewportCrypto.resolveViewportChannel(this.sink.getInstanceId());
    if (sub.disposed) return;

    let body: ViewportBody | null;
    if (channel.mode === 'blocked') {
      // E2EE required + incapable peer → never stream plaintext terminal content.
      return;
    } else if (channel.mode === 'encrypted') {
      // v1 encrypted viewport is FULL-FRAME-ONLY: emit a fresh sealed full whenever the screen
      // changed vs the baseline (reuse the diff change-detector purely as a "did it change?"
      // check; the diff body itself is discarded). The bridge buffers the latest opaque full.
      if (sub.lastScreen && diffScreens(sub.lastScreen, screen) === null) return;
      const enc = await channel.sealScreen!(sub.sessionId, sub.seq, screen);
      if (sub.disposed) return;
      body = { kind: 'enc-full', enc };
    } else {
      // plaintext (back-compat for non-paired clients): the existing full/diff frames.
      body = sub.lastScreen ? diffScreens(sub.lastScreen, screen) : fullBody(screen);
    }
    if (!body) return; // nothing changed — no frame, no seq bump

    const frame: TunnelViewportFrame = {
      type: TUNNEL_VIEWPORT_FRAME_TYPE,
      v: TUNNEL_VIEWPORT_FRAME_VERSION,
      subscriptionId: sub.subscriptionId,
      sessionId: sub.sessionId,
      seq: sub.seq,
      body,
    };

    if (this.sink.sendViewport(frame)) {
      // Advance the baseline + monotonic seq only for frames the bridge actually received,
      // so seq stays gap-free across sent frames and a dropped tunnel re-anchors with a full.
      sub.seq += 1;
      sub.lastScreen = screen;
    }
  }

  /** Re-anchor every live subscription with a fresh full screen (called on tunnel ready). */
  private reanchorAll(): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.disposed) continue;
      sub.lastScreen = null; // force a full on the next capture
      this.scheduleCapture(sub);
    }
  }

  private teardown(sub: ViewportSubscription): void {
    if (sub.disposed) return;
    sub.disposed = true;
    if (sub.timer) {
      clearTimeout(sub.timer);
      sub.timer = null;
    }
    sub.detachData();
    this.subscriptions.delete(sub.subscriptionId);
  }

  /**
   * Enforce `session → agent → project` ownership before streaming. Mirrors
   * `MobileChatRpcService.assertSessionInProject`: unknown → NotFoundError, cross-project →
   * ForbiddenError (`SESSION_PROJECT_MISMATCH`).
   */
  private async assertSessionInProject(sessionId: string, projectId: string): Promise<void> {
    const scope = await this.activeSessions.getSessionProjectScope(sessionId);
    if (!scope) {
      throw new NotFoundError('Session', sessionId);
    }
    if (scope.projectId !== projectId) {
      throw new ForbiddenError('Session does not belong to the requested project', {
        code: 'SESSION_PROJECT_MISMATCH',
        sessionId,
        projectId,
      });
    }
  }
}

/** Build a full-screen recovery anchor body. */
function fullBody(screen: ViewportScreen): ViewportBody {
  return { kind: 'full', screen };
}

/**
 * Diff two screens row-by-row. Returns `null` when nothing changed, a `full` re-anchor when
 * geometry changed (no resize semantics in v1 — re-anchor is the safe path), or a `diff`
 * carrying only the changed rows (+ cursor when it moved).
 */
function diffScreens(last: ViewportScreen, next: ViewportScreen): ViewportBody | null {
  if (
    last.cols !== next.cols ||
    last.rows !== next.rows ||
    last.lines.length !== next.lines.length
  ) {
    return fullBody(next);
  }

  const changedLines: Array<{ row: number; text: string }> = [];
  for (let row = 0; row < next.lines.length; row++) {
    if (next.lines[row] !== last.lines[row]) {
      changedLines.push({ row, text: next.lines[row] });
    }
  }

  const cursorMoved = last.cursor.x !== next.cursor.x || last.cursor.y !== next.cursor.y;
  if (changedLines.length === 0 && !cursorMoved) return null;

  return cursorMoved
    ? { kind: 'diff', changedLines, cursor: next.cursor }
    : { kind: 'diff', changedLines };
}
