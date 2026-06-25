import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import type {
  SessionReaderAdapter,
  SessionSourceRef,
} from '../adapters/session-reader-adapter.interface';
import type { UnifiedSession, UnifiedMetrics, UnifiedMessage } from '../dtos/unified-session.types';
import { estimateVisibleFromMessages } from '../adapters/utils/estimate-content-tokens';
import { isToolResultOnlyMessage } from '../adapters/utils/tool-result-fold';
import { coalesceAssistantTurns, foldTurnParts } from '../adapters/utils/coalesce-turns';

/** Cache TTL in milliseconds (10 minutes) */
const CACHE_TTL_MS = 10 * 60 * 1_000;

/** Maximum number of cached session entries */
const CACHE_MAX_ENTRIES = 20;

export interface SessionCacheEntry {
  session: UnifiedSession;
  lastOffset: number;
  lastSize: number;
  lastMtime: number;
  /**
   * Numeric source version (file: byte size; DB: the token's `maxUpdated`,
   * i.e. max `time_updated` across the session — see {@link dbSourceVersion}).
   * Drives chunk-cache invalidation and the cursor's first component.
   */
  sourceVersion: number;
  /** Opaque freshness token (see {@link SessionReaderAdapter.getFreshnessToken}). */
  freshnessToken: unknown;
  cachedAt: number;
  /**
   * True when the parse that produced this entry folded LEADING tool-result-only entries
   * of an incremental slice onto the cached tail assistant (a cache-boundary fold). It
   * mutates the tail while adding ZERO new messages, so the watcher must publish an
   * in-place tail replacement rather than suppressing the change. Always `false` for a
   * full reparse / snapshot / cache hit.
   */
  boundaryFold: boolean;
}

export interface GetOrParseResult {
  session: UnifiedSession;
  cacheHit: boolean;
  lastOffset: number;
  lastSize: number;
  lastMtime: number;
  /** Numeric monotonic source version (see {@link SessionCacheEntry.sourceVersion}). */
  sourceVersion: number;
  /** See {@link SessionCacheEntry.boundaryFold}. */
  boundaryFold: boolean;
}

@Injectable()
export class SessionCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly cache = new Map<string, SessionCacheEntry>();

  onModuleDestroy(): void {
    this.cache.clear();
  }

  /**
   * Get or parse a session with incremental parsing and source-change detection.
   *
   * - Cache hit: source unchanged (freshness token equal) + TTL valid → return cached
   * - Append-only: currentSize > lastSize → incremental parse from offset
   * - Truncation or TTL expired: full reparse via adapter
   *
   * `source` accepts either a plain `filePath` (legacy/file callers) or a fully
   * resolved {@link SessionSourceRef}. When a ref is supplied, it is threaded into
   * the adapter's `parseFullSession` / `parseIncremental` so DB-backed adapters can
   * locate the session via `providerSessionId`.
   */
  async getOrParse(
    sessionId: string,
    source: string | SessionSourceRef,
    adapter: SessionReaderAdapter,
  ): Promise<UnifiedSession> {
    const now = Date.now();
    const ref = this.toSourceRef(source, adapter);
    // Legacy string callers keep the original adapter call shape (filePath only);
    // ref callers thread the source-ref through to the adapter.
    const threadRef = typeof source !== 'string' ? ref : undefined;
    const freshness = await this.computeFreshness(ref, adapter);
    const cached = this.cache.get(sessionId);

    // Cache hit: TTL valid + source unchanged (opaque freshness token equal)
    if (
      cached &&
      now - cached.cachedAt < CACHE_TTL_MS &&
      JSON.stringify(cached.freshnessToken) === JSON.stringify(freshness.token)
    ) {
      this.logger.debug({ sessionId }, 'Session cache hit');
      this.touchLru(sessionId, cached);
      return cached.session;
    }

    let session: UnifiedSession;
    let lastOffset: number;
    let boundaryFold = false;

    // Incremental parse: source grew (append-only pattern)
    if (cached && freshness.size > cached.lastSize) {
      this.logger.debug(
        { sessionId, lastOffset: cached.lastOffset, currentSize: freshness.size },
        'Incremental parse (source grew)',
      );

      const incOptions = { byteOffset: cached.lastOffset, includeToolCalls: true };
      const result = threadRef
        ? await adapter.parseIncremental(ref.filePath, incOptions, threadRef)
        : await adapter.parseIncremental(ref.filePath, incOptions);

      const newMessages = result.entries as UnifiedMessage[];

      if (adapter.incrementalMode === 'snapshot') {
        // Snapshot mode returns the full session state on each incremental parse.
        const snapshotMetrics = result.metrics ?? cached.session.metrics;
        session = {
          ...cached.session,
          messages: newMessages,
          metrics: snapshotMetrics,
          isOngoing: snapshotMetrics.isOngoing,
          warnings: this.mergeWarnings(cached.session.warnings, result.warnings),
        };
      } else {
        // Cache-boundary continuation fold: a slice can begin with a LEADING RUN of
        // tool-result-only entries AND/OR continuation assistants whose turn started in a
        // PRIOR slice (the parser's parse-local fold has no target across the byteOffset
        // boundary). Fold them onto the cached tail assistant so the live/incremental path
        // matches the full-parse coalesce (no inflated messageCount). See
        // {@link SessionCacheEntry.boundaryFold}.
        const folded = this.foldLeadingContinuationIntoCachedTail(
          cached.session.messages,
          newMessages,
        );
        boundaryFold = folded.tailMutatedWithoutNewMessage;
        const mergedMessages = folded.merged;
        const mergedMetrics = result.metrics
          ? this.mergeMetrics(cached.session.metrics, result.metrics, mergedMessages)
          : cached.session.metrics;

        session = {
          ...cached.session,
          messages: mergedMessages,
          metrics: mergedMetrics,
          isOngoing: mergedMetrics.isOngoing,
          warnings: this.mergeWarnings(cached.session.warnings, result.warnings),
        };
      }
      lastOffset = result.nextByteOffset;
    } else {
      // Full reparse: no cache, TTL expired, or source shrank (truncation)
      if (cached && freshness.size < cached.lastSize) {
        this.logger.debug({ sessionId }, 'Full reparse (source truncated)');
      }
      session = threadRef
        ? await adapter.parseFullSession(ref.filePath, threadRef)
        : await adapter.parseFullSession(ref.filePath);
      lastOffset = freshness.size;
    }

    // Unified assistant-turn coalescing (single source of truth) — the central choke-point.
    // Runs AFTER `session` is built from ANY branch (full reparse / snapshot / delta) and
    // BEFORE the cache store, so every provider gets identical turn-collapsing and
    // `messageCount === messages.length` holds. Claude/Codex parsers already coalesce → this
    // is a proven no-op for them; OpenCode (snapshot mode) is deflated here; on the delta path
    // `foldLeadingContinuationIntoCachedTail` already merged the boundary run, so the full-
    // array pass is a no-op there too. Also corrects the snapshot path's `messageCount`
    // (set from raw adapter output) via the recompute in the coalescer's returned metrics.
    const coalesced = coalesceAssistantTurns(session);
    // The coalescer returns the ORIGINAL `messages` reference on a true no-op (Claude/Codex,
    // or a delta already folded), so only rebuild the session object when turns actually
    // collapsed — preserving reference identity + the adapter's metrics for the no-op path.
    if (coalesced.messages !== session.messages) {
      session = { ...session, messages: coalesced.messages, metrics: coalesced.metrics };
    }

    // Store in cache (evict oldest if needed)
    this.evictIfNeeded(sessionId);
    this.cache.delete(sessionId);
    this.cache.set(sessionId, {
      session,
      lastOffset,
      lastSize: freshness.size,
      lastMtime: freshness.mtimeMs,
      sourceVersion: freshness.sourceVersion,
      freshnessToken: freshness.token,
      cachedAt: now,
      boundaryFold,
    });

    return session;
  }

  async getOrParseWithMeta(
    sessionId: string,
    source: string | SessionSourceRef,
    adapter: SessionReaderAdapter,
  ): Promise<GetOrParseResult> {
    const prevSession = this.cache.get(sessionId)?.session;

    const session = await this.getOrParse(sessionId, source, adapter);

    const entry = this.cache.get(sessionId)!;
    return {
      session,
      cacheHit: session === prevSession,
      lastOffset: entry.lastOffset,
      lastSize: entry.lastSize,
      lastMtime: entry.lastMtime,
      sourceVersion: entry.sourceVersion,
      boundaryFold: entry.boundaryFold,
    };
  }

  getEntry(sessionId: string): SessionCacheEntry | undefined {
    return this.cache.get(sessionId);
  }

  /** Invalidate a specific session's cache entry. */
  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** Clear all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of entries in cache. */
  get size(): number {
    return this.cache.size;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Move entry to end of Map insertion order (LRU touch). */
  private touchLru(sessionId: string, entry: SessionCacheEntry): void {
    this.cache.delete(sessionId);
    this.cache.set(sessionId, entry);
  }

  /** Evict the least-recently-used entry if at capacity. */
  private evictIfNeeded(sessionId: string): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES && !this.cache.has(sessionId)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * Cache-boundary continuation fold.
   *
   * An incremental slice parsed from a byteOffset can BEGIN with continuation content whose
   * assistant turn started in a PRIOR slice — the parser's parse-local fold/coalesce has no
   * target across the boundary (its `lastAssistantMessage` resets per parse), so the content
   * arrives as standalone messages and would inflate the live count. This folds a LEADING RUN
   * of such continuation messages onto the cached TAIL assistant so the live/incremental path
   * produces the SAME coalesced count as a full parse; `messageCount === messages.length` is
   * preserved (the metric is recomputed from the merged array, never decoupled).
   *
   * The run consumes a message when it is EITHER a tool-result-only entry (Case A:
   * `[tool_result, …]`) OR a continuation assistant (Case B: the slice begins directly with
   * the resumed assistant). It STOPS — a turn boundary — at the first: real user prompt;
   * `isCompactSummary` entry; sidechain mismatch vs the tail; or (Claude) a tail whose
   * `stopReason === 'end_turn'` (a completed turn is a new turn, not a continuation — the
   * guard advances as continuation assistants merge). Mirrors the per-provider parser
   * semantics (Tasks 1/2).
   *
   * The tail is CLONED — the cached message object prior callers may hold is never mutated.
   * `tailMutatedWithoutNewMessage` is true iff the run consumed the WHOLE slice (zero net new
   * messages) — the watcher consumes it (via `boundaryFold`) to publish a zero-count in-place
   * tail replacement. When the slice also carries a genuinely new message after the run, the
   * normal positive-delta publish already covers the mutated tail chunk.
   */
  private foldLeadingContinuationIntoCachedTail(
    cachedMessages: UnifiedMessage[],
    newMessages: UnifiedMessage[],
  ): { merged: UnifiedMessage[]; tailMutatedWithoutNewMessage: boolean } {
    const tail = cachedMessages[cachedMessages.length - 1];
    if (!tail || tail.role !== 'assistant' || newMessages.length === 0) {
      return { merged: [...cachedMessages, ...newMessages], tailMutatedWithoutNewMessage: false };
    }

    // Walk the LEADING run, advancing the end_turn guard as continuation assistants merge.
    let foldCount = 0;
    let tailStopReason = tail.stopReason ?? null;
    while (foldCount < newMessages.length) {
      const m = newMessages[foldCount];
      if (m.isSidechain !== tail.isSidechain) break; // sidechain transition → new context
      if (m.isCompactSummary) break; // compaction boundary
      const isToolResult = isToolResultOnlyMessage(m);
      const isContinuationAssistant = m.role === 'assistant';
      if (!isToolResult && !isContinuationAssistant) break; // real user prompt → new turn
      // Claude over-merge guard: a completed turn does not continue into a new assistant.
      if (isContinuationAssistant && tailStopReason === 'end_turn') break;
      if (isContinuationAssistant) tailStopReason = m.stopReason ?? null;
      foldCount += 1;
    }

    if (foldCount === 0) {
      return { merged: [...cachedMessages, ...newMessages], tailMutatedWithoutNewMessage: false };
    }

    // Clone the tail (do NOT mutate the cached object) and fold the run onto it.
    const foldedTail: UnifiedMessage = {
      ...tail,
      content: [...tail.content],
      toolCalls: [...tail.toolCalls],
      toolResults: [...tail.toolResults],
    };
    for (let i = 0; i < foldCount; i += 1) {
      // Shared merge primitive (`coalesce-turns.ts`): concat content/toolCalls/toolResults,
      // sum usage, and advance the persisted completion signal — identical to the full-array
      // coalescer, so the delta path and the central pass never drift.
      foldTurnParts(foldedTail, newMessages[i]);
    }

    const remaining = newMessages.slice(foldCount);
    return {
      merged: [...cachedMessages.slice(0, -1), foldedTail, ...remaining],
      tailMutatedWithoutNewMessage: remaining.length === 0,
    };
  }

  /**
   * Merge existing session metrics with incremental parse metrics.
   *
   * Token totals and cost are additive. Latest-state fields (isOngoing,
   * primaryModel, visibleContextTokens) come from the incremental result.
   * Compaction-related fields are kept from the existing metrics since they
   * cannot be reliably computed incrementally — they refresh on full reparse.
   */
  private mergeMetrics(
    existing: UnifiedMetrics,
    incremental: UnifiedMetrics,
    allMessages: UnifiedMessage[],
  ): UnifiedMetrics {
    const inputTokens = existing.inputTokens + incremental.inputTokens;
    const outputTokens = existing.outputTokens + incremental.outputTokens;
    const cacheReadTokens = existing.cacheReadTokens + incremental.cacheReadTokens;
    const cacheCreationTokens = existing.cacheCreationTokens + incremental.cacheCreationTokens;
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

    // Duration from first to last message timestamp
    let durationMs = existing.durationMs;
    if (allMessages.length >= 2) {
      durationMs =
        allMessages[allMessages.length - 1].timestamp.getTime() -
        allMessages[0].timestamp.getTime();
    }

    // Models: union of both sets
    const modelsSet = new Set<string>();
    if (existing.primaryModel) modelsSet.add(existing.primaryModel);
    if (incremental.primaryModel) modelsSet.add(incremental.primaryModel);
    if (existing.modelsUsed) existing.modelsUsed.forEach((m) => modelsSet.add(m));
    if (incremental.modelsUsed) incremental.modelsUsed.forEach((m) => modelsSet.add(m));
    const modelsUsed = modelsSet.size > 1 ? Array.from(modelsSet) : undefined;

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens,
      costUsd: existing.costUsd + incremental.costUsd,
      primaryModel: incremental.primaryModel ?? existing.primaryModel,
      modelsUsed,
      isOngoing: incremental.isOngoing,
      // Recomputed from all messages (compaction-aware) on every merge
      // to avoid staleness between full reparses.
      visibleContextTokens: estimateVisibleFromMessages(allMessages),
      // Assistant usage snapshot always implies positive total tokens;
      // 0 means no assistant/token_count was observed in this delta slice.
      totalContextTokens:
        incremental.totalContextTokens > 0
          ? incremental.totalContextTokens
          : existing.totalContextTokens,
      contextWindowTokens: incremental.contextWindowTokens ?? existing.contextWindowTokens,
      messageCount: allMessages.length,
      durationMs,
      // Compaction fields: kept from existing (refreshed on full reparse)
      totalContextConsumption: existing.totalContextConsumption,
      compactionCount: existing.compactionCount,
      phaseBreakdowns: existing.phaseBreakdowns,
    };
  }

  /** Merge warnings from existing + incremental results with deduplication. */
  private mergeWarnings(existing?: string[], incremental?: string[]): string[] | undefined {
    const combined = new Set<string>();
    if (existing) existing.forEach((w) => combined.add(w));
    if (incremental) incremental.forEach((w) => combined.add(w));
    return combined.size > 0 ? Array.from(combined) : undefined;
  }

  private async statFile(filePath: string): Promise<{ size: number; mtimeMs: number }> {
    const stat = await fs.stat(filePath);
    return { size: stat.size, mtimeMs: stat.mtime.getTime() };
  }

  /** Normalize a `filePath | SessionSourceRef` argument into a SessionSourceRef. */
  private toSourceRef(
    source: string | SessionSourceRef,
    adapter: SessionReaderAdapter,
  ): SessionSourceRef {
    if (typeof source === 'string') {
      return {
        filePath: source,
        providerName: adapter.providerName,
        kind: adapter.sourceKind ?? 'file',
      };
    }
    return source;
  }

  /**
   * Compute the cache freshness inputs for a source:
   * - `token`: opaque staleness token (adapter-provided, else default file token).
   * - `sourceVersion`: numeric monotonic version (file: byte size; DB: see below).
   * - `size` / `mtimeMs`: byte stats used for append/truncation detection and
   *   backward-compatible cache metadata.
   *
   * File sources derive `sourceVersion` from byte size (byte-for-byte legacy
   * behavior). DB sources derive it from the adapter's freshness token instead —
   * see {@link dbSourceVersion} for why the container file size is unusable here.
   */
  private async computeFreshness(
    ref: SessionSourceRef,
    adapter: SessionReaderAdapter,
  ): Promise<{ token: unknown; sourceVersion: number; size: number; mtimeMs: number }> {
    const { size, mtimeMs } = await this.statFile(ref.filePath);
    // Default file token mirrors {@link defaultFileFreshnessToken} but reuses the
    // stat above to avoid a redundant fs.stat call on the hot path.
    const token = adapter.getFreshnessToken
      ? await adapter.getFreshnessToken(ref)
      : { mtimeMs, size };
    const sourceVersion = ref.kind === 'db' ? this.dbSourceVersion(token, size) : size;
    return { token, sourceVersion, size, mtimeMs };
  }

  /**
   * Derive a per-session, revision-tracking `sourceVersion` for a DB source from
   * its opaque freshness token.
   *
   * Why not the container file size (the file-source default)? A DB-backed source
   * (e.g. OpenCode) keeps *many* sessions in one `opencode.db`, and in-place WAL
   * part edits (tool output, patch rewrites) mutate rows **without growing the
   * main `.db` byte size** (it only moves on checkpoint, and is shared across all
   * sessions). A size-based `sourceVersion` would therefore be (a) identical for
   * every session in the file and (b) frozen across exactly the in-place-edit
   * case `getTranscriptTail` must surface — making the tail a no-op.
   *
   * The token's `maxUpdated` (max `time_updated` over the session's
   * session/message/part rows) advances on BOTH new parts and in-place edits, so
   * it is the change-tracking signal we key on. `count` alone is insufficient: it
   * does not move on an in-place edit (the core scenario of this task).
   *
   * NOTE: parent design decision #4 specced DB `sourceVersion` = `max(rowid)` /
   * `count`; that misses in-place part edits, so we deliberately deviate to the
   * `maxUpdated`-driven value here.
   */
  private dbSourceVersion(token: unknown, fallbackSize: number): number {
    if (token && typeof token === 'object') {
      const t = token as { maxUpdated?: unknown };
      if (typeof t.maxUpdated === 'number' && Number.isFinite(t.maxUpdated)) {
        return t.maxUpdated;
      }
    }
    return fallbackSize;
  }
}
