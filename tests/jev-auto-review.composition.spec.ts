import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import * as JevAutoReview from '../src/index.ts'
import { executePending, approvalStub, pendingSession, RecordingAdapter, registerProbe } from './review-harness.ts'
import { answerNoul, closeStubs, startTypeSafeStub, type TypeSafeStub } from './type-safe-stub.ts'

/** Every specifier the composition names, mapped to the module the Loader imports. */
const LOADER_MODULES: Readonly<Record<string, unknown>> = {
  '@deepseek-ai/dsh-llm': LlmRuntime,
  '@deepseek-ai/dsh-session': SessionStore,
  '@deepseek-ai/dsh-session-projection': SessionProjectionRegistry,
  '@deepseek-ai/dsh-system-prompt': SystemPrompt,
  '@deepseek-ai/dsh-tools': ToolRuntime,
  '@deepseek-ai/dsh-permission-presets': PermissionPresetService,
  '@deepseek-ai/dsh-experimental-auto-review': AutoReview,
  '@deepseek-ai/dsh-experimental-jev-auto-review': JevAutoReview,
}

const contexts: Context[] = []
const stubs: TypeSafeStub[] = []
let root: string | undefined

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  await closeStubs(stubs)
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Compose one test-only profile through the real Loader. */
async function compose(endpoint: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-jev-auto-review-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    '  config: {}',
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-permission-presets'",
    '  config:',
    '    defaultPreset: workspace-write',
    '    presets:',
    '      read-only: { sandbox: read-only, approval: ask, name: Read only }',
    '      workspace-write: { sandbox: workspace-write, approval: ask, name: Workspace write }',
    '      danger-full-access: { sandbox: danger-full-access, approval: ask, name: Full access }',
    "- name: '@deepseek-ai/dsh-experimental-auto-review'",
    "- name: '@deepseek-ai/dsh-experimental-jev-auto-review'",
    '  config:',
    `    baseURL: ${endpoint}`,
    '    apiKey: sk-test',
    '    allowTools:',
    '      - probe',
    '    minProbability: 0.98',
    '',
  ].join('\n'))

  const context = new Context()
  contexts.push(context)
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const module = LOADER_MODULES[specifier]
      if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return module
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  // The permission presets read these two services during their own activation.
  context.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('this composition does not execute shell requests') },
    run() { throw new Error('this composition does not execute shell requests') },
    start() { throw new Error('this composition does not execute shell requests') },
  })
  context.provide('approval', approvalStub())
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('jev-auto-review real Loader composition', () => {
  it('answers a routine call without the reviewer when composed from a profile', async () => {
    const endpoint = await startTypeSafeStub((res) => { answerNoul(res, 0.999) })
    stubs.push(endpoint)
    const ctx = await compose(endpoint.url)
    const adapter = new RecordingAdapter([])
    ctx.llm.registerAdapter(['review'], adapter)
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'loader-fast-path')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(adapter.requests).toHaveLength(0)
    expect(endpoint.requests).toHaveLength(1)
  })

  it('escalates to the reviewer when the composed config cannot answer', async () => {
    const endpoint = await startTypeSafeStub((res) => { answerNoul(res, 0.01) })
    stubs.push(endpoint)
    const ctx = await compose(endpoint.url)
    const adapter = new RecordingAdapter([[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"risk":"low","decision":"allow"}' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '{"risk":"low","decision":"allow"}' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]])
    ctx.llm.registerAdapter(['review'], adapter)
    const probe = registerProbe(ctx)
    const { agent, callId } = pendingSession(ctx, 'loader-escalation')

    const result = await executePending(ctx, agent, callId)

    expect(result.isError).toBe(false)
    expect(probe.runs()).toBe(1)
    expect(adapter.requests).toHaveLength(1)
  })
})

describe('jev-auto-review configuration contract', () => {
  it('rejects a configuration that omits a required field', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(JevAutoReview, { allowTools: ['probe'] } as never)).rejects.toThrow(/minProbability/)
  })

  it('rejects a state section list that cannot describe the action', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(JevAutoReview, {
      allowTools: ['probe'],
      minProbability: 0.9,
      stateSections: ['environment'],
    })).rejects.toThrow(/pending-action/)
  })
})

describe('jev-auto-review bundle metadata', () => {
  it('declares the patch row the profile install activates', async () => {
    const base = new URL('../', import.meta.url)
    const manifest = JSON.parse(await readFile(new URL('package.json', base), 'utf8')) as {
      name?: string
      version?: string
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.name).toBe('@deepseek-ai/dsh-experimental-jev-auto-review')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patch = await readFile(new URL('cordis.patch.yml', base), 'utf8')
    expect(patch).toContain('id: jev-auto-review')
    expect(patch).toContain("name: '@deepseek-ai/dsh-experimental-jev-auto-review'")
  })
})
