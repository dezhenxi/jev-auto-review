import { describe, expect, it } from 'vitest'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import {
  ACTION_STATE_KEY,
  ALLOW_DECISION_TEXT,
  allowChunks,
  buildJudgeInput,
  CWD_STATE_KEY,
  FILTERED_HISTORY_STATE_KEY,
  mayFastPath,
  PROJECT_INSTRUCTIONS_STATE_KEY,
  VerdictCache,
  verdictCacheKey,
} from '../src/decision.ts'
import type { StateSectionName } from '../src/types.ts'

const ACTION = { mode: 'native', name: 'read', arguments: { path: 'a.ts' } }

describe('mayFastPath', () => {
  it('requires both the allowlist and the threshold, inclusive at the threshold', () => {
    expect(mayFastPath('read', ['read'], 1, 0.98)).toBe(true)
    expect(mayFastPath('read', ['read'], 0.98, 0.98)).toBe(true)
    expect(mayFastPath('read', ['read'], 0.9799, 0.98)).toBe(false)
    expect(mayFastPath('write', ['read'], 1, 0.98)).toBe(false)
    expect(mayFastPath('read', [], 1, 0)).toBe(false)
  })
})

describe('allowChunks', () => {
  it('emits the fixed stream order the reviewer reader consumes', () => {
    expect(allowChunks()).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: ALLOW_DECISION_TEXT },
      { type: 'block-end', index: 0, block: { type: 'text', text: ALLOW_DECISION_TEXT } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('assembles into exactly one text block carrying the low-risk allow', () => {
    const assembler = new BlockAssembler()
    for (const chunk of allowChunks()) assembler.push(chunk)
    expect(assembler.blocks()).toEqual([{ type: 'text', text: '{"risk":"low","decision":"allow"}' }])
  })

  it('hands each caller its own array', () => {
    expect(allowChunks()).not.toBe(allowChunks())
  })
})

describe('buildJudgeInput', () => {
  it('sends the action and the working directory by default', () => {
    const input = buildJudgeInput({
      'environment': { cwd: 'E:\\project' },
      'pending-action': ACTION,
    }, ['environment', 'pending-action'])
    expect(input?.state).toEqual({
      [ACTION_STATE_KEY]: ACTION,
      [CWD_STATE_KEY]: { [CWD_STATE_KEY]: 'E:\\project' },
    })
    expect(input?.question.type).toBe('noul')
    expect(input?.question.instructions).toContain(`\`${CWD_STATE_KEY}\``)
    expect(input?.question.instructions).toContain(`\`${ACTION_STATE_KEY}\``)
  })

  it('carries the optional sections when the deployment selects them', () => {
    const input = buildJudgeInput({
      'environment': { cwd: '/tmp' },
      'project-instructions': [{ rule: true }],
      'filtered-history': [{ kind: 'tool-call' }],
      'pending-action': ACTION,
    }, ['environment', 'project-instructions', 'filtered-history', 'pending-action'])
    expect(input?.state[PROJECT_INSTRUCTIONS_STATE_KEY]).toEqual([{ rule: true }])
    expect(input?.state[FILTERED_HISTORY_STATE_KEY]).toEqual([{ kind: 'tool-call' }])
  })

  it('never sends a section the deployment did not select', () => {
    const input = buildJudgeInput({
      'environment': { cwd: '/tmp' },
      'filtered-history': [{ secret: 'value' }],
      'pending-action': ACTION,
    }, ['environment', 'pending-action'] as StateSectionName[])
    expect(Object.keys(input?.state ?? {})).toEqual([ACTION_STATE_KEY, CWD_STATE_KEY])
    expect(JSON.stringify(input?.state)).not.toContain('secret')
  })

  it('escalates when the action or a selected section is missing or shapeless', () => {
    expect(buildJudgeInput({ 'environment': { cwd: '/tmp' } }, ['environment', 'pending-action'])).toBeUndefined()
    expect(buildJudgeInput({ 'pending-action': ACTION }, ['environment', 'pending-action'])).toBeUndefined()
    expect(buildJudgeInput({
      'environment': { notCwd: true },
      'pending-action': ACTION,
    }, ['environment', 'pending-action'])).toBeUndefined()
    expect(buildJudgeInput({ 'environment': [], 'pending-action': ACTION }, ['environment', 'pending-action'])).toBeUndefined()
    expect(buildJudgeInput({ 'environment': '/tmp', 'pending-action': ACTION }, ['environment', 'pending-action'])).toBeUndefined()
    expect(buildJudgeInput({ 'pending-action': ACTION }, ['pending-action'])).toBeDefined()
  })

  it('names no context when the action is the only section', () => {
    const input = buildJudgeInput({ 'pending-action': ACTION }, ['pending-action'])
    expect(input?.question.instructions).not.toContain('Context available to you')
  })
})

describe('verdictCacheKey', () => {
  it('is stable for equal states and distinct for different ones', () => {
    expect(verdictCacheKey({ a: 1 })).toBe(verdictCacheKey({ a: 1 }))
    expect(verdictCacheKey({ a: 1 })).not.toBe(verdictCacheKey({ a: 2 }))
  })

  it('keys a state whose values came from a parsed request', () => {
    expect(verdictCacheKey({ [ACTION_STATE_KEY]: ACTION })).toHaveLength(64)
  })
})

describe('VerdictCache', () => {
  it('remembers and refreshes entries up to its bound', () => {
    const cache = new VerdictCache(2)
    expect(cache.get('a')).toBeUndefined()
    cache.set('a', 0.9)
    cache.set('b', 0.8)
    expect(cache.get('a')).toBe(0.9)
    // 'a' was read last, so adding 'c' evicts 'b'.
    cache.set('c', 0.7)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(0.9)
    expect(cache.get('c')).toBe(0.7)
  })

  it('overwrites an existing key without growing', () => {
    const cache = new VerdictCache(1)
    cache.set('a', 0.1)
    cache.set('a', 0.2)
    expect(cache.get('a')).toBe(0.2)
    expect(cache.get('b')).toBeUndefined()
  })
})
