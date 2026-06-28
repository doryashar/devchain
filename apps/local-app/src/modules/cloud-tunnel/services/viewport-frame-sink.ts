import type { TunnelViewportFrame } from '@devchain/shared';

/**
 * Narrow outbound sink the viewport streamer pushes frames through, plus a tunnel-ready
 * hook for re-anchoring on reconnect. Implemented by {@link TunnelClientService}.
 *
 * This is a dependency-inversion seam: the streamer depends on THIS abstraction, never on
 * the concrete `TunnelClientService`. That keeps the import graph acyclic — `TunnelClient`
 * → `TunnelHandler` → `ViewportStreamer` → `ViewportFrameSink` (a leaf), with no edge back
 * to `TunnelClient` — so the cloud-tunnel module-graph cycle guard (madge) stays green.
 */
export abstract class ViewportFrameSink {
  /** Best-effort send a viewport frame up the tunnel; `false` when not push-ready. */
  abstract sendViewport(frame: TunnelViewportFrame): boolean;
  /** Register a callback fired on each tunnel (re)ready; returns an unregister fn. */
  abstract onPushReady(listener: () => void): () => void;
  /**
   * The bridge-assigned instance id this tunnel belongs to (`null` before `ready`). The
   * streamer needs it to bind the E2EE AAD when sealing viewport frames (Phase 4); exposing it
   * through this port keeps the streamer decoupled from the concrete `TunnelClientService`.
   */
  abstract getInstanceId(): string | null;
}
