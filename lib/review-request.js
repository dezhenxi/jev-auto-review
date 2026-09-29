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
import { STATE_SECTION_NAMES } from "./config.js";
/** First line of the reviewer's fixed policy; the request's most stable marker. */
export const REVIEW_POLICY_PREFIX = 'REVIEW_POLICY';
/** A sentence only the reviewer's fixed policy carries. */
export const REVIEW_POLICY_SENTENCE = 'You are the final authorization reviewer for exactly one pending tool call.';
/** Heading the reviewer renders before each section of its request. */
export const SECTION_HEADINGS = {
    'environment': 'ENVIRONMENT',
    'project-instructions': 'PROJECT_INSTRUCTIONS',
    'filtered-history': 'FILTERED_HISTORY',
    'pending-action': 'PENDING_ACTION',
};
/**
 * Recognize one authorization-review request and parse its sections.
 * @param options - the fully assembled model request.
 * @returns the parsed request, or `undefined` when this is not a review request
 *   or any of its sections is missing, duplicated, or malformed.
 */
export function reviewRequestOf(options) {
    if (typeof options.system !== 'string')
        return undefined;
    if (!options.system.startsWith(REVIEW_POLICY_PREFIX))
        return undefined;
    if (!options.system.includes(REVIEW_POLICY_SENTENCE))
        return undefined;
    if (options.temperature !== 0)
        return undefined;
    if (options.tools !== undefined && options.tools.length > 0)
        return undefined;
    if (options.messages.length !== 1)
        return undefined;
    const [message] = options.messages;
    if (message === undefined || message.role !== 'user')
        return undefined;
    const blocks = message.content;
    if (blocks.length !== 1)
        return undefined;
    const [block] = blocks;
    if (block === undefined || block.type !== 'text')
        return undefined;
    const sections = parseReviewSections(block.text);
    if (sections === undefined)
        return undefined;
    return { signal: options.signal, sections };
}
/**
 * Split the reviewer's rendered request text into its section bodies.
 * @param text - the request's single user-message text.
 * @returns each parsed section, or `undefined` when a heading is duplicated or a
 *   body is not valid JSON.
 */
export function parseReviewSections(text) {
    const markers = locateMarkers(text);
    if (markers === undefined)
        return undefined;
    const sections = {};
    for (const [index, marker] of markers.entries()) {
        const stop = markers[index + 1]?.separatorStart ?? text.length;
        const body = text.slice(marker.bodyStart, stop).trim();
        try {
            sections[marker.name] = JSON.parse(body);
        }
        catch {
            return undefined;
        }
    }
    return sections;
}
/**
 * Read the pending action's tool name out of a parsed `PENDING_ACTION` section.
 * @param sections - parsed review sections.
 * @returns the tool name, or `undefined` when the section is absent or shapeless.
 */
export function pendingActionName(sections) {
    const action = sections['pending-action'];
    if (action === null || typeof action !== 'object' || Array.isArray(action))
        return undefined;
    const name = action.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
}
/**
 * Locate every section heading in document order.
 * @param text - the request's single user-message text.
 * @returns the markers sorted by position, or `undefined` when one heading
 *   appears more than once.
 */
function locateMarkers(text) {
    const markers = [];
    for (const name of STATE_SECTION_NAMES) {
        const heading = SECTION_HEADINGS[name];
        const needle = `\n\n${heading}\n`;
        const leading = text.startsWith(`${heading}\n`);
        let occurrences = leading ? 1 : 0;
        let from = 0;
        for (;;) {
            const at = text.indexOf(needle, from);
            if (at < 0)
                break;
            occurrences += 1;
            from = at + 1;
        }
        if (occurrences === 0)
            continue;
        if (occurrences > 1)
            return undefined;
        const separatorStart = leading ? 0 : text.indexOf(needle);
        markers.push({ name, separatorStart, bodyStart: separatorStart + heading.length + (leading ? 1 : 3) });
    }
    return markers.sort((left, right) => left.separatorStart - right.separatorStart);
}
//# sourceMappingURL=review-request.js.map