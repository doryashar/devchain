export interface BroadcastTopicEntry<T = unknown> {
  topic: string | ((payload: T) => string);
  type: string | ((payload: T) => string);
  payloadProjection?: (payload: T) => unknown;
}

export interface BroadcastRegistryTopicEntry<T = unknown> extends BroadcastTopicEntry<T> {
  /** Web-client reaction contract. `owner` is an opaque consumer label
   *  (hook/component/file/'global') — a plain string, NOT a typed link to a ui/ symbol. */
  clientReaction: {
    kind: 'invalidate' | 'no-op' | 'custom-handler';
    owner: string;
  };
  /**
   * Canonical content classification for the mobile push lane: `true` when this entry's
   * `payloadProjection` carries REAL CONTENT (message/transcript body, agent/team names,
   * question text) rather than just a routing hint (counts/cursors/presence/ids).
   *
   * This is the SOURCE OF TRUTH for the tunnel forwarder's `CONTENT_BEARING_PUSH_EVENTS`
   * content policy: a content-bearing frame must NEVER ship in plaintext to a non-E2EE
   * peer. The `tunnel-push-content-policy-sync.spec` fails if a forwarded content-bearing
   * registry entry has no matching forwarder-policy entry (allowlist-in-two-places drift
   * guard, same pattern as `broadcast-allowlist-sync` / `push-allowlist-sync`). Web-only
   * (non-forwarded) entries leave it unset — the flag is a no-op for the socket.io fan-out.
   */
  contentBearing?: boolean;
}
