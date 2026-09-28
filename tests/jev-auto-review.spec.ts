import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type StreamChunk } from '@deepseek-ai/dsh-llm'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type PreToolDecision } from '@deepseek-ai/dsh-tools'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import { API_KEY_ENV } from '../src/config.ts'
import { allowChunks } from '../src/decision.ts'
import * as JevAutoReview from '../src/index.ts'
import {
  ALLOW_TEXT,
  approvalStub,
  decisionChunks,
  DENY_TEXT,
  executePending,
  pendingSession,
  PRESETS,
  RecordingAdapter,
  registerProbe,
  reviewShapedRequest,
  type ApprovalStub,
} from './review-harness.ts'
import {
  answerJson,
  answerNoul,
  answerRaw,
  closeStubs,
  startTypeSafeStub,
  type TypeSafeStub,
} from './type-safe-stub.ts'

const contexts: Context[] = []
const stubs: TypeSafeStub[] = []
const roots: string[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  await closeStubs(stubs)
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

/** One captured telemetry record, loosely typed so the spec can assert its attributes. */
interface CapturedRecord {
  readonly channel: string
  readonly severity: string
  readonly attributes: Record<string, string | number>
  readonly body?: unknown
}

/** Read the verdict document once it exists, polling past the write scheduled off the hot path. */
async function readStats(file: string): Promise<Record<string, unknown> | undefined> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    } catch {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  return undefined
}

/** Start one TypeSafe stub and register it for teardown. */
async function stub(respond: Parameters<typeof startTypeSafeStub>[0]): Promise<TypeSafeStub> {
  const started = await startTypeSafeStub(respond)
  stubs.push(started)
  return started
}

interface HarnessOptions {
  /** Scripted reviewer answers; an empty script fails the call, proving the reviewer never ran. */
  readonly reviewer?: StreamChunk[][]
  /** Tools the cascade may answer itself. */
  readonly allowTools?: string[]
  /** TypeSafe endpoint; omit to mount the plugin against an unreachable one. */
  readonly baseURL?: string
  readonly minProbability?: number
  readonly timeoutMs?: number
  readonly cache?: boolean
  /** Mount the cascade with no configured credential, the way a bare profile would. */
  readonly withoutApiKey?: boolean
  /** Approval seam the suite inspects; a fresh stub is composed when omitted. */
  readonly approval?: ApprovalStub
  /** Runs after every other service is mounted and before the cascade mounts. */
  readonly beforeCascade?: (ctx: Context) => void
  /** Extra fast-path observation: a pre-execute listener registered after the reviewer's. */
  readonly onPreExecute?: () => void
  /** Verdict document path; a path under a plain file makes the write fail. */
  readonly statsPath?: string
  /** Telemetry backend disposition: healthy by default. */
  readonly telemetry?: 'ok' | 'throwing' | 'absent'
  /** Turn the verdict document off. */
  readonly stats?: boolean
}

/** Mount the shipped Auto review integration plus this cascade over it. */
async function harness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  adapter: RecordingAdapter
  approval: ApprovalStub
  jev: { dispose(): Promise<void> }
  telemetry: CapturedRecord[]
  statsFile: string
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const root = await mkdtemp(join(tmpdir(), 'jev-cascade-'))
  roots.push(root)
  const statsFile = join(root, 'stats.json')
  const telemetry: CapturedRecord[] = []
  if (options.telemetry !== 'absent') {
    ctx.provide('sessionTelemetry', {
      sharing: 'full',
      emit: (record: CapturedRecord) => {
        if (options.telemetry === 'throwing') throw new Error('telemetry backend is down')
        telemetry.push(record)
      },
      async shutdown() {},
    } as never)
  }
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('these tests do not execute shell requests') },
    run() { throw new Error('these tests do not execute shell requests') },
    start() { throw new Error('these tests do not execute shell requests') },
  })
  const approval = options.approval ?? approvalStub()
  ctx.provide('approval', approval)
  await ctx.plugin(PermissionPresetService, { presets: PRESETS, defaultPreset: 'workspace-write' })
  const adapter = new RecordingAdapter(options.reviewer ?? [])
  ctx.llm.registerAdapter(['review'], adapter)
  await ctx.plugin(AutoReview)
  options.beforeCascade?.(ctx)
  const jev = await ctx.plugin(JevAutoReview, {
    baseURL: options.baseURL ?? 'http://127.0.0.1:1',
    ...options.withoutApiKey === true ? {} : { apiKey: 'sk-test' },
    allowTools: options.allowTools ?? ['probe'],
    minProbability: options.minProbability ?? 0.98,
    timeoutMs: options.timeoutMs ?? 500,
    ...options.cache === undefined ? {} : { cache: options.cache },
    ...options.stats === undefined ? {} : { stats: options.stats },
    // The verdict document defaults into the real DSH home; this suite keeps its own.
    statsPath: options.statsPath ?? statsFile,
  })
  if (options.onPreExecute !== undefined) {
    const observe = options.onPreExecute
    ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
      observe()
      return next()
    })
  }
  return { ctx, adapter, approval, jev, telemetry, statsFile }
}

describe('jev-auto-review cascade over the shipped reviewer', () => {
  it('counts an answered verdict into the document and the telemetry backend', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.999) })
    const { ctx, telemetry, statsFile } = await harness({ baseURL: endpoint.url })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'counted-answer')

    await executePending(ctx, agent, callId)

    expect(probe.runs()).toBe(1)
    expect(await readStats(statsFile)).toMatchObject({
      version: 1,
      totals: { answered: 1, escalated: 0, unavailable: 0 },
      byTool: { probe: { answered: 1, escalated: 0, unavailable: 0 } },
    })
    expect(telemetry).toHaveLength(1)
    expect(telemetry[0]).toMatchObject({
      channel: 'ops',
      severity: 'info',
      attributes: {
        'telemetry.op': 'jev-auto-review/verdict',
        'tool': 'probe',
        'verdict': 'answered',
        'cached': 0,
        'total.answered': 1,
      },
    })
  })

  it('keeps diagnostics out of the review path when every sink fails', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.999) })
    const root = await mkdtemp(join(tmpdir(), 'jev-blocked-'))
    roots.push(root)
    // A plain file where the document directory must be: the write cannot land.
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'not a directory')
    const { ctx, statsFile } = await harness({
      baseURL: endpoint.url,
      statsPath: join(blocker, 'stats.json'),
      telemetry: 'throwing',
    })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'sinks-down')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(await readStats(statsFile)).toBeUndefined()
  })

  it('emits a record without a verdict document when stats are off', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.999) })
    const { ctx, telemetry, statsFile } = await harness({ baseURL: endpoint.url, stats: false })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'no-document')

    await executePending(ctx, agent, callId)

    expect(probe.runs()).toBe(1)
    expect(await readStats(statsFile)).toBeUndefined()
    expect(telemetry).toHaveLength(1)
    expect(telemetry[0]?.attributes).not.toHaveProperty('total.answered')
    expect(telemetry[0]?.body).toBeUndefined()
  })

  it('counts a verdict without a telemetry backend', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.999) })
    const { ctx, statsFile } = await harness({ baseURL: endpoint.url, telemetry: 'absent' })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'no-backend')

    await executePending(ctx, agent, callId)

    expect(probe.runs()).toBe(1)
    expect(await readStats(statsFile)).toMatchObject({ totals: { answered: 1 } })
  })

  it('answers an approved routine call without a language-model reviewer request', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.999) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'fast-path')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(adapter.requests).toHaveLength(0)
    expect(endpoint.requests).toHaveLength(1)
    const body: unknown = JSON.parse(endpoint.requests[0]?.body ?? '{}')
    expect(body).toMatchObject({
      model: 'jev-latest',
      questions: { allow: { type: 'noul' } },
      state: { cwd: { cwd: '/workspace/project' }, pending_action: { name: 'probe' } },
    })
  })

  it('escalates an uncertain call to the reviewer and adopts its allow', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.5) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url, reviewer: [decisionChunks(ALLOW_TEXT)] })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'uncertain-allow')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(adapter.requests).toHaveLength(1)
  })

  it('routes the reviewer denial of an uncertain call to human approval', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.1) })
    const approval = approvalStub()
    const { ctx, adapter } = await harness({
      baseURL: endpoint.url,
      reviewer: [decisionChunks(DENY_TEXT)],
      approval,
    })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'uncertain-deny')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(true)
    expect(result.message).toContain('the user rejected tool "probe"')
    expect(approval.requests).toHaveLength(1)
    expect(approval.requests[0]?.toolName).toBe('probe')
    expect(approval.requests[0]?.reason).toContain('credentials')
    expect(probe.runs()).toBe(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('executes the call a human approves after the reviewer denied it', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.1) })
    const approval = approvalStub()
    approval.outcome = 'allowed-once'
    const { ctx } = await harness({
      baseURL: endpoint.url,
      reviewer: [decisionChunks(DENY_TEXT)],
      approval,
    })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'denied-then-approved')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(approval.requests).toHaveLength(1)
  })

  it('never asks the System One model about a tool outside the allowlist', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const { ctx, adapter } = await harness({
      baseURL: endpoint.url,
      allowTools: ['read'],
      reviewer: [decisionChunks(ALLOW_TEXT)],
    })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'not-allowlisted')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(endpoint.requests).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('escalates when the endpoint answers with an error status', async () => {
    const endpoint = await stub((res) => { answerJson(res, 429, { error: 'rate limited' }) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url, reviewer: [decisionChunks(ALLOW_TEXT)] })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'rate-limited')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(endpoint.requests).toHaveLength(1)
    expect(adapter.requests).toHaveLength(1)
  })

  it('escalates when the endpoint answers with a body it cannot read', async () => {
    const endpoint = await stub((res) => { answerRaw(res, 200, 'not json') })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url, reviewer: [decisionChunks(ALLOW_TEXT)] })
    registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'unreadable')

    expect((await executePending(ctx, agent, callId)).isError).toBe(false)
    expect(adapter.requests).toHaveLength(1)
  })

  it('escalates when nothing is listening on the configured endpoint', async () => {
    const { ctx, adapter } = await harness({
      baseURL: 'http://127.0.0.1:1',
      reviewer: [decisionChunks(ALLOW_TEXT)],
    })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'unreachable')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(adapter.requests).toHaveLength(1)
  })

  it('leaves a session that is not in the Auto preset entirely alone', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url })
    const probe = registerProbe(ctx)
    const { session, agent, callId } = pendingSession(ctx, 'other-preset')
    ctx.permissionPresets.set(session, 'workspace-write')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(endpoint.requests).toHaveLength(0)
    expect(adapter.requests).toHaveLength(0)
  })

  it('still runs the listeners downstream of the reviewer on the fast path', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    let observed = 0
    const { ctx, adapter } = await harness({ baseURL: endpoint.url, onPreExecute: () => { observed += 1 } })
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'downstream')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(observed).toBe(1)
    expect(adapter.requests).toHaveLength(0)
  })

  it('answers two concurrent calls independently', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url })
    const probe = registerProbe(ctx)
    const first = pendingSession(ctx, 'parallel-a', { callId: 'call-a' })
    const second = pendingSession(ctx, 'parallel-b', { callId: 'call-b', cwd: '/workspace/other' })

    const [left, right] = await Promise.all([
      executePending(ctx, first.agent, first.callId),
      executePending(ctx, second.agent, second.callId),
    ])

    expect(left.isError).toBe(false)
    expect(right.isError).toBe(false)
    expect(probe.runs()).toBe(2)
    expect(endpoint.requests).toHaveLength(2)
    expect(adapter.requests).toHaveLength(0)
  })

  it('reuses one verdict for an identical pending action when caching is on', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url, cache: true })
    const probe = registerProbe(ctx)
    const first = pendingSession(ctx, 'cache-a')
    const second = pendingSession(ctx, 'cache-b')

    await executePending(ctx, first.agent, first.callId)
    await executePending(ctx, second.agent, second.callId)

    expect(probe.runs()).toBe(2)
    expect(endpoint.requests).toHaveLength(1)
    expect(adapter.requests).toHaveLength(0)
  })

  it('returns to the reviewer once the cascade is disposed', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const { ctx, adapter, jev } = await harness({ baseURL: endpoint.url, reviewer: [decisionChunks(ALLOW_TEXT)] })
    const probe = registerProbe(ctx)
    await jev.dispose()
    const { agent, callId } = pendingSession(ctx, 'after-disposal')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(endpoint.requests).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('answers a review-shaped request that carries no cancellation signal', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const { ctx, adapter } = await harness({ baseURL: endpoint.url })
    const seen: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream(reviewShapedRequest({ cwd: '/workspace/project', name: 'probe' }))) {
      seen.push(chunk)
    }
    expect(seen).toEqual(allowChunks())
    expect(endpoint.requests).toHaveLength(1)
    expect(adapter.requests).toHaveLength(0)
  })

  it('warns once and stays inert when no credential is configured', async () => {
    const previous = process.env[API_KEY_ENV]
    Reflect.deleteProperty(process.env, API_KEY_ENV)
    try {
      const warnings: string[] = []
      const { ctx, adapter } = await harness({
        withoutApiKey: true,
        reviewer: [decisionChunks(ALLOW_TEXT)],
        beforeCascade: (context) => {
          vi.spyOn(context.logger, 'warn').mockImplementation(((format: string) => {
            warnings.push(format)
          }) as never)
        },
      })
      const probe = registerProbe(ctx)
      const { agent, callId } = pendingSession(ctx, 'no-credential')

      const result = await executePending(ctx, agent, callId)

      expect(result.isError).toBe(false)
      expect(probe.runs()).toBe(1)
      expect(adapter.requests).toHaveLength(1)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(API_KEY_ENV)
    } finally {
      if (previous !== undefined) process.env[API_KEY_ENV] = previous
    }
  })

  it('leaves an unrelated model request untouched', async () => {
    const script = decisionChunks('hello')
    const { ctx, adapter } = await harness({ reviewer: [script] })
    const seen: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'review',
      model: 'same-model',
      system: 'SOME OTHER SYSTEM PROMPT',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      seen.push(chunk)
    }
    expect(seen).toEqual(script)
    expect(adapter.requests).toHaveLength(1)
  })
})
