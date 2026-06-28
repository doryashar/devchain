import type { ProcessExecutor } from '../process-executor/process-executor.port';
import type { SessionTarget } from './types';

/**
 * Hard caps for a single VISIBLE-screen viewport capture. Deliberately far smaller
 * than `captureHistory`'s up-to-5MB scrollback path (`capture.ts`): a viewport is the
 * live visible pane only, re-captured at a few fps, so it must stay tiny and bounded.
 */
const VIEWPORT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ROWS = 200;
const MAX_COLS = 500;

/**
 * A single VISIBLE-screen capture: already-rendered rows bearing ANSI/SGR color markup
 * (tmux `capture-pane -e`), plus the cursor position and pane geometry. This is the
 * server-rendered screen state the mobile viewport renders — NOT raw bytes, NOT scrollback.
 */
export interface ViewportCapture {
  lines: string[];
  cursor: { x: number; y: number };
  cols: number;
  rows: number;
}

/**
 * Capture the VISIBLE tmux screen for `target`, preserving color, with cursor + pane dims.
 *
 * Dedicated viewport path — intentionally NOT `captureHistory(lines=2000)`: no `-S`
 * scrollback (visible region only), a tight {@link VIEWPORT_MAX_OUTPUT_BYTES} cap, and
 * hard row/col clamps. Returns `null` (never throws) when either tmux call fails, so the
 * caller can skip the tick rather than tear down anything.
 */
export async function captureViewport(
  executor: ProcessExecutor,
  target: SessionTarget,
): Promise<ViewportCapture | null> {
  // `-e` keeps SGR color; no `-S` ⇒ visible screen only; `-p` ⇒ stdout.
  const capture = await executor.run({
    argv: ['tmux', 'capture-pane', '-e', '-p', '-t', `=${target.name}:`],
    mode: 'pipe',
    outputLimits: { maxBytes: VIEWPORT_MAX_OUTPUT_BYTES },
  });
  if (!capture.success) return null;

  // Cursor position + pane geometry in a single round-trip.
  const meta = await executor.run({
    argv: [
      'tmux',
      'display-message',
      '-p',
      '-t',
      `=${target.name}:`,
      '#{cursor_x} #{cursor_y} #{pane_width} #{pane_height}',
    ],
    mode: 'pipe',
  });
  if (!meta.success) return null;

  const [cx, cy, pw, ph] = (meta.stdout ?? '')
    .trim()
    .split(/\s+/)
    .map((n) => parseInt(n, 10));

  const cols = clampDim(pw, 80, MAX_COLS);
  const rows = clampDim(ph, 24, MAX_ROWS);
  const cursor = {
    x: Number.isFinite(cx) && cx >= 0 ? cx : 0,
    y: Number.isFinite(cy) && cy >= 0 ? cy : 0,
  };

  // tmux emits one line per screen row; the trailing newline yields a final '' we drop.
  let lines = (capture.stdout ?? '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  // Defensive row cap: keep the LAST `rows` lines (the visible screen) if tmux ever
  // returns more than the pane height.
  if (lines.length > rows) lines = lines.slice(lines.length - rows);

  return { lines, cursor, cols, rows };
}

function clampDim(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}
