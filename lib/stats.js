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
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Empty tally, fresh per call so a caller cannot alias a shared object. */
const emptyTally = () => ({ answered: 0, escalated: 0, unavailable: 0 });
/**
 * Count verdicts and persist them for out-of-process reading.
 *
 * Writes are coalesced: a verdict marks the document dirty, one in-flight write
 * publishes the latest state, and a failure is reported once through
 * {@link JevStatsOptions.onError} and then ignored — a diagnostic document must
 * never affect the review path.
 */
export class JevStats {
    options;
    totals = emptyTally();
    byTool = new Map();
    last;
    dirty = false;
    pending = Promise.resolve();
    failed = false;
    /**
     * @param options - the document path and an optional failure sink.
     */
    constructor(options) {
        this.options = options;
    }
    /**
     * Count one verdict and schedule the document write.
     * @param entry - the verdict to count.
     */
    record(entry) {
        this.totals[entry.verdict] += 1;
        const tally = this.byTool.get(entry.tool) ?? emptyTally();
        tally[entry.verdict] += 1;
        this.byTool.set(entry.tool, tally);
        this.last = { ...entry, at: new Date().toISOString() };
        this.dirty = true;
        this.schedule();
    }
    /**
     * Read the current document.
     * @returns a detached snapshot.
     */
    snapshot() {
        return {
            version: 1,
            updatedAt: new Date().toISOString(),
            totals: { ...this.totals },
            byTool: Object.fromEntries([...this.byTool].map(([tool, tally]) => [tool, { ...tally }])),
            ...this.last === undefined ? {} : { last: this.last },
        };
    }
    /**
     * Wait for the scheduled write to settle.
     * @returns fulfillment after the latest document is on disk, or after a
     *   contained failure.
     */
    async flush() {
        await this.pending;
    }
    /** Queue one write; concurrent callers share the in-flight one. */
    schedule() {
        this.pending = this.pending.then(async () => {
            if (!this.dirty)
                return;
            this.dirty = false;
            const file = this.options.file;
            try {
                await mkdir(dirname(file), { recursive: true });
                // Publish through a sibling temp file so a reader never sees a partial
                // document; a rename within one directory is atomic on every host.
                const temporary = `${file}.${process.pid}.tmp`;
                await writeFile(temporary, `${JSON.stringify(this.snapshot(), null, 2)}\n`, { mode: 0o600 });
                await rename(temporary, file);
            }
            catch (error) {
                if (!this.failed) {
                    this.failed = true;
                    this.options.onError?.(error);
                }
            }
        });
    }
}
//# sourceMappingURL=stats.js.map