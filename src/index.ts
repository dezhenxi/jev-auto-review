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

import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { API_KEY_ENV, resolveConfig, type Config } from './config.ts'
import { allowChunks, buildJudgeInput, mayFastPath, VerdictCache, verdictCacheKey } from './decision.ts'
import { JevClient } from './jev-client.ts'
import { pendingActionName, reviewRequestOf } from './review-request.ts'
import type { ReviewRequest, NoulQuestion } from './types.ts'

export { Config } from './config.ts'
export type { StateSectionName } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'jev-auto-review'

/**
 * The LLM service this plugin observes. Declaring it also orders activation
 * after the service's own `llm/stream` grammar invariant, so that invariant
 * wraps the stream this plugin synthesizes.
 */
export const inject = ['llm']

/**
 * Install the cascade judge over every authorization-review model call.
 * @param ctx - the plugin's context; the listener is scoped to its effect.
 * @param config - raw plugin configuration from the profile.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config, launchEnvironmentOf(ctx).get(API_KEY_ENV)?.value)
  const client = new JevClient({
    baseURL: resolved.baseURL,
    apiKey: resolved.apiKey,
    model: resolved.model,
    timeoutMs: resolved.timeoutMs,
  })
  if (!client.available()) {
    ctx.logger.warn(
      `jev-auto-review: no TypeSafe API key (config apiKey or $${API_KEY_ENV}); `
      + 'every reviewed call stays with the language-model reviewer',
    )
  }

  const lifecycle = new AbortController()
  const cache = resolved.cache ? new VerdictCache(resolved.cacheMaxEntries) : undefined
  const active = new Set<Promise<unknown>>()
  let answered = 0

  /** Track one in-flight System One call so disposal can wait for it. */
  const judgeTracked = (state: unknown, question: NoulQuestion, signal: AbortSignal) => {
    const promise = client.judge(state, question, signal)
    active.add(promise)
    const settle = () => active.delete(promise)
    void promise.then(settle, settle)
    return promise
  }

  /**
   * Try to answer one review request without the language model.
   * @returns whether the fast path applies; any failure is `false`.
   */
  const attemptFastPath = async (request: ReviewRequest, actionName: string): Promise<boolean> => {
    try {
      const input = buildJudgeInput(request.sections, resolved.stateSections)
      /* v8 ignore next 2 -- the shipped reviewer renders every section on every request; this abstains only if one stops being rendered. */
      if (input === undefined) return false
      const key = cache === undefined ? undefined : verdictCacheKey(input.state)
      let probability = key === undefined ? undefined : cache?.get(key)
      let cached = probability !== undefined
      if (probability === undefined) {
        const signal = request.signal === undefined
          ? lifecycle.signal
          : AbortSignal.any([request.signal, lifecycle.signal])
        probability = await judgeTracked(input.state, input.question, signal)
        if (probability !== undefined && key !== undefined) cache?.set(key, probability)
        cached = false
      }
      const allowed = probability !== undefined
        && mayFastPath(actionName, resolved.allowTools, probability, resolved.minProbability)
      ctx.logger.debug(
        `jev-auto-review: ${actionName} -> ${allowed ? 'answered' : 'escalated'} `
        + `(p=${probability === undefined ? 'unavailable' : probability.toFixed(4)}, cached=${String(cached)})`,
      )
      return allowed
    /* v8 ignore start -- defensive: JevClient never throws by contract; this arm contains an unexpected fault only. */
    } catch (error: unknown) {
      // The reviewer owns every decision this plugin cannot make.
      ctx.logger.debug(`jev-auto-review: ${actionName} escalated after ${String(error)}`)
      return false
    }
    /* v8 ignore stop */
  }

  ctx.effect(function* () {
    const stop = ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
      const request = reviewRequestOf(options)
      if (request === undefined) return next()
      const actionName = pendingActionName(request.sections)
      if (actionName === undefined || !resolved.allowTools.includes(actionName)) return next()
      return (async function* cascade(): AsyncIterable<StreamChunk> {
        if (!await attemptFastPath(request, actionName)) {
          yield* next()
          return
        }
        answered += 1
        if (answered === 1) {
          ctx.logger.info(
            `jev-auto-review: answering "${actionName}" without the language-model reviewer `
            + `(p >= ${resolved.minProbability})`,
          )
        }
        yield* allowChunks()
      })()
    }, { global: true })
    yield stop
    yield async () => {
      lifecycle.abort(new Error('jev-auto-review integration disposed'))
      await Promise.allSettled([...active])
    }
  }, 'jev-auto-review lifecycle')
}
