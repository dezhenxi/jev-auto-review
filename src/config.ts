/**
 * Configuration schema and resolution for the Jev cascade.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/config
 */

import { join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
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

/**
 * Whether the local verdict document is written by default. It is a diagnostic
 * artifact: a deployment that does not want a file per profile turns it off.
 */
export const DEFAULT_STATS = true

/** File name of the verdict document inside its directory. */
export const STATS_FILENAME = 'stats.json'

/**
 * One Config field that may arrive as a live volatile reference. The Loader
 * resolves `.volatile()` schema fields into references; direct calls (tests,
 * the composition suite) pass plain values. Every payload shape is accepted
 * everywhere: a reference may also read `undefined` while an optional field
 * is unset, and `Volatile<T>` is assignable to `Volatile<T | undefined>`.
 */
export type Live<T> = T | Volatile<T | undefined>

/** Read one field's current value, materializing a volatile reference in place. */
function materialize<T>(value: Live<T> | undefined): T | undefined {
  if (value === undefined) return undefined
  return (isVolatile(value) ? value.get() : value) as T
}

/** Plugin configuration as written in a profile's `cordis.yml`. */
export interface Config {
  /** TypeSafe API key; falls back to `$TYPESAFE_API_KEY`. Absent or empty leaves the plugin inert. Hot-editable. */
  apiKey?: Live<string>
  /** Endpoint base; `/v1/systemone` is appended. Defaults to the public API. Hot-editable. */
  baseURL?: Live<string>
  /** System One model id. Defaults to `jev-latest`. Hot-editable. */
  model?: Live<string>
  /**
   * Tool names whose routine calls this plugin may answer on its own. Required:
   * the deployment names the narrow set it trusts, and an empty list keeps every
   * call with the language-model reviewer. Hot-editable.
   */
  allowTools: Live<string[]>
  /**
   * Probability at or above which the model's `noul` yes short-circuits the
   * reviewer. Required: no default threshold is defensible without the
   * deployment's own trace data. Hot-editable.
   */
  minProbability: Live<number>
  /** End-to-end budget for one System One call, in milliseconds. Defaults to 800. Hot-editable. */
  timeoutMs?: Live<number>
  /** Reuse a verdict for an identical pending action. Defaults to false. Hot-editable. */
  cache?: Live<boolean>
  /** Upper bound on remembered verdicts. Defaults to 512. Hot-editable. */
  cacheMaxEntries?: Live<number>
  /** Sections forwarded as state. Defaults to the environment and the pending action. Hot-editable. */
  stateSections?: Live<StateSectionName[]>
  /** Write the local verdict document. Defaults to true. Changing it remounts the plugin. */
  stats?: boolean
  /** Verdict document path. Defaults to `<dsh home>/jev-auto-review/stats.json`. Changing it remounts the plugin. */
  statsPath?: string
}

/**
 * Schemastery schema for {@link Config}. The nine tunable fields are declared
 * `.volatile()`, which is what projects them into the Settings form (the
 * projection only surfaces volatile fields) and lets the plugin read them live
 * per request. `stats` and `statsPath` own the verdict document built in
 * `apply`, so they stay ordinary and remount the plugin on change.
 *
 * The declared type is `Schema<any, Config>`: the raw profile input is
 * unconstrained (validation happens at runtime), while the resolved output is
 * the {@link Config} contract. A two-sided `Schema<Config>` cannot hold — its
 * contravariant input positions demand plain values, and its covariant output
 * positions demand live references.
 */
export const Config: z<any, Config> = z.object({
  apiKey: z.string().role('secret').volatile()
    .description('TypeSafe API 密钥。留空时读取启动环境变量 TYPESAFE_API_KEY。没有密钥时插件保持惰性，所有调用走语言模型审查者。'),
  baseURL: z.string().volatile()
    .description('TypeSafe 端点基址，程序自动追加 /v1/systemone。默认 https://api.typesafe.ai。自建网关在此修改。'),
  model: z.string().volatile()
    .description('System One 模型标识。默认 jev-latest。需要固定版本时在此填写，例如 jev-1.14。'),
  allowTools: z.array(z.string()).required().volatile()
    .description('允许快速通路独立作答的工具名单。只放真正只读的工具，例如 read、glob、grep。空数组表示全部走审查者。'),
  minProbability: z.number().min(0).max(1).role('slider').required().volatile()
    .description('当 noul 回答为是的概率不低于该阈值时跳过审查者。默认 0.98。越高越保守，越低越激进。'),
  timeoutMs: z.natural().role('ms').volatile()
    .description('单次 System One 调用的端到端预算，单位毫秒。超时则升级给审查者。默认 800。'),
  cache: z.boolean().volatile()
    .description('是否对完全相同的待执行动作复用结论。默认关闭。开启后可减少重复提问，但跨会话也可能复用。'),
  cacheMaxEntries: z.natural().volatile()
    .description('结论缓存条数上限。默认 512。仅在开启缓存时生效。'),
  stateSections: z.array(z.union(STATE_SECTION_NAMES)).default([...DEFAULT_STATE_SECTIONS]).volatile()
    .description('作为 state 转发给 System One 的审查请求段。默认只发 environment 和 pending-action。filtered-history 最大最敏感，按需开启。'),
  stats: z.boolean()
    .description('是否在本地写入 verdict 统计文档。默认开启，用于在轨迹之外查看插件实际作用。修改后需重启插件生效。'),
  statsPath: z.string()
    .description('verdict 统计文档路径。默认写入 DSH 家目录下 jev-auto-review/stats.json。修改后需重启插件生效。'),
})

/**
 * Validate one configuration and fill its unset defaults. Volatile references
 * are materialized at the moment of the call, so re-running this function
 * observes live edits; the caller re-runs it per request for hot fields.
 * @param config - raw plugin configuration; volatile references and plain
 *   values are both accepted.
 * @param apiKeyFromEnvironment - credential resolved from the launch environment,
 *   used when the configuration names none.
 * @returns a detached deeply immutable configuration.
 * @throws when a required field is absent, the base URL is not an absolute
 *   HTTP(S) URL, a budget is not a positive integer, the threshold is not a
 *   finite unit-interval number, or no valid state section remains.
 */
export function resolveConfig(config: Config, apiKeyFromEnvironment?: string): ResolvedConfig {
  const configuredKey = materialize(config.apiKey) ?? ''
  const allowTools = materialize(config.allowTools)
  if (allowTools === undefined) throw new Error('JevAutoReviewConfig: allowTools is required (a list of tool names)')
  const minProbability = materialize(config.minProbability)
  if (minProbability === undefined) {
    throw new Error('JevAutoReviewConfig: minProbability is required (a finite number within 0 and 1)')
  }
  const stateSections = materialize(config.stateSections)
  const resolved = {
    apiKey: configuredKey.length > 0 ? configuredKey : apiKeyFromEnvironment ?? '',
    baseURL: materialize(config.baseURL) ?? DEFAULT_BASE_URL,
    model: materialize(config.model) ?? DEFAULT_MODEL,
    allowTools: [...new Set(allowTools.map(tool => tool.trim()))].filter(tool => tool.length > 0),
    minProbability,
    timeoutMs: materialize(config.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    cache: materialize(config.cache) ?? DEFAULT_CACHE,
    cacheMaxEntries: materialize(config.cacheMaxEntries) ?? DEFAULT_CACHE_MAX_ENTRIES,
    stateSections: [...new Set(stateSections ?? [...DEFAULT_STATE_SECTIONS])],
    stats: config.stats ?? DEFAULT_STATS,
    statsPath: config.statsPath ?? join(resolveDshHome(), 'jev-auto-review', STATS_FILENAME),
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
