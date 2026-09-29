/**
 * Recognition and parsing of the authorization reviewer's own model request.
 *
 * The cascade never builds the reviewer's prompt; it recognizes the request the
 * shipped Auto review package already sends and reads the sections out of it.
 * Recognition requires four independent markers, because a wrong match would
 * replace an unrelated model response, and every parse failure abstains.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/review-request
 */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { ReviewRequest, StateSectionName } from './types.ts';
/** First line of the reviewer's fixed policy; the request's most stable marker. */
export declare const REVIEW_POLICY_PREFIX = "REVIEW_POLICY";
/** A sentence only the reviewer's fixed policy carries. */
export declare const REVIEW_POLICY_SENTENCE = "You are the final authorization reviewer for exactly one pending tool call.";
/** Heading the reviewer renders before each section of its request. */
export declare const SECTION_HEADINGS: Readonly<Record<StateSectionName, string>>;
/**
 * Recognize one authorization-review request and parse its sections.
 * @param options - the fully assembled model request.
 * @returns the parsed request, or `undefined` when this is not a review request
 *   or any of its sections is missing, duplicated, or malformed.
 */
export declare function reviewRequestOf(options: GenerateOptions): ReviewRequest | undefined;
/**
 * Split the reviewer's rendered request text into its section bodies.
 * @param text - the request's single user-message text.
 * @returns each parsed section, or `undefined` when a heading is duplicated or a
 *   body is not valid JSON.
 */
export declare function parseReviewSections(text: string): Partial<Record<StateSectionName, unknown>> | undefined;
/**
 * Read the pending action's tool name out of a parsed `PENDING_ACTION` section.
 * @param sections - parsed review sections.
 * @returns the tool name, or `undefined` when the section is absent or shapeless.
 */
export declare function pendingActionName(sections: Readonly<Partial<Record<StateSectionName, unknown>>>): string | undefined;
//# sourceMappingURL=review-request.d.ts.map