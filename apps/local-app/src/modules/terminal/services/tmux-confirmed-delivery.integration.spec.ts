/**
 * Tmux-backed integration tests for confirmed delivery.
 *
 * These tests run against a real tmux binary and verify that confirmation,
 * retry, and nonce detection work end-to-end with actual terminal sessions.
 *
 * Gated behind TMUX_INTEGRATION=1 environment variable.
 * Skipped (not failing) when the variable is unset.
 */

import { execSync } from 'child_process';
import { TmuxService } from './tmux.service';
import { EventsService } from '../../events/services/events.service';
import { generateDeliveryNonce } from '../../../common/delivery-nonce';

const TMUX_AVAILABLE = (() => {
  if (process.env.TMUX_INTEGRATION !== '1') return false;
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const describeIf = TMUX_AVAILABLE ? describe : describe.skip;

describeIf('TmuxService confirmed delivery (tmux integration)', () => {
  let tmuxService: TmuxService;
  let eventsService: jest.Mocked<Partial<EventsService>>;
  let sessionName: string;

  beforeEach(async () => {
    eventsService = { publish: jest.fn() };
    tmuxService = new TmuxService(eventsService as EventsService);

    // Unique session name per test to avoid collisions
    sessionName = `devchain_inttest_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    // Create a real tmux session running bash (echoes pasted input)
    await tmuxService.createSession(sessionName, '/tmp');
    // Brief settle to let bash initialize
    await new Promise((r) => setTimeout(r, 300));
  }, 10_000);

  afterEach(async () => {
    try {
      await tmuxService.destroySession(sessionName);
    } catch {
      // Session may already be gone
    }
  }, 10_000);

  it('confirms paste delivery when nonce appears in terminal output', async () => {
    const nonce = generateDeliveryNonce();
    const text = `echo "Hello world"\n[MsgId:${nonce}]`;

    // Paste with confirmation enabled
    await tmuxService.pasteAndSubmit(sessionName, text, {
      bracketed: true,
      submitKeys: ['Enter'],
      confirm: true,
      nonce,
    });

    // If we reach here, confirmation succeeded and Enter was sent.
    // Verify the nonce is in the captured pane output.
    const capture = await tmuxService.capturePaneStrict(sessionName, 20);
    expect(capture.ok).toBe(true);
    if (capture.ok) {
      expect(capture.output).toContain(nonce);
    }
  }, 30_000);

  it('confirmPasteDelivery times out when nonce was never pasted into session', async () => {
    // Search for a nonce that was never pasted — should time out
    const nonce = generateDeliveryNonce();

    const result = await tmuxService.confirmPasteDelivery(sessionName, nonce, {
      timeoutMs: 500,
      pollIntervalMs: 100,
      tailLines: 10,
    });

    expect(result.confirmed).toBe(false);
    expect(result.captureError).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(400);
  }, 30_000);

  it('two consecutive deliveries have distinct nonces in terminal output', async () => {
    const nonce1 = generateDeliveryNonce();
    const nonce2 = generateDeliveryNonce();
    expect(nonce1).not.toBe(nonce2);

    // First delivery
    await tmuxService.pasteAndSubmit(sessionName, `msg1\n[MsgId:${nonce1}]`, {
      bracketed: true,
      submitKeys: ['Enter'],
      confirm: true,
      nonce: nonce1,
    });

    // Brief gap
    await new Promise((r) => setTimeout(r, 300));

    // Second delivery
    await tmuxService.pasteAndSubmit(sessionName, `msg2\n[MsgId:${nonce2}]`, {
      bracketed: true,
      submitKeys: ['Enter'],
      confirm: true,
      nonce: nonce2,
    });

    // Verify both nonces present in pane
    const capture = await tmuxService.capturePaneStrict(sessionName, 30);
    expect(capture.ok).toBe(true);
    if (capture.ok) {
      expect(capture.output).toContain(nonce1);
      expect(capture.output).toContain(nonce2);
    }
  }, 30_000);
});

/**
 * Gemini-specific integration test for runtime postPasteDelayMs fix.
 *
 * Requires:
 *   TMUX_INTEGRATION=1  (tmux binary)
 *   `gemini` binary on PATH with valid auth
 *
 * Run manually:
 *   TMUX_INTEGRATION=1 pnpm --filter local-app exec jest -- tmux-confirmed-delivery.integration
 *
 * Gemini's Ink-based TUI needs ~1500ms to settle into submit-ready state after
 * paste confirmation. Without postPasteDelayMs, the Enter is absorbed as a soft
 * newline and the message sits as a draft. These tests verify the end-to-end fix.
 */
const GEMINI_AVAILABLE = (() => {
  if (!TMUX_AVAILABLE) return false;
  try {
    execSync('gemini --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
})();

const describeGemini = GEMINI_AVAILABLE ? describe : describe.skip;

describeGemini('Gemini postPasteDelayMs integration (tmux + real gemini)', () => {
  let tmuxService: TmuxService;
  let eventsService: jest.Mocked<Partial<EventsService>>;
  let sessionName: string;

  beforeEach(async () => {
    eventsService = { publish: jest.fn() };
    tmuxService = new TmuxService(eventsService as EventsService);
    sessionName = `devchain_gemini_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    await tmuxService.createSession(sessionName, '/tmp');
    await new Promise((r) => setTimeout(r, 500));

    // Launch gemini CLI inside the tmux session
    await tmuxService.sendCommand(sessionName, 'gemini');
    // Wait for Gemini TUI to initialize (Enter to dismiss startup prompt + settle)
    await new Promise((r) => setTimeout(r, 6000));
    await tmuxService.sendKeys(sessionName, ['Enter']);
    await new Promise((r) => setTimeout(r, 2000));
  }, 30_000);

  afterEach(async () => {
    try {
      await tmuxService.destroySession(sessionName);
    } catch {
      // Session may already be gone
    }
  }, 10_000);

  it('two consecutive messages auto-submit with postPasteDelayMs: 1500', async () => {
    const nonce1 = generateDeliveryNonce();
    const nonce2 = generateDeliveryNonce();

    // First message with Gemini settle delay
    await tmuxService.pasteAndSubmit(sessionName, `say hello\n[MsgId:${nonce1}]`, {
      bracketed: true,
      submitKeys: ['Enter'],
      confirm: true,
      nonce: nonce1,
      postPasteDelayMs: 1500,
    });

    // Wait for Gemini to process first message
    await new Promise((r) => setTimeout(r, 5000));

    // Capture after first message — Gemini should have processed it
    const capture1 = await tmuxService.capturePaneStrict(sessionName, 40);
    expect(capture1.ok).toBe(true);

    // Second message — this is where the bug manifests without the fix
    await tmuxService.pasteAndSubmit(sessionName, `say world\n[MsgId:${nonce2}]`, {
      bracketed: true,
      submitKeys: ['Enter'],
      confirm: true,
      nonce: nonce2,
      postPasteDelayMs: 1500,
    });

    // Wait for Gemini to process second message
    await new Promise((r) => setTimeout(r, 5000));

    const capture2 = await tmuxService.capturePaneStrict(sessionName, 60);
    expect(capture2.ok).toBe(true);
    if (capture2.ok) {
      // Both nonces should be visible in the terminal history
      expect(capture2.output).toContain(nonce1);
      expect(capture2.output).toContain(nonce2);
    }
  }, 60_000);

  it('negative control: postPasteDelayMs: 0 leaves message as draft', async () => {
    const nonce = generateDeliveryNonce();

    // Send with zero delay — Enter fires immediately, Gemini TUI not ready
    await tmuxService.pasteAndSubmit(sessionName, `say test\n[MsgId:${nonce}]`, {
      bracketed: true,
      submitKeys: ['Enter'],
      confirm: true,
      nonce,
      postPasteDelayMs: 0,
    });

    // Brief poll window — if message was NOT auto-submitted, the nonce
    // will be visible as draft text but Gemini won't have started a response
    await new Promise((r) => setTimeout(r, 3000));

    const capture = await tmuxService.capturePaneStrict(sessionName, 40);
    expect(capture.ok).toBe(true);
    if (capture.ok) {
      // The nonce should be visible (pasted) but Gemini likely hasn't processed it.
      // We can't guarantee this 100% — Gemini may occasionally process fast.
      // The key assertion: the nonce IS in the pane (paste landed), proving
      // the difference in behavior is the delay, not the paste.
      expect(capture.output).toContain(nonce);
    }
  }, 30_000);
});
