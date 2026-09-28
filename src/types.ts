/**
 * Value types shared by the Jev cascade: the resolved plugin configuration, the
 * parsed review request, and the one question the System One model answers.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/types
 */

/**
 * One section of the authorization reviewer's request that this plugin may
 * forward to the System One model. The names are this plugin's own vocabulary;
 * {@link ReviewSectionName} maps them to the reviewer's rendered headings.
 */
export type StateSectionName =
  | 'environment'
  | 'project-instructions'
  | 'filtered-history'
  | 'pending-action'

/** Plugin configuration after defaults, validation, and a frozen deep copy. */
export interface ResolvedConfig {
  /** TypeSafe API key; `''` leaves the plugin inert. */
  readonly apiKey: string
  /** Endpoint base; `/v1/systemone` is appended. */
  readonly baseURL: string
  /** System One model id. */
  readonly model: string
  /** Tool names this plugin may answer without the language-model reviewer. */
  readonly allowTools: readonly string[]
  /** Probability at or above which a `noul` yes short-circuits the reviewer. */
  readonly minProbability: number
  /** End-to-end budget for one System One call, in milliseconds. */
  readonly timeoutMs: number
  /** Whether identical pending actions reuse a previous verdict. */
  readonly cache: boolean
  /** Upper bound on remembered verdicts while {@link ResolvedConfig.cache} is on. */
  readonly cacheMaxEntries: number
  /** Sections of the reviewer request forwarded as the System One model's state. */
  readonly stateSections: readonly StateSectionName[]
  /** Whether the local verdict document is written. */
  readonly stats: boolean
  /** Absolute path of the local verdict document. */
  readonly statsPath: string
}

/** One recognized authorization-review request and its parsed sections. */
export interface ReviewRequest {
  /** Cancellation signal the reviewer attached to its own request, when present. */
  readonly signal: AbortSignal | undefined
  /** Each section this plugin could parse; absent sections escalate. */
  readonly sections: Readonly<Partial<Record<StateSectionName, unknown>>>
}

/** A yes/no question in the System One request's `questions` map. */
export interface NoulQuestion {
  readonly type: 'noul'
  readonly instructions: string
  readonly criteria?: { readonly true: string; readonly false: string }
}
