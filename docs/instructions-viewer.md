# Viewing & Editing Agent Instructions

Devchain agents get their behaviour from **instructions**: SOP prompts referenced by each profile. This document covers the two surfaces for viewing and editing them.

## 1. Prompts page (`/prompts`) — edit the SOP prompts

The Prompts page is a split-view editor for the prompt blobs (e.g. "Worker AI - Task Execution SOP", "Epic Master - instructions SOP").

- **Left rail:** lists every prompt in the project (title + tags), with a **+ New** button and a per-row **Delete**.
- **Right pane:** the selected prompt's content in a full-height, scrollable, monospace editor. Edit title, tags, and content directly — no modal.
- **Save / Discard:** editing marks a dirty dot; **Save** is explicit (writes via optimistic locking — see conflicts below). Switching rows with unsaved edits asks you to confirm discarding them.
- **Fullscreen toggle** (top-right of the editor): hides the left rail so the editor fills the page, and shows the template-variables reference (`{agent_name}`, `{project_name}`, `{epic_title}`, `{session_id}`, …).

### Optimistic-lock conflicts

Prompts are versioned. If another operation edits the same prompt between your load and save, the server returns **HTTP 409**. The editor toasts *"Someone else edited this prompt. Refetched. Your edits are preserved."*, refetches the new version, and keeps your local edits so you can **Save** again (the retry sends the bumped version).

## 2. Profile details — the "Effective prompt" preview

A profile's `instructions` field usually holds a **reference** like `[[prompt:Worker AI - Task Execution SOP]]`, not the content. Opening a profile's edit dialog now shows an **Effective prompt (preview)** section: what the profile's agent *actually* receives at session start, with all `[[prompt:…]]` references resolved.

The preview is **read-only** — to change it, edit the source prompts on the Prompts page. Editing the profile's `instructions` field (adding/removing `[[prompt:…]]` references) changes what resolves.

### How resolution works (and its quirks)

The preview reuses the exact runtime resolver, so it reflects real behaviour, including these subtleties:

- **References resolve by title**, case-insensitive, project scope first then global.
- **Free text around a reference is dropped.** If `instructions = "Preamble\n[[prompt:SOP]]\nFooter"` and `SOP` resolves, the agent receives *only* the SOP content — "Preamble" and "Footer" are not sent.
- **Caps:** at most 10 documents/prompts combined and 64 KB total. If the preview is truncated, a yellow banner shows "Effective prompt was truncated at 64 KB."
- **Variables** (`{{agent_name}}`, `{project_name}`, team context) are substituted for the first agent using the profile (or the profile name when no agent uses it).

### Banners in the preview

- 🟡 **Truncated at 64 KB** — the resolved prompt hit the byte cap.
- 🔴 **Unresolved references** — an inline `[[prompt:Title]]` whose title doesn't match any prompt (project or global). The title is listed.
- 🟠 **Assigned prompts not referenced inline** — prompts in the profile's *assigned* list that are **not** referenced via `[[prompt:…]]` in `instructions`. These do **not** reach the agent: the assigned list is metadata only; only inline references become part of the effective prompt. This is the most common footgun the preview is designed to surface. To make an assigned prompt take effect, add `[[prompt:Its Title]]` to the `instructions` field.

## Reference: where this lives in the code

| Concern | Location |
|---|---|
| Prompts page (split-view editor) | `apps/local-app/src/ui/pages/PromptsPage.tsx` |
| Effective-prompt preview component | `apps/local-app/src/ui/components/EffectivePromptPreview.tsx` |
| Effective-prompt React hook | `apps/local-app/src/ui/hooks/useEffectivePrompt.ts` |
| Effective-prompt endpoint | `GET /api/profiles/:id/effective-prompt` — `apps/local-app/src/modules/profiles/controllers/profiles.controller.ts` |
| Resolver service (profiles module) | `apps/local-app/src/modules/profiles/services/profile-instructions.service.ts` |
| The resolver itself (shared with MCP runtime) | `apps/local-app/src/modules/mcp/services/instructions-resolver.ts` |
