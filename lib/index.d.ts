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
import type { Context } from '@deepseek-ai/cordis';
import { type Config } from './config.ts';
export { Config } from './config.ts';
export type { StateSectionName } from './types.ts';
/** `telemetry.op` attribute of every operational record this plugin emits. */
export declare const TELEMETRY_OP = "jev-auto-review/verdict";
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "jev-auto-review";
/**
 * The LLM service this plugin observes. Declaring it also orders activation
 * after the service's own `llm/stream` grammar invariant, so that invariant
 * wraps the stream this plugin synthesizes.
 */
export declare const inject: string[];
/**
 * Install the cascade judge over every authorization-review model call.
 * @param ctx - the plugin's context; the listener is scoped to its effect.
 * @param config - raw plugin configuration from the profile.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map