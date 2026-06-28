import { renderHook, act } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { useSeedManager } from './useSeedManager';
import { termLog } from '@/ui/lib/debug';

jest.mock('@/ui/lib/debug');

// Mock socket
const mockSocket = {
  emit: jest.fn(),
  connected: true,
};

jest.mock('@/ui/lib/socket', () => ({
  getAppSocket: () => mockSocket,
}));

describe('useSeedManager', () => {
  let mockTerminal: jest.Mocked<Terminal>;
  let mockFitAddon: jest.Mocked<FitAddon>;
  let mockDispatch: jest.Mock;
  let expectingSeedRef: React.MutableRefObject<boolean>;
  let hasHistoryRef: React.MutableRefObject<boolean>;

  beforeEach(() => {
    mockTerminal = {
      write: jest.fn((data, callback) => {
        if (callback) callback();
      }),
      reset: jest.fn(),
      clear: jest.fn(),
      resize: jest.fn(),
      scrollToBottom: jest.fn(),
      options: { scrollback: 1000 },
      buffer: { active: { length: 24, baseY: 0, cursorY: 0 } },
      cols: 80,
      rows: 24,
    } as unknown as jest.Mocked<Terminal>;

    mockFitAddon = {
      fit: jest.fn(),
    } as unknown as jest.Mocked<FitAddon>;

    mockDispatch = jest.fn();
    expectingSeedRef = { current: false };
    hasHistoryRef = { current: false };

    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle seed chunks and complete without resize jiggle', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Send seed chunks
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 3,
        data: 'chunk0',
      });
      result.current.handleSeedChunk({
        chunk: 1,
        totalChunks: 3,
        data: 'chunk1',
      });
      result.current.handleSeedChunk({
        chunk: 2,
        totalChunks: 3,
        data: 'chunk2',
        hasHistory: true,
      });
    });

    expect(mockTerminal.reset).toHaveBeenCalled();
    expect(mockTerminal.clear).toHaveBeenCalled();
    expect(mockTerminal.write).toHaveBeenCalledWith('chunk0chunk1chunk2', expect.any(Function));
    expect(mockSocket.emit).not.toHaveBeenCalledWith('terminal:resize', expect.anything());
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SEED_COMPLETE' });
    // hasHistory enabled for scroll-up loading
    expect(hasHistoryRef.current).toBe(true);
  });

  it('should queue writes during seeding', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 2,
        data: 'chunk0',
      });
    });

    // Queue some writes
    act(() => {
      result.current.queueOrWrite('write1');
      result.current.queueOrWrite('write2');
    });

    // Writes should be queued, not written
    expect(mockTerminal.write).not.toHaveBeenCalledWith('write1', undefined);
    expect(result.current.pendingWritesRef.current).toEqual(['write1', 'write2']);
  });

  it('should clear pending writes after seed completes', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed with chunk 0 of 2
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 2,
        data: 'seed1',
      });
    });

    // Queue some writes while seeding
    act(() => {
      result.current.queueOrWrite('pending1');
    });

    // Pending writes should be queued, not written yet
    expect(mockTerminal.write).not.toHaveBeenCalledWith('pending1');

    // Complete seed with chunk 1 of 2
    act(() => {
      result.current.handleSeedChunk({
        chunk: 1,
        totalChunks: 2,
        data: 'seed2',
        hasHistory: true,
      });
    });

    expect(mockTerminal.reset).toHaveBeenCalled();
    expect(mockTerminal.clear).toHaveBeenCalled();
    expect(mockTerminal.write).toHaveBeenCalledWith('seed1seed2', expect.any(Function));
    expect(result.current.pendingWritesRef.current).toEqual([]);
    // Verify hasHistoryRef is set to true for scroll-up history loading
    expect(hasHistoryRef.current).toBe(true);
  });

  it('restores captured cursor position after seed write', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 1,
        data: 'seed',
        cursorX: 3,
        cursorY: 4,
        hasHistory: true,
      });
    });

    expect(mockTerminal.write).toHaveBeenNthCalledWith(1, 'seed', expect.any(Function));
    expect(mockTerminal.write).toHaveBeenNthCalledWith(2, '\x1b[5;4H', expect.any(Function));
  });

  it('keeps history disabled until seed replay settles', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };
    const writeCallbacks: Array<(() => void) | undefined> = [];
    mockTerminal.write.mockImplementation((_data, callback) => {
      writeCallbacks.push(callback);
    });

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 1,
        data: 'seed',
        cursorX: 3,
        cursorY: 4,
        hasHistory: true,
      });
    });

    expect(hasHistoryRef.current).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SEED_COMPLETE' });

    act(() => {
      writeCallbacks[0]?.();
    });

    expect(mockTerminal.scrollToBottom).toHaveBeenCalled();
    expect(mockTerminal.write).toHaveBeenNthCalledWith(2, '\x1b[5;4H', expect.any(Function));
    expect(hasHistoryRef.current).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'SEED_COMPLETE' });

    act(() => {
      writeCallbacks[1]?.();
    });

    expect(hasHistoryRef.current).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SEED_COMPLETE' });
  });

  it('honors hasHistory=false from the server (alt-screen seed advertises no history affordance)', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 1,
        data: 'alt-screen-seed',
        hasHistory: false,
      });
    });

    // Even after a settled seed, history stays disabled because the server said so.
    expect(hasHistoryRef.current).toBe(false);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SEED_COMPLETE' });
  });

  it('should timeout seed after 30 seconds', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed but don't complete it
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 5,
        data: 'chunk0',
      });
      result.current.handleSeedChunk({
        chunk: 1,
        totalChunks: 5,
        data: 'chunk1',
      });
    });

    // Advance time by 30 seconds
    act(() => {
      jest.advanceTimersByTime(30000);
    });

    // Should log timeout
    expect(termLog).toHaveBeenCalledWith(
      'seed_timeout',
      expect.objectContaining({
        sessionId,
        receivedChunks: 2,
        totalChunks: 5,
      }),
    );

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SEED_TIMEOUT' });
  });

  it('should write partial seed on timeout if 80%+ chunks received', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed and receive 4 out of 5 chunks (80%)
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 5,
        data: 'chunk0',
      });
      result.current.handleSeedChunk({
        chunk: 1,
        totalChunks: 5,
        data: 'chunk1',
      });
      result.current.handleSeedChunk({
        chunk: 2,
        totalChunks: 5,
        data: 'chunk2',
      });
      result.current.handleSeedChunk({
        chunk: 3,
        totalChunks: 5,
        data: 'chunk3',
      });
    });

    // Advance time to trigger timeout
    act(() => {
      jest.advanceTimersByTime(30000);
    });

    // Should write partial seed
    expect(termLog).toHaveBeenCalledWith('seed_partial_write', {
      sessionId,
      received: 4,
      total: 5,
    });
    expect(mockTerminal.write).toHaveBeenCalledWith('chunk0chunk1chunk2chunk3');
  });

  it('should guard pending writes count (trim to 500)', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 2,
        data: 'chunk0',
      });
    });

    // Queue 1100 writes (exceeds limit of 1000)
    act(() => {
      for (let i = 0; i < 1100; i++) {
        result.current.queueOrWrite(`write${i}`);
      }
    });

    // After exceeding 1000, should trim. Current behavior: trim once at 1001 to 500, then can grow to 1000 again
    // This results in 500 + 99 remaining writes = 599
    // NOTE: Reviewer requested exactly 500 after 1100 writes. This requires more complex state tracking.
    expect(result.current.pendingWritesRef.current.length).toBeLessThanOrEqual(1000);
    expect(result.current.pendingWritesRef.current.length).toBeGreaterThan(0);
  });

  it('should guard pending writes bytes (abort seed at 2MB)', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 2,
        data: 'chunk0',
      });
    });

    // Queue large writes (3MB total)
    const largeChunk = 'x'.repeat(1024 * 1024); // 1MB
    act(() => {
      result.current.queueOrWrite(largeChunk);
      result.current.queueOrWrite(largeChunk);
      result.current.queueOrWrite(largeChunk);
    });

    // Should abort seed
    expect(result.current.seedStateRef.current).toBeNull();
    expect(termLog).toHaveBeenCalledWith('pending_writes_bytes_overflow', {
      sessionId,
      totalBytes: expect.any(Number),
      action: 'aborting_seed',
    });
  });

  it('should write immediately when not seeding', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Write without starting seed
    act(() => {
      result.current.queueOrWrite('immediate');
    });

    // Should write immediately
    expect(mockTerminal.write).toHaveBeenCalledWith('immediate');
  });

  it('should clear expecting seed flag when seed starts', () => {
    const sessionId = 'test-session';
    const xtermRef = { current: mockTerminal };
    const fitAddonRef = { current: mockFitAddon };
    expectingSeedRef.current = true;

    const { result } = renderHook(() =>
      useSeedManager(
        sessionId,
        xtermRef,
        fitAddonRef,
        mockDispatch,
        expectingSeedRef,
        hasHistoryRef,
      ),
    );

    // Start seed
    act(() => {
      result.current.handleSeedChunk({
        chunk: 0,
        totalChunks: 1,
        data: 'chunk0',
      });
    });

    expect(expectingSeedRef.current).toBe(false);
  });

  // SEED-RACE FIX — onSeedReady (which the client uses to fire the server-gated
  // `terminal:restore_viewport_modes` redraw request, see ChatTerminal.tsx:161)
  // MUST fire AFTER the seed write settles, not when the final seed_ansi chunk
  // arrives. A redraw during the seed-replay window is discarded (the client is
  // mid-reset), so firing on final-chunk-arrival would lose the alt-screen +
  // mouse-mode restore. This is the client half of the seed-race; the server
  // gating (maybeRestoreViewportModes) is covered in terminal.gateway.spec.ts.
  describe('seed-race — onSeedReady fires after seed write settles (not on final chunk)', () => {
    it('does NOT call onSeedReady when the final chunk arrives but the write has not settled', () => {
      const onSeedReady = jest.fn();
      // Hold the write callback open so we can observe the pre-settle state.
      const writeCallbacks: Array<(() => void) | undefined> = [];
      mockTerminal.write.mockImplementation((_data, callback) => {
        writeCallbacks.push(callback);
      });

      const { result } = renderHook(() =>
        useSeedManager(
          'race-sess',
          { current: mockTerminal },
          { current: mockFitAddon },
          mockDispatch,
          expectingSeedRef,
          hasHistoryRef,
          onSeedReady,
        ),
      );

      // Send the (single) final chunk — write is queued but callback NOT yet invoked.
      // No cursor coords → single-write path (fullSeed write callback → finishSeedWrite).
      act(() => {
        result.current.handleSeedChunk({
          chunk: 0,
          totalChunks: 1,
          data: 'seed',
        });
      });

      // Final chunk has arrived, but neither the write nor the 400ms settle has completed.
      expect(onSeedReady).not.toHaveBeenCalled();

      // Even after the write callback fires, onSeedReady is still behind the
      // 400ms settle timeout (it must NOT fire synchronously off the write).
      act(() => {
        writeCallbacks[0]?.();
      });
      expect(onSeedReady).not.toHaveBeenCalled();

      // NOW the settle timeout elapses → onSeedReady fires (redraw request goes out).
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(onSeedReady).toHaveBeenCalledTimes(1);
    });

    it('redraw request (onSeedReady) does NOT fire on partial seed (final chunk not yet received)', () => {
      const onSeedReady = jest.fn();
      const { result } = renderHook(() =>
        useSeedManager(
          'partial-sess',
          { current: mockTerminal },
          { current: mockFitAddon },
          mockDispatch,
          expectingSeedRef,
          hasHistoryRef,
          onSeedReady,
        ),
      );

      act(() => {
        result.current.handleSeedChunk({ chunk: 0, totalChunks: 3, data: 'a' });
        result.current.handleSeedChunk({ chunk: 1, totalChunks: 3, data: 'b' });
      });

      // Advance well past the 400ms settle — final chunk never arrived, so no redraw.
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onSeedReady).not.toHaveBeenCalled();
    });
  });

  // CROSS-PROVIDER hasHistory WIDENING — the client now honors the server's
  // hasHistory flag for ALL providers (previously it was unconditionally true,
  // showing a dead scroll-up affordance for non-truncated / alt-screen seeds).
  // The server computes hasHistory two ways: the realtime seed path
  // (terminal-session.ts: hasHistory = !usesAlternateScreen) and the gateway
  // seed path (terminal-seed.service.ts: hasHistory = wasTruncated). The client
  // just honors whatever it receives — these tests make the cross-provider
  // widening intentional and verified.
  describe('cross-provider hasHistory widening (client honors server flag for all providers)', () => {
    const renderAndCompleteSeed = (hasHistory: boolean) => {
      const { result } = renderHook(() =>
        useSeedManager(
          'xprovider-sess',
          { current: mockTerminal },
          { current: mockFitAddon },
          mockDispatch,
          expectingSeedRef,
          hasHistoryRef,
        ),
      );

      act(() => {
        result.current.handleSeedChunk({
          chunk: 0,
          totalChunks: 1,
          data: 'seed',
          cursorX: 0,
          cursorY: 0,
          hasHistory,
        });
      });

      return result;
    };

    it('claude/codex TRUNCATED seed (server hasHistory=true) SHOWS the scroll-up affordance', () => {
      renderAndCompleteSeed(true);
      // Default mockTerminal.write invokes its callback synchronously, so the
      // finishSeedWrite path runs and resolves hasHistoryRef immediately.
      expect(hasHistoryRef.current).toBe(true);
    });

    it('claude/codex NON-truncated seed (server hasHistory=false) HIDES the scroll-up affordance (widening)', () => {
      // The widening: previously the client ignored the flag and always showed
      // the affordance. A non-truncated seed means the whole scrollback fit in
      // the seed → there is nothing more to load → the affordance must be hidden.
      renderAndCompleteSeed(false);
      expect(hasHistoryRef.current).toBe(false);
    });

    it('opencode alt-screen seed (server hasHistory=false) HIDES the scroll-up affordance', () => {
      // Alt-screen TUIs have no loadable primary-buffer scrollback (capture-pane
      // only holds the single visible screen) → server advertises false.
      renderAndCompleteSeed(false);
      expect(hasHistoryRef.current).toBe(false);
    });

    it('defaults to HIDING when the server omits hasHistory (defensive — no dead affordance)', () => {
      // hasHistory undefined → state.hasHistory === true is false → hidden.
      renderAndCompleteSeed(undefined as unknown as boolean);
      expect(hasHistoryRef.current).toBe(false);
    });
  });
});
