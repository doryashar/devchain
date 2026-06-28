import { captureViewport } from './viewport-capture';
import type { ProcessExecutor, ExecutorResult } from '../process-executor/process-executor.port';

function ok(stdout: string): ExecutorResult {
  return { success: true, exitCode: 0, stdout, stderr: '', timedOut: false, truncated: false };
}
function fail(stderr = 'boom'): ExecutorResult {
  return { success: false, exitCode: 1, stdout: '', stderr, timedOut: false, truncated: false };
}

/** Mock executor that returns queued results in call order. */
function executorReturning(results: ExecutorResult[]): {
  executor: ProcessExecutor;
  calls: string[][];
} {
  const calls: string[][] = [];
  let i = 0;
  const executor = {
    run: jest.fn(async (opts: { argv: readonly string[] }) => {
      calls.push([...opts.argv]);
      return results[i++];
    }),
    spawnDaemon: jest.fn(),
  } as unknown as ProcessExecutor;
  return { executor, calls };
}

describe('captureViewport', () => {
  it('captures the colored visible screen with cursor + pane dims', async () => {
    const { executor, calls } = executorReturning([
      ok('line-1\n[31mline-2[0m\n'),
      ok('3 1 80 24\n'),
    ]);

    const result = await captureViewport(executor, { name: 'sess' });

    expect(result).toEqual({
      lines: ['line-1', '[31mline-2[0m'],
      cursor: { x: 3, y: 1 },
      cols: 80,
      rows: 24,
    });
    // visible capture uses `-e` (color) and NO `-S` (no scrollback history).
    expect(calls[0]).toEqual(['tmux', 'capture-pane', '-e', '-p', '-t', '=sess:']);
    expect(calls[0]).not.toContain('-S');
    expect(calls[1]).toContain('#{cursor_x} #{cursor_y} #{pane_width} #{pane_height}');
  });

  it('returns null when the screen capture fails', async () => {
    const { executor } = executorReturning([fail()]);
    expect(await captureViewport(executor, { name: 'sess' })).toBeNull();
  });

  it('returns null when the metadata query fails', async () => {
    const { executor } = executorReturning([ok('line-1\n'), fail()]);
    expect(await captureViewport(executor, { name: 'sess' })).toBeNull();
  });

  it('falls back to default dims and zero cursor on unparseable metadata', async () => {
    const { executor } = executorReturning([ok('only-line\n'), ok('garbage\n')]);
    const result = await captureViewport(executor, { name: 'sess' });
    expect(result).toMatchObject({ cols: 80, rows: 24, cursor: { x: 0, y: 0 } });
  });

  it('caps lines to the pane row height (keeps the last rows)', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `row-${i}`).join('\n');
    const { executor } = executorReturning([ok(lines + '\n'), ok('0 0 80 3\n')]);
    const result = await captureViewport(executor, { name: 'sess' });
    expect(result?.rows).toBe(3);
    expect(result?.lines).toEqual(['row-7', 'row-8', 'row-9']);
  });

  // Cross-cutting backpressure invariants (Task 7): a viewport frame is the live visible
  // pane re-captured at a few fps, so its byte + dimension footprint must stay hard-bounded.
  it('bounds a single capture payload with a 256 KiB byte cap (backpressure — no unbounded frame)', async () => {
    const { executor } = executorReturning([ok('x\n'), ok('0 0 80 24\n')]);
    await captureViewport(executor, { name: 'sess' });
    // The capture-pane call carries the hard byte ceiling so a runaway pane cannot ship an
    // unbounded frame onto the viewport lane.
    const firstRunOpts = (executor.run as jest.Mock).mock.calls[0][0];
    expect(firstRunOpts).toMatchObject({ outputLimits: { maxBytes: 256 * 1024 } });
  });

  it('clamps oversized pane geometry to the viewport dimension ceiling (≤500 cols, ≤200 rows)', async () => {
    const { executor } = executorReturning([ok('row\n'), ok('0 0 9999 9999\n')]);
    const result = await captureViewport(executor, { name: 'sess' });
    expect(result).toMatchObject({ cols: 500, rows: 200 });
  });
});
