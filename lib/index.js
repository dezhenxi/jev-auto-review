/**
 * Jev-first cascade judge for the Auto permission preset.
 *
 * The shipped Auto review integration decides every supported tool call with one
 * language-model request. This plugin observes the same integration's model call
 * on `llm/stream`, recognizes it, and answers the routine ones from a TypeSafe
 * System One model. Only a deployment-approved tool whose action the System One
 * model judges to be an ordinary project-local read is answered; every other
 * call — an unapproved tool, a low probability, a missing key, a transport or
 * parse failure, a cancellation — delegates to the language-model reviewer
 * unchanged. The plugin never denies and never answers medium or high risk.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review
 */
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { API_KEY_ENV, resolveConfig } from "./config.js";
import { allowChunks, buildJudgeInput, mayFastPath, VerdictCache, verdictCacheKey } from "./decision.js";
import { JevClient } from "./jev-client.js";
import { pendingActionName, REVIEW_POLICY_PREFIX, reviewRequestOf } from "./review-request.js";
import { JevStats } from "./stats.js";
export { Config } from "./config.js";
/** `telemetry.op` attribute of every operational record this plugin emits. */
export const TELEMETRY_OP = 'jev-auto-review/verdict';
/** Cordis plugin name used by loader diagnostics. */
export const name = 'jev-auto-review';
/**
 * The LLM service this plugin observes. Declaring it also orders activation
 * after the service's own `llm/stream` grammar invariant, so that invariant
 * wraps the stream this plugin synthesizes.
 */
export const inject = ['llm'];
/**
 * Install the cascade judge over every authorization-review model call.
 * @param ctx - the plugin's context; the listener is scoped to its effect.
 * @param config - raw plugin configuration from the profile.
 */
export function apply(ctx, config) {
    const apiKeyFromEnvironment = launchEnvironmentOf(ctx).get(API_KEY_ENV)?.value;
    /* Mount-time resolution owns the stats document: `stats` and `statsPath` are
       ordinary fields, and changing them remounts the plugin. */
    const mounted = resolveConfig(config, apiKeyFromEnvironment);
    if (!mounted.apiKey) {
        ctx.logger.warn(`jev-auto-review: no TypeSafe API key (config apiKey or $${API_KEY_ENV}); `
            + 'every reviewed call stays with the language-model reviewer until one is configured '
            + 'on the plugin\'s settings page or in the environment');
    }
    const lifecycle = new AbortController();
    const active = new Set();
    let answered = 0;
    /* The tunable fields are volatile and read live per request; a connection-shape
       change rebuilds the client, and a cache-shape change rebuilds the cache. */
    let client = new JevClient({
        baseURL: mounted.baseURL,
        apiKey: mounted.apiKey,
        model: mounted.model,
        timeoutMs: mounted.timeoutMs,
    });
    let connection = connectionKeyOf(mounted);
    let cache;
    let cacheBound;
    /** One stable identity of the client-shaping fields. */
    function connectionKeyOf(resolved) {
        return JSON.stringify([resolved.baseURL, resolved.apiKey, resolved.model, resolved.timeoutMs]);
    }
    /** Rebuild the client when the live connection fields changed since the last request. */
    function ensureClient(resolved) {
        const key = connectionKeyOf(resolved);
        if (key === connection)
            return;
        connection = key;
        client = new JevClient({
            baseURL: resolved.baseURL,
            apiKey: resolved.apiKey,
            model: resolved.model,
            timeoutMs: resolved.timeoutMs,
        });
    }
    /** The request's verdict cache; `undefined` while caching is off. */
    function cacheFor(resolved) {
        if (!resolved.cache)
            return undefined;
        if (cache === undefined || cacheBound !== resolved.cacheMaxEntries) {
            cache = new VerdictCache(resolved.cacheMaxEntries);
            cacheBound = resolved.cacheMaxEntries;
        }
        return cache;
    }
    const stats = mounted.stats
        ? new JevStats({
            file: mounted.statsPath,
            onError: (error) => {
                ctx.logger.debug(`jev-auto-review: verdict document not written (${String(error)})`);
            },
        })
        : undefined;
    /**
     * Read the live volatile configuration. Validation failure fails closed:
     * the caller escalates to the reviewer instead of answering.
     */
    const readLive = () => {
        try {
            return resolveConfig(config, apiKeyFromEnvironment);
        }
        catch (error) {
            ctx.logger.debug(`jev-auto-review: live configuration rejected (${String(error)}); escalated`);
            return undefined;
        }
    };
    /**
     * Count one verdict and hand it to the telemetry backend. Both are
     * best-effort: a diagnostic must never change what the reviewer decides.
     */
    const countVerdict = (entry, extra = {}) => {
        stats?.record(entry);
        const snapshot = stats?.snapshot();
        const totals = snapshot?.totals;
        if (entry.verdict === 'answered') {
            const answeredTotal = totals?.answered ?? 0;
            if (answeredTotal === 1 || answeredTotal % 20 === 0) {
                ctx.logger.info(`jev-auto-review: fast path answered ${answeredTotal} routine call(s) without the language-model reviewer `
                    + `(latest: ${entry.tool}, p=${entry.probability?.toFixed(4) ?? 'n/a'}). `
                    + `Totals: answered=${totals?.answered ?? 0}, escalated=${totals?.escalated ?? 0}, unavailable=${totals?.unavailable ?? 0}. `
                    + `Detail: ${mounted.stats ? mounted.statsPath : 'stats off'}.`);
            }
        }
        const backend = ctx.get('sessionTelemetry');
        if (backend === undefined)
            return;
        try {
            backend.emit({
                channel: 'ops',
                time: Date.now(),
                severity: 'info',
                attributes: {
                    'telemetry.op': TELEMETRY_OP,
                    'tool': entry.tool,
                    'verdict': entry.verdict,
                    'cached': entry.cached ? 1 : 0,
                    'latency_ms': entry.latencyMs,
                    'model': extra.model ?? mounted.model,
                    ...extra.cwd === undefined ? {} : { 'session.cwd': extra.cwd },
                    ...entry.probability === undefined ? {} : { 'probability': entry.probability },
                    ...Object.fromEntries(Object.entries(totals ?? {})
                        .map(([kind, count]) => [`total.${kind}`, count])),
                },
                body: snapshot,
            });
        }
        catch (error) {
            // A reporting backend must not reach the review path.
            ctx.logger.debug(`jev-auto-review: telemetry record not emitted (${String(error)})`);
        }
    };
    /** Track one in-flight System One call so disposal can wait for it. */
    const judgeTracked = (state, question, signal) => {
        const promise = client.judge(state, question, signal);
        active.add(promise);
        const settle = () => active.delete(promise);
        void promise.then(settle, settle);
        return promise;
    };
    /**
     * Try to answer one review request without the language model.
     * @param request - the recognized review request.
     * @param actionName - the pending action's tool name.
     * @param live - the volatile configuration read for this request.
     * @returns whether the fast path applies; any failure is `false`.
     */
    const attemptFastPath = async (request, actionName, live) => {
        const startedAt = Date.now();
        try {
            ensureClient(live);
            const input = buildJudgeInput(request.sections, live.stateSections);
            /* v8 ignore next 2 -- the shipped reviewer renders every section on every request; this abstains only if one stops being rendered. */
            if (input === undefined)
                return false;
            const verdicts = cacheFor(live);
            const key = verdicts === undefined ? undefined : verdictCacheKey(input.state);
            let probability = key === undefined ? undefined : verdicts?.get(key);
            let cached = probability !== undefined;
            if (probability === undefined) {
                const signal = request.signal === undefined
                    ? lifecycle.signal
                    : AbortSignal.any([request.signal, lifecycle.signal]);
                probability = await judgeTracked(input.state, input.question, signal);
                if (probability !== undefined && key !== undefined)
                    verdicts?.set(key, probability);
                cached = false;
            }
            const allowed = probability !== undefined
                && mayFastPath(actionName, live.allowTools, probability, live.minProbability);
            ctx.logger.debug(`jev-auto-review: ${actionName} -> ${allowed ? 'answered' : 'escalated'} `
                + `(p=${probability === undefined ? 'unavailable' : probability.toFixed(4)}, cached=${String(cached)})`);
            const environment = request.sections['environment'];
            const cwd = typeof environment === 'object' && environment !== null && !Array.isArray(environment)
                ? environment.cwd
                : undefined;
            countVerdict({
                tool: actionName,
                verdict: probability === undefined ? 'unavailable' : allowed ? 'answered' : 'escalated',
                ...probability === undefined ? {} : { probability },
                cached,
                latencyMs: Date.now() - startedAt,
            }, {
                model: live.model,
                ...typeof cwd === 'string' ? { cwd } : {},
            });
            return allowed;
            /* v8 ignore start -- defensive: JevClient never throws by contract; this arm contains an unexpected fault only. */
        }
        catch (error) {
            // The reviewer owns every decision this plugin cannot make.
            ctx.logger.debug(`jev-auto-review: ${actionName} escalated after ${String(error)}`);
            countVerdict({ tool: actionName, verdict: 'unavailable', cached: false, latencyMs: Date.now() - startedAt });
            return false;
        }
        /* v8 ignore stop */
    };
    ctx.effect(function* () {
        const stop = ctx.on('llm/stream', (options, next) => {
            const request = reviewRequestOf(options);
            if (request === undefined) {
                if (typeof options.system === 'string' && options.system.startsWith(REVIEW_POLICY_PREFIX)) {
                    ctx.logger.debug('jev-auto-review: review-shaped request did not match the strict recognizer; '
                        + `escalated (temperature=${String(options.temperature)}, messages=${options.messages.length}, `
                        + `tools=${options.tools?.length ?? 0})`);
                }
                return next();
            }
            const actionName = pendingActionName(request.sections);
            const live = readLive();
            if (live === undefined)
                return next();
            if (actionName === undefined || !live.allowTools.includes(actionName))
                return next();
            return (async function* cascade() {
                if (!await attemptFastPath(request, actionName, live)) {
                    yield* next();
                    return;
                }
                answered += 1;
                if (answered === 1) {
                    ctx.logger.info(`jev-auto-review: answering "${actionName}" without the language-model reviewer `
                        + `(p >= ${live.minProbability})`);
                }
                yield* allowChunks();
            })();
        }, { global: true });
        yield stop;
        yield async () => {
            lifecycle.abort(new Error('jev-auto-review integration disposed'));
            await Promise.allSettled([...active]);
            // The verdict document is written off the hot path, so disposal owns its
            // settlement: a reload must not leave a half-written file behind.
            await stats?.flush();
        };
    }, 'jev-auto-review lifecycle');
}
//# sourceMappingURL=index.js.map