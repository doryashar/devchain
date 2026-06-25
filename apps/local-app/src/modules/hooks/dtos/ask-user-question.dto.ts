import type { NormalizedAskUserQuestion } from '../../events/catalog/claude.hooks.ask_user_question.pending';

/** Claude Code's AskUserQuestion tool name (the relay matcher value). */
export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

/** Defensive caps mirroring the mobile detector (detect-pending-question.ts). */
export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 12;

/**
 * Normalize a raw AskUserQuestion `tool_input` into the canonical shape, or
 * return `null` if the payload is malformed. Mirrors the mobile-side detector
 * so the card renders identically whether sourced from the transcript or the
 * pending store. Defensive by construction: any shape mismatch => null (the
 * handler then skips storing rather than persisting garbage).
 */
export function normalizeAskUserQuestions(
  toolInput: Record<string, unknown>,
): NormalizedAskUserQuestion[] | null {
  const raw = (toolInput as { questions?: unknown }).questions;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const normalized: NormalizedAskUserQuestion[] = [];
  for (const candidate of raw.slice(0, MAX_QUESTIONS)) {
    if (typeof candidate !== 'object' || candidate === null) {
      return null;
    }
    const { question, header, multiSelect, options } = candidate as Record<string, unknown>;
    if (typeof question !== 'string' || question.length === 0) {
      return null;
    }
    if (typeof header !== 'string' || header.length === 0) {
      return null;
    }
    if (!Array.isArray(options) || options.length === 0) {
      return null;
    }

    const normalizedOptions: NormalizedAskUserQuestion['options'] = [];
    for (const option of options.slice(0, MAX_OPTIONS)) {
      if (typeof option !== 'object' || option === null) {
        return null;
      }
      const { label, description } = option as Record<string, unknown>;
      if (typeof label !== 'string' || label.length === 0) {
        return null;
      }
      normalizedOptions.push({
        label,
        description: typeof description === 'string' ? description : '',
      });
    }

    normalized.push({
      question,
      header,
      multiSelect: multiSelect === true,
      options: normalizedOptions,
    });
  }

  return normalized.length > 0 ? normalized : null;
}
