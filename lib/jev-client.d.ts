/**
 * TypeSafe System One client: one evaluation request answering one `noul`
 * question. Every failure — no key, transport, HTTP status, malformed or
 * out-of-range answer, timeout, cancellation — resolves to `undefined` so the
 * caller escalates to the language-model reviewer instead of deciding.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/jev-client
 */
import type { NoulQuestion } from './types.ts';
/** Path appended to the configured base URL. */
export declare const EVALUATION_PATH = "/v1/systemone";
/** Attribution header sent on every request. */
export declare const USER_AGENT = "deepseek-harness-jev-auto-review";
/**
 * Bound on the response body read before parsing. The answers this client reads
 * are a handful of numbers; a larger body is a transport fault, not an answer.
 */
export declare const MAX_RESPONSE_CHARS = 65536;
/** The question id the answer is read back under. */
export declare const QUESTION_ID = "allow";
/** Resolved client options. */
export interface JevClientOptions {
    /** Endpoint base, without {@link EVALUATION_PATH}. */
    readonly baseURL: string;
    /** Bearer credential; an empty key makes the client unavailable. */
    readonly apiKey: string;
    /** System One model id. */
    readonly model: string;
    /** End-to-end budget for one call, in milliseconds. */
    readonly timeoutMs: number;
}
/** One System One evaluation client. */
export declare class JevClient {
    private readonly options;
    private readonly endpoint;
    /**
     * @param options - resolved endpoint, credential, model, and budget.
     */
    constructor(options: JevClientOptions);
    /**
     * Whether a credential is configured.
     * @returns whether a request may be attempted at all.
     */
    available(): boolean;
    /**
     * Ask one yes/no question about one state.
     * @param state - the content to evaluate; the caller owns which sections it carries.
     * @param question - the question to answer.
     * @param signal - the reviewer's own cancellation signal, when it has one.
     * @returns the probability the answer is yes, or `undefined` when this client
     *   cannot answer (the caller then escalates).
     */
    judge(state: unknown, question: NoulQuestion, signal: AbortSignal | undefined): Promise<number | undefined>;
}
//# sourceMappingURL=jev-client.d.ts.map