/**
 * Local verdict statistics for the Jev cascade.
 *
 * The session log cannot hold plugin-owned records: `Session.append()` exposes no
 * `ignorable` marker, so an out-of-repo event type would make every log this
 * plugin touched unreadable to a build without it. Session telemetry carries the
 * counts instead — as one `ops` record per allowlisted verdict — and this module
 * keeps the same counts in a local JSON document so a deployment can read them
 * without a reporting backend.
 *
 * @module @deepseek-ai/dsh-experimental-jev-auto-review/stats
 */
/** What one allowlisted verdict did. */
export type VerdictKind = 'answered' | 'escalated' | 'unavailable';
/** One verdict handed to the counters. */
export interface VerdictEntry {
    /** Tool name the reviewer was judging. */
    readonly tool: string;
    /** Whether the System One model answered, abstained, or could not be reached. */
    readonly verdict: VerdictKind;
    /** The answered probability, absent when the model could not answer. */
    readonly probability?: number;
    /** Whether the probability came from the verdict cache. */
    readonly cached: boolean;
    /** End-to-end time spent obtaining the verdict. */
    readonly latencyMs: number;
}
/** Per-tool tallies. */
export interface ToolTally {
    /** Verdicts answered without the language-model reviewer. */
    readonly answered: number;
    /** Verdicts returned to the language-model reviewer. */
    readonly escalated: number;
    /** Verdicts the endpoint could not supply. */
    readonly unavailable: number;
}
/** The persisted document. */
export interface JevStatsSnapshot {
    /** Document version, so a reader can refuse an unknown shape. */
    readonly version: 1;
    /** ISO-8601 time of the last update. */
    readonly updatedAt: string;
    /** Process-wide totals. */
    readonly totals: ToolTally;
    /** Totals per tool name. */
    readonly byTool: Readonly<Record<string, ToolTally>>;
    /** The most recent verdict. */
    readonly last?: VerdictEntry & {
        readonly at: string;
    };
}
/**
 * Count verdicts and persist them for out-of-process reading.
 *
 * Writes are coalesced: a verdict marks the document dirty, one in-flight write
 * publishes the latest state, and a failure is reported once through
 * {@link JevStatsOptions.onError} and then ignored — a diagnostic document must
 * never affect the review path.
 */
export declare class JevStats {
    private readonly options;
    private readonly totals;
    private readonly byTool;
    private last;
    private dirty;
    private pending;
    private failed;
    /**
     * @param options - the document path and an optional failure sink.
     */
    constructor(options: {
        readonly file: string;
        readonly onError?: (error: unknown) => void;
    });
    /**
     * Count one verdict and schedule the document write.
     * @param entry - the verdict to count.
     */
    record(entry: VerdictEntry): void;
    /**
     * Read the current document.
     * @returns a detached snapshot.
     */
    snapshot(): JevStatsSnapshot;
    /**
     * Wait for the scheduled write to settle.
     * @returns fulfillment after the latest document is on disk, or after a
     *   contained failure.
     */
    flush(): Promise<void>;
    /** Queue one write; concurrent callers share the in-flight one. */
    private schedule;
}
//# sourceMappingURL=stats.d.ts.map