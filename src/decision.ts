/**
 * The fast-path policy and the synthetic reviewer answer.
 *
 * The only decision this plugin can make is the reviewer's own
 * `{"risk":"low","decision":"allow"}`: the reviewer's policy states that a low
 * action must be allowed without additional authorization, so answering low for
 * a deployment-approved tool narrows nothing. Medium, high, and every uncertain
 * case stay with the language-model reviewer.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/decision
 */

import { createHash } from 'node:crypto'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { NoulQuestion, StateSectionName } from './types.ts'

/** The reviewer's low-risk allow, exactly as its parser accepts it. */
export const ALLOW_DECISION_TEXT = '{"risk":"low","decision":"allow"}'

/** State key carrying the environment's working directory. */
export const CWD_STATE_KEY = 'cwd'

/** State key carrying the pending action. */
export const ACTION_STATE_KEY = 'pending_action'

/** State key carrying the sourced project instructions. */
export const PROJECT_INSTRUCTIONS_STATE_KEY = 'project_instructions'

/** State key carrying the reviewer's filtered history. */
export const FILTERED_HISTORY_STATE_KEY = 'filtered_history'

/** State key each selected section contributes. */
const SECTION_STATE_KEYS: Readonly<Record<StateSectionName, string>> = {
  'environment': CWD_STATE_KEY,
  'project-instructions': PROJECT_INSTRUCTIONS_STATE_KEY,
  'filtered-history': FILTERED_HISTORY_STATE_KEY,
  'pending-action': ACTION_STATE_KEY,
}

/** One question and the state it judges. */
export interface JudgeInput {
  /** Flat state object whose keys the question references in backticks. */
  readonly state: Record<string, unknown>
  /** The single yes/no question asked about that state. */
  readonly question: NoulQuestion
}

/**
 * Build the state and question for one pending action.
 * @param sections - the review request's parsed sections.
 * @param stateSections - the sections the deployment forwards.
 * @returns the judge input, or `undefined` when the action or a selected
 *   section is missing or shapeless (the caller escalates).
 */
export function buildJudgeInput(
  sections: Readonly<Partial<Record<StateSectionName, unknown>>>,
  stateSections: readonly StateSectionName[],
): JudgeInput | undefined {
  const action = sections['pending-action']
  if (action === undefined) return undefined
  const state: Record<string, unknown> = { [ACTION_STATE_KEY]: action }
  const context: string[] = []
  for (const name of stateSections) {
    if (name === 'pending-action') continue
    const value = sections[name]
    if (value === undefined) return undefined
    const key = SECTION_STATE_KEYS[name]
    if (name === 'environment') {
      const cwd = readCwd(value)
      if (cwd === undefined) return undefined
      state[key] = { [CWD_STATE_KEY]: cwd }
    } else {
      state[key] = value
    }
    context.push(`\`${key}\``)
  }
  return { state, question: allowQuestion(context) }
}

/**
 * Whether a verdict may replace the reviewer's own model call.
 * @param actionName - the pending action's tool name.
 * @param allowTools - the deployment's approved tool names.
 * @param probability - the model's probability that the answer is yes.
 * @param minProbability - the deployment's threshold, inclusive.
 * @returns whether this call takes the fast path.
 */
export function mayFastPath(
  actionName: string,
  allowTools: readonly string[],
  probability: number,
  minProbability: number,
): boolean {
  return allowTools.includes(actionName) && probability >= minProbability
}

/**
 * Build the reviewer answer that skips its model call.
 * @returns the chunks the reviewer's reader consumes, in stream order.
 */
export function allowChunks(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: ALLOW_DECISION_TEXT },
    { type: 'block-end', index: 0, block: { type: 'text', text: ALLOW_DECISION_TEXT } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Key one judge input for verdict reuse.
 * @param state - the state that was judged.
 * @returns a stable hex digest of the state's JSON.
 */
export function verdictCacheKey(state: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}

/** Bounded verdict memory keyed by {@link verdictCacheKey}. */
export class VerdictCache {
  private readonly entries = new Map<string, number>()

  /**
   * @param maxEntries - the greatest number of verdicts retained.
   */
  constructor(private readonly maxEntries: number) {}

  /**
   * Read one remembered probability.
   * @param key - a {@link verdictCacheKey}.
   * @returns the probability, or `undefined` when it is not remembered.
   */
  get(key: string): number | undefined {
    const probability = this.entries.get(key)
    if (probability === undefined) return undefined
    // Refresh insertion order so the bound evicts the least recently read.
    this.entries.delete(key)
    this.entries.set(key, probability)
    return probability
  }

  /**
   * Remember one probability, evicting the least recently read beyond the bound.
   * @param key - a {@link verdictCacheKey}.
   * @param probability - the answered probability.
   */
  set(key: string, probability: number): void {
    this.entries.delete(key)
    this.entries.set(key, probability)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      /* v8 ignore next -- the loop condition guarantees a first entry */
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }
}

/**
 * Read the working directory out of an `ENVIRONMENT` section.
 * @param value - the parsed section.
 * @returns the directory, or `undefined` when the section is shapeless.
 */
function readCwd(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const cwd = (value as { readonly cwd?: unknown }).cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Compose the one question the fast path asks.
 * @param context - backticked names of the state keys that accompany the action.
 * @returns the question and its two rubrics.
 */
function allowQuestion(context: readonly string[]): NoulQuestion {
  const available = context.length === 0 ? '' : ` Context available to you: ${context.join(', ')}.`
  return {
    type: 'noul',
    instructions: `\`${ACTION_STATE_KEY}\` is one tool call an AI coding agent is about to make. `
      + `Decide whether \`${ACTION_STATE_KEY}\` has only ordinary, non-destructive, project-local read effects: `
      + 'it reads inside the project, changes nothing, touches no credentials, secrets or private user data, '
      + `reaches no remote or production system, and sends nothing to an external destination.${available}`,
    criteria: {
      true: 'An ordinary project-local read of the workspace that any developer would consider routine.',
      false: 'Anything else, including a write, deletion, install, download, network send, credential or secret '
        + 'access, production or remote target, or an effect that is ambiguous or broader than the project.',
    },
  }
}
