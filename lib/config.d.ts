/**
 * Configuration schema and resolution for the Jev cascade.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/config
 */
import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ResolvedConfig, StateSectionName } from './types.ts';
/** Environment variable read when the config carries no API key. */
export declare const API_KEY_ENV = "TYPESAFE_API_KEY";
/** The public TypeSafe evaluation endpoint's base. */
export declare const DEFAULT_BASE_URL = "https://api.typesafe.ai";
/** TypeSafe's flagship System One model alias. */
export declare const DEFAULT_MODEL = "jev-latest";
/**
 * End-to-end budget for one System One call. The call sits in front of every
 * allowed tool call, so a stalled endpoint must cost less than the reviewer
 * call it replaces; an expired budget escalates instead of answering.
 */
export declare const DEFAULT_TIMEOUT_MS = 800;
/** Verdict memory is opt-in: a deployment owns reuse across identical actions. */
export declare const DEFAULT_CACHE = false;
/** Bound on remembered verdicts; only read while {@link DEFAULT_CACHE} is overridden. */
export declare const DEFAULT_CACHE_MAX_ENTRIES = 512;
/**
 * Sections sent by default: the action itself and the environment it runs in.
 * The filtered history is the largest and most sensitive section, so a
 * deployment opts into sending it.
 */
export declare const DEFAULT_STATE_SECTIONS: readonly StateSectionName[];
/** Every state section a deployment may select. */
export declare const STATE_SECTION_NAMES: readonly StateSectionName[];
/**
 * Whether the local verdict document is written by default. It is a diagnostic
 * artifact: a deployment that does not want a file per profile turns it off.
 */
export declare const DEFAULT_STATS = true;
/** File name of the verdict document inside its directory. */
export declare const STATS_FILENAME = "stats.json";
/**
 * One Config field that may arrive as a live volatile reference. The Loader
 * resolves `.volatile()` schema fields into references; direct calls (tests,
 * the composition suite) pass plain values. Every payload shape is accepted
 * everywhere: a reference may also read `undefined` while an optional field
 * is unset, and `Volatile<T>` is assignable to `Volatile<T | undefined>`.
 */
export type Live<T> = T | Volatile<T | undefined>;
/** Plugin configuration as written in a profile's `cordis.yml`. */
export interface Config {
    /** TypeSafe API key; falls back to `$TYPESAFE_API_KEY`. Absent or empty leaves the plugin inert. Hot-editable. */
    apiKey?: Live<string>;
    /** Endpoint base; `/v1/systemone` is appended. Defaults to the public API. Hot-editable. */
    baseURL?: Live<string>;
    /** System One model id. Defaults to `jev-latest`. Hot-editable. */
    model?: Live<string>;
    /**
     * Tool names whose routine calls this plugin may answer on its own. Required:
     * the deployment names the narrow set it trusts, and an empty list keeps every
     * call with the language-model reviewer. Hot-editable.
     */
    allowTools: Live<string[]>;
    /**
     * Probability at or above which the model's `noul` yes short-circuits the
     * reviewer. Required: no default threshold is defensible without the
     * deployment's own trace data. Hot-editable.
     */
    minProbability: Live<number>;
    /** End-to-end budget for one System One call, in milliseconds. Defaults to 800. Hot-editable. */
    timeoutMs?: Live<number>;
    /** Reuse a verdict for an identical pending action. Defaults to false. Hot-editable. */
    cache?: Live<boolean>;
    /** Upper bound on remembered verdicts. Defaults to 512. Hot-editable. */
    cacheMaxEntries?: Live<number>;
    /** Sections forwarded as state. Defaults to the environment and the pending action. Hot-editable. */
    stateSections?: Live<StateSectionName[]>;
    /** Write the local verdict document. Defaults to true. Changing it remounts the plugin. */
    stats?: boolean;
    /** Verdict document path. Defaults to `<dsh home>/jev-auto-review/stats.json`. Changing it remounts the plugin. */
    statsPath?: string;
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
export declare const Config: z<any, Config>;
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
export declare function resolveConfig(config: Config, apiKeyFromEnvironment?: string): ResolvedConfig;
//# sourceMappingURL=config.d.ts.map