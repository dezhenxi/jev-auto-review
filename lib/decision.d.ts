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
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import type { NoulQuestion, StateSectionName } from './types.ts';
/** The reviewer's low-risk allow, exactly as its parser accepts it. */
export declare const ALLOW_DECISION_TEXT = "{\"risk\":\"low\",\"decision\":\"allow\"}";
/** State key carrying the environment's working directory. */
export declare const CWD_STATE_KEY = "cwd";
/** State key carrying the pending action. */
export declare const ACTION_STATE_KEY = "pending_action";
/** State key carrying the sourced project instructions. */
export declare const PROJECT_INSTRUCTIONS_STATE_KEY = "project_instructions";
/** State key carrying the reviewer's filtered history. */
export declare const FILTERED_HISTORY_STATE_KEY = "filtered_history";
/** One question and the state it judges. */
export interface JudgeInput {
    /** Flat state object whose keys the question references in backticks. */
    readonly state: Record<string, unknown>;
    /** The single yes/no question asked about that state. */
    readonly question: NoulQuestion;
}
/**
 * Build the state and question for one pending action.
 * @param sections - the review request's parsed sections.
 * @param stateSections - the sections the deployment forwards.
 * @returns the judge input, or `undefined` when the action or a selected
 *   section is missing or shapeless (the caller escalates).
 */
export declare function buildJudgeInput(sections: Readonly<Partial<Record<StateSectionName, unknown>>>, stateSections: readonly StateSectionName[]): JudgeInput | undefined;
/**
 * Whether a verdict may replace the reviewer's own model call.
 * @param actionName - the pending action's tool name.
 * @param allowTools - the deployment's approved tool names.
 * @param probability - the model's probability that the answer is yes.
 * @param minProbability - the deployment's threshold, inclusive.
 * @returns whether this call takes the fast path.
 */
export declare function mayFastPath(actionName: string, allowTools: readonly string[], probability: number, minProbability: number): boolean;
/**
 * Build the reviewer answer that skips its model call.
 * @returns the chunks the reviewer's reader consumes, in stream order.
 */
export declare function allowChunks(): StreamChunk[];
/**
 * Key one judge input for verdict reuse.
 * @param state - the state that was judged.
 * @returns a stable hex digest of the state's JSON.
 */
export declare function verdictCacheKey(state: Record<string, unknown>): string;
/** Bounded verdict memory keyed by {@link verdictCacheKey}. */
export declare class VerdictCache {
    private readonly maxEntries;
    private readonly entries;
    /**
     * @param maxEntries - the greatest number of verdicts retained.
     */
    constructor(maxEntries: number);
    /**
     * Read one remembered probability.
     * @param key - a {@link verdictCacheKey}.
     * @returns the probability, or `undefined` when it is not remembered.
     */
    get(key: string): number | undefined;
    /**
     * Remember one probability, evicting the least recently read beyond the bound.
     * @param key - a {@link verdictCacheKey}.
     * @param probability - the answered probability.
     */
    set(key: string, probability: number): void;
}
//# sourceMappingURL=decision.d.ts.map