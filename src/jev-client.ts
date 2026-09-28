/**
 * TypeSafe System One client: one evaluation request answering one `noul`
 * question. Every failure — no key, transport, HTTP status, malformed or
 * out-of-range answer, timeout, cancellation — resolves to `undefined` so the
 * caller escalates to the language-model reviewer instead of deciding.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/jev-client
 */

import type { NoulQuestion } from './types.ts'

/** Path appended to the configured base URL. */
export const EVALUATION_PATH = '/v1/systemone'

/** Attribution header sent on every request. */
export const USER_AGENT = 'deepseek-harness-jev-auto-review'

/**
 * Bound on the response body read before parsing. The answers this client reads
 * are a handful of numbers; a larger body is a transport fault, not an answer.
 */
export const MAX_RESPONSE_CHARS = 65536

/** The question id the answer is read back under. */
export const QUESTION_ID = 'allow'

/** Resolved client options. */
export interface JevClientOptions {
  /** Endpoint base, without {@link EVALUATION_PATH}. */
  readonly baseURL: string
  /** Bearer credential; an empty key makes the client unavailable. */
  readonly apiKey: string
  /** System One model id. */
  readonly model: string
  /** End-to-end budget for one call, in milliseconds. */
  readonly timeoutMs: number
}

/** One System One evaluation client. */
export class JevClient {
  private readonly endpoint: string

  /**
   * @param options - resolved endpoint, credential, model, and budget.
   */
  constructor(private readonly options: JevClientOptions) {
    this.endpoint = `${options.baseURL.replace(/\/+$/, '')}${EVALUATION_PATH}`
  }

  /**
   * Whether a credential is configured.
   * @returns whether a request may be attempted at all.
   */
  available(): boolean {
    return this.options.apiKey.length > 0
  }

  /**
   * Ask one yes/no question about one state.
   * @param state - the content to evaluate; the caller owns which sections it carries.
   * @param question - the question to answer.
   * @param signal - the reviewer's own cancellation signal, when it has one.
   * @returns the probability the answer is yes, or `undefined` when this client
   *   cannot answer (the caller then escalates).
   */
  async judge(state: unknown, question: NoulQuestion, signal: AbortSignal | undefined): Promise<number | undefined> {
    if (!this.available()) return undefined
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          state,
          model: this.options.model,
          questions: { [QUESTION_ID]: question },
        }),
        // A credentialed request must never be forwarded to another origin.
        redirect: 'error',
        signal: composed,
      })
      if (!response.ok) return undefined
      const text = await response.text()
      if (text.length > MAX_RESPONSE_CHARS) return undefined
      return readNoul(JSON.parse(text))
    } catch {
      // Transport failure, timeout, cancellation, and a body that is not JSON
      // are one outcome for the caller: this client has no answer.
      return undefined
    }
  }
}

/**
 * Read the `noul` probability out of one response body.
 * @param body - the parsed response body.
 * @returns the probability within `[0, 1]`, or `undefined` for any other shape.
 */
function readNoul(body: unknown): number | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const answers = (body as { readonly answers?: unknown }).answers
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return undefined
  const answer = (answers as Record<string, unknown>)[QUESTION_ID]
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return undefined
  const record = answer as { readonly type?: unknown; readonly noul?: unknown }
  if (record.type !== 'noul' || typeof record.noul !== 'number') return undefined
  if (!Number.isFinite(record.noul) || record.noul < 0 || record.noul > 1) return undefined
  return record.noul
}
