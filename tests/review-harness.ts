/**
 * Shared scaffolding for the cascade suites: the probe tool, the pending-call
 * session surface, and the reviewer adapter both the in-process and the
 * Loader-composed suites drive.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  createMessage,
  createUserMessage,
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { AUTO_PRESET, type Config as PermissionConfig } from '@deepseek-ai/dsh-permission-presets'
import { SessionId, SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

/** The preset table both suites compose over. */
export const PRESETS = {
  'read-only': { sandbox: 'read-only', approval: 'ask', name: 'Read only' },
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask', name: 'Workspace write' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'ask', name: 'Full access' },
} satisfies NonNullable<PermissionConfig['presets']>

/** The logged schema and the live definition must agree on name, description, and parameters. */
export const PROBE_SCHEMA: ToolSchema = {
  name: 'probe',
  description: 'live probe description',
  parameters: { path: { type: 'string' } },
}

/** The reviewer's low-risk allow, verbatim. */
export const ALLOW_TEXT = '{"risk":"low","decision":"allow"}'

/** A reviewer denial, verbatim. */
export const DENY_TEXT = '{"risk":"high","decision":"deny","reason":"credentials"}'

/**
 * Reviewer answer chunks in the stream grammar the reviewer's reader consumes.
 * @param text - the decision text the reviewer reads back.
 * @returns the four chunks of one greedy-decoded answer.
 */
export function decisionChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A reviewer policy carrying the two markers the cascade matcher requires. */
export const REVIEW_POLICY = 'REVIEW_POLICY\n'
  + 'You are the final authorization reviewer for exactly one pending tool call.\n\n'
  + 'The shipped reviewer\'s remaining policy text.'

/**
 * Build one model request shaped exactly like the shipped reviewer's, for
 * suites that exercise the waterfall without the reviewer package.
 * @param options - the pending action, its working directory, and overrides.
 * @returns a request the cascade matcher recognizes.
 */
export function reviewShapedRequest(options: {
  cwd: string
  name: string
  arguments?: unknown
  system?: string
  signal?: AbortSignal
}): GenerateOptions {
  const text = [
    'ENVIRONMENT',
    JSON.stringify({ cwd: options.cwd }, null, 2),
    'PENDING_ACTION',
    JSON.stringify({ mode: 'native', name: options.name, arguments: options.arguments ?? {} }, null, 2),
  ].join('\n\n')
  return {
    provider: 'review',
    model: 'same-model',
    system: options.system ?? REVIEW_POLICY,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    ...options.signal === undefined ? {} : { signal: options.signal },
  }
}

/** One adapter serving the reviewer route and recording every request it receives. */
export class RecordingAdapter extends LlmAdapter {
  /** Every request the reviewer route received, in order. */
  readonly requests: GenerateOptions[] = []

  /**
   * @param script - one scripted answer per expected request; an exhausted
   *   script throws, so a call the suite did not expect fails loudly.
   */
  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.script.shift()
    if (response === undefined) throw new Error('the language-model reviewer was called with no scripted answer')
    for (const chunk of response) yield chunk
  }
}

/** One agent identity for a session created directly against the store. */
export function agentFor(session: Session): Agent {
  return { id: session.id, session, options: { provider: 'review', model: 'same-model' } } as Agent
}

/**
 * Create one Auto-preset session whose surface already carries the pending call,
 * so a tool execution runs the real pre-execute gate over it.
 * @param ctx - composed context carrying the session store and permission presets.
 * @param id - session id.
 * @param options - overridable pending-call identity and working directory.
 * @returns the session, its agent identity, and the pending call id.
 */
export function pendingSession(
  ctx: Context,
  id: string,
  options: { cwd?: string; callId?: string; name?: string; arguments?: string } = {},
): { session: Session; agent: Agent; callId: ToolCallId } {
  const cwd = options.cwd ?? '/workspace/project'
  const callId = ToolCallId(options.callId ?? 'current-call')
  const name = options.name ?? 'probe'
  const rawArguments = options.arguments ?? '{"path":"target"}'
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd } })
  ctx.permissionPresets.set(session, AUTO_PRESET)
  session.append('request/header', {
    header: { config: { provider: 'review', model: 'same-model' }, tools: [PROBE_SCHEMA] },
    reason: 'initial',
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'review this call' }],
    source: { kind: 'user', rpcId: 'root-rpc' } as never,
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    stream: [],
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name, arguments: rawArguments }],
      source: { kind: 'model', provider: 'review', model: 'same-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: rawArguments })
  return { session, agent: agentFor(session), callId }
}

/**
 * Register the probe tool and count its body executions.
 * @param ctx - composed context carrying the tool registry.
 * @returns an accessor for how many times the body ran.
 */
export function registerProbe(ctx: Context): { runs: () => number } {
  let runs = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'live probe description',
    parameters: { path: { type: 'string' } },
    async execute() {
      runs += 1
      return [{ type: 'text', text: 'ran' }]
    },
  }))
  return { runs: () => runs }
}

/**
 * Execute one pending call through the real tool pipeline.
 * @param ctx - composed context carrying the tool registry.
 * @param agent - the identity that owns the pending call.
 * @param callId - the pending call id.
 * @returns whether the call failed, its structured error code, and its message.
 */
export async function executePending(
  ctx: Context,
  agent: Agent,
  callId: ToolCallId,
): Promise<{ isError: boolean; errorCode: string | undefined; message: string | undefined }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId,
    name: 'probe',
    arguments: { path: 'target' },
    agent,
  })
  return { isError: result.isError, errorCode: result.error?.info?.code, message: result.error?.message }
}

/** One approval the reviewer's denial routed to a human. */
export interface RecordedApproval {
  readonly toolName: string
  readonly reason: string | undefined
}

/** The approval seam a composition without the real approval service provides. */
export interface ApprovalStub {
  /** The composed default the permission presets read. */
  readonly config: { policy: string }
  /** Every approval request the harness answered, in order. */
  readonly requests: RecordedApproval[]
  /** Outcome every request resolves to; `rejected` is the safe default. */
  outcome: 'allowed-once' | 'rejected' | 'cancelled'
  /**
   * Read the session's effective policy the way the approval service does: the
   * last logged policy, or `undefined` without one. The reviewer returns a
   * structured denial directly only while that policy is `never`; under any
   * other policy its denial becomes an approval request.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): string | undefined
  /**
   * Answer one pending approval.
   * @param request - the approval the tool pipeline is waiting on.
   * @returns the configured outcome.
   */
  request(request: { toolName: string; reason?: string }): Promise<'allowed-once' | 'rejected' | 'cancelled'>
}

/**
 * Compose the approval seam a bare harness needs.
 * @returns a stub whose answered approvals are readable by the calling suite.
 */
export function approvalStub(): ApprovalStub {
  return {
    config: { policy: 'ask' },
    requests: [],
    outcome: 'rejected',
    overrideOf(session) {
      for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
        const event = session.eventAt(SessionSeq(seq))
        if (event?.type === 'approval/policy') return event.data.policy
      }
      return undefined
    },
    async request(pending) {
      this.requests.push({ toolName: pending.toolName, reason: pending.reason })
      return this.outcome
    },
  }
}
