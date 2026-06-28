import { broadcastRegistry } from '../../events/catalog/broadcast-registry';
import {
  CONTENT_BEARING_PUSH_EVENTS,
  TUNNEL_FORWARDED_EVENTS,
} from './tunnel-event-forwarder.service';

/**
 * Bridge B2 drift guard: the forwarder's push content policy
 * (`CONTENT_BEARING_PUSH_EVENTS`) must stay in lock-step with the SOURCE OF TRUTH —
 * each broadcast-registry entry's `contentBearing` flag.
 *
 * Layer: unit (contract sync). Same allowlist-in-two-places pattern as
 * `broadcast-allowlist-sync.spec` (registry ↔ shared push topic allowlist) and
 * `push-allowlist-sync.spec` (bridge ↔ shared): the policy is declared in two places
 * and this test fails LOUDLY on any drift.
 *
 * The invariant it protects (development-standards §three-lanes; mobile-chat-realtime
 * §hint-vs-catch-up): a forwarded event whose registry projection carries REAL CONTENT
 * must be in `CONTENT_BEARING_PUSH_EVENTS`, so the forwarder WITHHOLDS it on a plaintext
 * push to a non-E2EE-capable peer. If a content-bearing registry entry were added (or its
 * projection grew content) without the forwarder policy being updated, real content would
 * silently ship in plaintext — this test turns that red.
 *
 * Scope: ONLY the tunnel-forwarded events. Web-only registry entries (epic/review/…) also
 * carry content but never ride the push lane, so they are intentionally out of scope here.
 */
describe('tunnel push content-policy ↔ broadcast-registry sync (B2 drift guard)', () => {
  /** True iff ANY registry entry for this event is flagged `contentBearing`. */
  const registrySaysContentBearing = (event: string): boolean =>
    (broadcastRegistry[event] ?? []).some((entry) => entry.contentBearing === true);

  it.each(TUNNEL_FORWARDED_EVENTS)(
    'forwarder content policy matches the registry contentBearing flag for %s',
    (event) => {
      // Bidirectional drift guard: a content-bearing registry entry MUST be in the policy
      // (else it leaks plaintext content), and a policy entry MUST be content-bearing in the
      // registry (else the policy carries a stale entry that needlessly withholds a hint).
      expect(CONTENT_BEARING_PUSH_EVENTS.has(event)).toBe(registrySaysContentBearing(event));
    },
  );

  it('every event in the forwarder content policy is actually a forwarded event', () => {
    for (const event of CONTENT_BEARING_PUSH_EVENTS) {
      expect(TUNNEL_FORWARDED_EVENTS).toContain(event);
    }
  });

  it('every forwarded content-bearing event has at least one registry entry', () => {
    for (const event of CONTENT_BEARING_PUSH_EVENTS) {
      expect((broadcastRegistry[event] ?? []).length).toBeGreaterThan(0);
    }
  });

  it('classifies the content-bearing forwarded events (transcript deltas, agent names, AUQ, chat)', () => {
    // The fix this task delivers: transcript deltas + agent-lifecycle names join the
    // pre-existing AUQ-pending + chat-message classification. Asserted explicitly so a
    // revert of the registry flags fails here, not just in the generic %s table above.
    expect([...CONTENT_BEARING_PUSH_EVENTS].sort()).toEqual(
      [
        'agent.created',
        'agent.deleted',
        'chat.message.created',
        'claude.hooks.ask_user_question.pending',
        'session.transcript.updated',
      ].sort(),
    );
  });

  it('does NOT classify pure-hint forwarded events as content-bearing', () => {
    // Counts/cursors/presence/ids only — safe to ride plaintext against an incapable peer.
    const hintEvents = [
      'claude.hooks.ask_user_question.resolved',
      'session.presence.changed',
      'session.activity.changed',
    ] as const;
    for (const event of hintEvents) {
      expect(CONTENT_BEARING_PUSH_EVENTS.has(event)).toBe(false);
      expect(registrySaysContentBearing(event)).toBe(false);
    }
  });
});
