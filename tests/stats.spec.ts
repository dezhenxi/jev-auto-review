import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JevStats, type JevStatsSnapshot, type VerdictEntry } from '../src/stats.ts'

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'jev-stats-'))
  roots.push(root)
  return root
}

const answered = (tool: string): VerdictEntry => ({ tool, verdict: 'answered', probability: 0.999, cached: false, latencyMs: 120 })
const escalated = (tool: string): VerdictEntry => ({ tool, verdict: 'escalated', probability: 0.4, cached: false, latencyMs: 90 })

describe('JevStats counting', () => {
  it('starts empty and counts each verdict into totals and per-tool tallies', () => {
    const stats = new JevStats({ file: join(tmpdir(), 'never-written.json') })
    const empty = stats.snapshot()
    expect(empty.version).toBe(1)
    expect(empty.totals).toEqual({ answered: 0, escalated: 0, unavailable: 0 })
    expect(empty.byTool).toEqual({})
    expect(typeof empty.updatedAt).toBe('string')

    stats.record(answered('read'))
    stats.record(answered('read'))
    stats.record(escalated('read'))
    stats.record({ tool: 'grep', verdict: 'unavailable', cached: false, latencyMs: 800 })

    const snapshot = stats.snapshot()
    expect(snapshot.totals).toEqual({ answered: 2, escalated: 1, unavailable: 1 })
    expect(snapshot.byTool).toEqual({
      read: { answered: 2, escalated: 1, unavailable: 0 },
      grep: { answered: 0, escalated: 0, unavailable: 1 },
    })
  })

  it('remembers the most recent verdict with its timestamp', () => {
    const stats = new JevStats({ file: join(tmpdir(), 'never-written.json') })
    stats.record(answered('read'))
    stats.record({ tool: 'glob', verdict: 'answered', probability: 0.99, cached: true, latencyMs: 3 })
    const last = stats.snapshot().last
    expect(last).toMatchObject({
      tool: 'glob',
      verdict: 'answered',
      probability: 0.99,
      cached: true,
      latencyMs: 3,
    })
    expect(typeof last?.at).toBe('string')
  })

  it('publishes a detached snapshot a caller cannot use to mutate the counters', () => {
    const stats = new JevStats({ file: join(tmpdir(), 'never-written.json') })
    stats.record(answered('read'))
    const first = stats.snapshot()
    ;(first.totals as { answered: number }).answered = 99
    ;(first.byTool['read'] as { answered: number }).answered = 99
    expect(stats.snapshot().totals.answered).toBe(1)
    expect(stats.snapshot().byTool['read']?.answered).toBe(1)
  })
})

describe('JevStats persistence', () => {
  it('writes the document and creates its directory', async () => {
    const root = await scratch()
    const file = join(root, 'nested', 'stats.json')
    const stats = new JevStats({ file })
    stats.record(answered('read'))
    await stats.flush()

    const written = JSON.parse(await readFile(file, 'utf8')) as JevStatsSnapshot
    expect(written.version).toBe(1)
    expect(written.totals).toEqual({ answered: 1, escalated: 0, unavailable: 0 })
    expect(written.last?.tool).toBe('read')
  })

  it('coalesces concurrent verdicts into the latest document', async () => {
    const root = await scratch()
    const file = join(root, 'stats.json')
    const stats = new JevStats({ file })
    for (let i = 0; i < 25; i++) stats.record(i % 2 === 0 ? answered('read') : escalated('read'))
    await stats.flush()

    const written = JSON.parse(await readFile(file, 'utf8')) as JevStatsSnapshot
    expect(written.totals).toEqual({ answered: 13, escalated: 12, unavailable: 0 })
  })

  it('contains a write failure and reports it once', async () => {
    const root = await scratch()
    // A file where the directory must be: mkdir fails with ENOTDIR/EEXIST.
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const failures: unknown[] = []
    const stats = new JevStats({
      file: join(blocker, 'stats.json'),
      onError: error => failures.push(error),
    })
    stats.record(answered('read'))
    await stats.flush()
    stats.record(answered('read'))
    await stats.flush()

    expect(failures).toHaveLength(1)
    expect(stats.snapshot().totals.answered).toBe(2)
  })

  it('flushes without a pending write', async () => {
    const stats = new JevStats({ file: join(tmpdir(), 'never-written.json') })
    await expect(stats.flush()).resolves.toBeUndefined()
  })
})
