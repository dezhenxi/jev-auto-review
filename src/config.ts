/**
 * Configuration schema and resolution for the Jev cascade.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/config
 */

import z from '@deepseek-ai/schemastery'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { ResolvedConfig, StateSectionName } from './types.ts'

/** Environment variable read when the config carries no API key. */
export const API_KEY_ENV = 'TYPESAFE_API_KEY'

/** The public TypeSafe evaluation endpoint's base. */
export const DEFAULT_BASE_URL = 'https://api.typesafe.ai'

/** TypeSafe's flagship System One model alias. */
export const DEFAULT_MODEL = 'jev-latest'

/**
 * End-to-end budget for one System One call. The call sits in front of every
 * allowed tool call, so a stalled endpoint must cost less than the reviewer
 * call it replaces; an expired budget escalates instead of answering.
 */
export const DEFAULT_TIMEOUT_MS = 800

/** Verdict memory is opt-in: a deployment owns reuse across identical actions. */
export const DEFAULT_CACHE = false

/** Bound on remembered verdicts; only read while {@link DEFAULT_CACHE} is overridden. */
export const DEFAULT_CACHE_MAX_ENTRIES = 512

/**
 * Sections sent by default: the action itself and the environment it runs in.
 * The filtered history is the largest and most sensitive section, so a
 * deployment opts into sending it.
 */
export const DEFAULT_STATE_SECTIONS: readonly StateSectionName[] = deepFreeze([
  'environment',
  'pending-action',
])

/** Every state section a deployment may select. */
export const STATE_SECTION_NAMES: readonly StateSectionName[] = deepFreeze([
  'environment',
  'project-instructions',
  'filtered-history',
  'pending-action',
])

/** Plugin configuration as written in a profile's `cordis.yml`. */
export interface Config {
  /** TypeSafe API key; falls back to `$TYPESAFE_API_KEY`. Absent or empty leaves the plugin inert. */
  apiKey?: string
  /** Endpoint base; `/v1/systemone` is appended. Defaults to the public API. */
  baseURL?: string
  /** System One model id. Defaults to `jev-latest`. */
  model?: string
  /**
   * Tool names whose routine calls this plugin may answer on its own. Required:
   * the deployment names the narrow set it trusts, and an empty list keeps every
   * call with the language-model reviewer.
   */
  allowTools: string[]
  /**
   * Probability at or above which the model's `noul` yes short-circuits the
   * reviewer. Required: no default threshold is defensible without the
   * deployment's own trace data.
   */
  minProbability: number
  /** End-to-end budget for one System One call, in milliseconds. Defaults to 800. */
  timeoutMs?: number
  /** Reuse a verdict for an identical pending action. Defaults to false. */
  cache?: boolean
  /** Upper bound on remembered verdicts. Defaults to 512. */
  cacheMaxEntries?: number
  /** Sections forwarded as state. Defaults to the environment and the pending action. */
  stateSections?: StateSectionName[]
}

/** Schemastery schema for {@link Config}. */
export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  baseURL: z.string(),
  model: z.string(),
  allowTools: z.array(z.string()).required(),
  minProbability: z.number().min(0).max(1).required(),
  timeoutMs: z.natural().role('ms'),
  cache: z.boolean(),
  cacheMaxEntries: z.natural(),
  stateSections: z.array(z.union(STATE_SECTION_NAMES)).default([...DEFAULT_STATE_SECTIONS]),
})

/**
 * Validate one configuration and fill its unset defaults.
 * @param config - raw plugin configuration.
 * @param apiKeyFromEnvironment - credential resolved from the launch environment,
 *   used when the configuration names none.
 * @returns a detached deeply immutable configuration.
 * @throws when the base URL is not an absolute HTTP(S) URL, a budget is not a
 *   positive integer, the threshold is not a finite unit-interval number, or no
 *   state section remains.
 */
export function resolveConfig(config: Config, apiKeyFromEnvironment?: string): ResolvedConfig {
  const configuredKey = config.apiKey ?? ''
  const resolved = {
    apiKey: configuredKey.length > 0 ? configuredKey : apiKeyFromEnvironment ?? '',
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    allowTools: [...new Set(config.allowTools.map(tool => tool.trim()))].filter(tool => tool.length > 0),
    minProbability: config.minProbability,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cache: config.cache ?? DEFAULT_CACHE,
    cacheMaxEntries: config.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
    stateSections: [...new Set(config.stateSections ?? DEFAULT_STATE_SECTIONS)],
  }
  assertAbsoluteHttpUrl(resolved.baseURL)
  assertNonEmpty(resolved.model, 'model')
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  assertPositiveInteger('cacheMaxEntries', resolved.cacheMaxEntries)
  if (resolved.stateSections.length === 0) {
    throw new Error(
      'JevAutoReviewConfig: stateSections must name at least one section; '
      + `an empty list sends no state and can never answer (allowed: ${STATE_SECTION_NAMES.join(', ')})`,
    )
  }
  if (!resolved.stateSections.includes('pending-action')) {
    throw new Error(
      'JevAutoReviewConfig: stateSections must include "pending-action"; '
      + 'the question is about the pending action, so omitting it can never answer',
    )
  }
  if (!Number.isFinite(resolved.minProbability)
    || resolved.minProbability < 0 || resolved.minProbability > 1) {
    throw new Error(`JevAutoReviewConfig: minProbability (${String(resolved.minProbability)}) must be within 0 and 1`)
  }
  return deepFreeze(structuredClone(resolved))
}

function assertAbsoluteHttpUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`JevAutoReviewConfig: baseURL (${value}) must be an absolute URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`JevAutoReviewConfig: baseURL (${value}) must use http or https`)
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.length === 0) throw new Error(`JevAutoReviewConfig: ${name} must not be empty`)
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`JevAutoReviewConfig: ${name} (${value}) must be a positive integer`)
  }
}
