import { describe, expect, it } from 'vitest'
import { createMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  parseReviewSections,
  pendingActionName,
  reviewRequestOf,
  REVIEW_POLICY_PREFIX,
  REVIEW_POLICY_SENTENCE,
  SECTION_HEADINGS,
} from '../src/review-request.ts'
import type { StateSectionName } from '../src/types.ts'

/** A policy text carrying the two markers the matcher requires, shaped like the reviewer's. */
const REVIEW_POLICY = `${REVIEW_POLICY_PREFIX}\n${REVIEW_POLICY_SENTENCE}\n\nThe shipped reviewer's remaining policy text.`

/** Section order the reviewer renders. */
const SECTION_ORDER: readonly StateSectionName[] = [
  'environment',
  'project-instructions',
  'filtered-history',
  'pending-action',
]

/** Render sections exactly as the reviewer's `reviewUserText` does: headings and pretty JSON joined by a blank line. */
function reviewText(sections: Partial<Record<StateSectionName, unknown>>): string {
  const parts: string[] = []
  for (const name of SECTION_ORDER) {
    const value = sections[name]
    if (value === undefined) continue
    parts.push(SECTION_HEADINGS[name], JSON.stringify(value, null, 2))
  }
  return parts.join('\n\n')
}

/** One request shaped like the reviewer's, with overridable deviations. */
function reviewRequest(
  sections: Partial<Record<StateSectionName, unknown>> = {
    'environment': { cwd: 'E:\\project' },
    'pending-action': { mode: 'native', name: 'read', arguments: { path: 'README.md' } },
  },
  overrides: Partial<GenerateOptions> = {},
): GenerateOptions {
  return {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    system: REVIEW_POLICY,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: reviewText(sections) }] }],
    ...overrides,
  }
}

describe('reviewRequestOf', () => {
  it('recognizes the reviewer request shape and parses every section', () => {
    const options = reviewRequest({
      'environment': { cwd: 'E:\\project' },
      'project-instructions': [{ content: [{ type: 'text', text: 'rule' }] }],
      'filtered-history': [{ kind: 'tool-call', name: 'read' }],
      'pending-action': { mode: 'native', name: 'read', arguments: { path: 'a.ts' } },
    })
    const request = reviewRequestOf(options)
    expect(request).toBeDefined()
    expect(request?.sections['environment']).toEqual({ cwd: 'E:\\project' })
    expect(request?.sections['project-instructions']).toEqual([{ content: [{ type: 'text', text: 'rule' }] }])
    expect(request?.sections['filtered-history']).toEqual([{ kind: 'tool-call', name: 'read' }])
    expect(request?.sections['pending-action']).toEqual({ mode: 'native', name: 'read', arguments: { path: 'a.ts' } })
  })

  it('carries the request signal through', () => {
    const controller = new AbortController()
    expect(reviewRequestOf(reviewRequest(undefined, { signal: controller.signal }))?.signal).toBe(controller.signal)
  })

  it('rejects a request without a system prompt', () => {
    const options = reviewRequest()
    delete (options as { system?: string }).system
    expect(reviewRequestOf(options)).toBeUndefined()
  })

  it('rejects a system prompt missing either marker', () => {
    expect(reviewRequestOf(reviewRequest(undefined, { system: `${REVIEW_POLICY_PREFIX}\nsomething else` }))).toBeUndefined()
    expect(reviewRequestOf(reviewRequest(undefined, { system: `OTHER\n${REVIEW_POLICY_SENTENCE}` }))).toBeUndefined()
  })

  it('rejects a request that is not greedy-decoded', () => {
    expect(reviewRequestOf(reviewRequest(undefined, { temperature: 0.7 }))).toBeUndefined()
    const withoutTemperature = reviewRequest()
    Reflect.deleteProperty(withoutTemperature, 'temperature')
    expect(reviewRequestOf(withoutTemperature)).toBeUndefined()
  })

  it('rejects a request carrying tools', () => {
    expect(reviewRequestOf(reviewRequest(undefined, {
      tools: [{ name: 'read', description: 'read', parameters: {} }],
    }))).toBeUndefined()
  })

  it('accepts a request that declares an empty tool list', () => {
    expect(reviewRequestOf(reviewRequest(undefined, { tools: [] }))).toBeDefined()
  })

  it('rejects a request whose own body cannot be parsed', () => {
    expect(reviewRequestOf(reviewRequest(undefined, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ENVIRONMENT\n\n{ not json }' }] }],
    }))).toBeUndefined()
  })

  it('rejects a request that is not exactly one user text message', () => {
    expect(reviewRequestOf(reviewRequest(undefined, { messages: [] }))).toBeUndefined()
    expect(reviewRequestOf(reviewRequest(undefined, {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'ENVIRONMENT\n\n{}' }] },
        { role: 'user', content: [{ type: 'text', text: 'ENVIRONMENT\n\n{}' }] },
      ],
    }))).toBeUndefined()
    expect(reviewRequestOf(reviewRequest(undefined, {
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ENVIRONMENT\n\n{}' }],
        source: { kind: 'model', provider: 'review', model: 'same-model' },
      })],
    }))).toBeUndefined()
    expect(reviewRequestOf(reviewRequest(undefined, {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'ENVIRONMENT\n\n{}' },
          { type: 'text', text: 'PENDING_ACTION\n\n{}' },
        ],
      }],
    }))).toBeUndefined()
    expect(reviewRequestOf(reviewRequest(undefined, {
      messages: [{ role: 'user', content: [{ type: 'reasoning', text: 'ENVIRONMENT\n\n{}' }] }],
    }))).toBeUndefined()
  })
})

describe('parseReviewSections', () => {
  it('keeps a multi-line value intact across a blank line inside its JSON escape', () => {
    const sections = parseReviewSections(reviewText({
      'environment': { cwd: 'E:\\project' },
      'pending-action': { name: 'write', arguments: { content: 'first\n\nsecond', note: 'ENVIRONMENT' } },
    }))
    expect(sections?.['pending-action']).toEqual({
      name: 'write',
      arguments: { content: 'first\n\nsecond', note: 'ENVIRONMENT' },
    })
  })

  it('parses a request whose first heading opens the text', () => {
    const sections = parseReviewSections(`ENVIRONMENT\n\n${JSON.stringify({ cwd: '/tmp' }, null, 2)}`)
    expect(sections).toEqual({ 'environment': { cwd: '/tmp' } })
  })

  it('abstains on a malformed section body', () => {
    expect(parseReviewSections('ENVIRONMENT\n\n{ not json }\n\nPENDING_ACTION\n\n{}')).toBeUndefined()
    expect(parseReviewSections('PENDING_ACTION\n\n')).toBeUndefined()
  })

  it('abstains on a repeated heading', () => {
    expect(parseReviewSections([
      'ENVIRONMENT', '{}', 'PENDING_ACTION', '{}', 'ENVIRONMENT', '{}',
    ].join('\n\n'))).toBeUndefined()
  })

  it('returns nothing for text without any heading', () => {
    expect(parseReviewSections('a plain prompt with no sections')).toEqual({})
  })
})

describe('pendingActionName', () => {
  it('reads the tool name', () => {
    expect(pendingActionName({ 'pending-action': { name: 'read' } })).toBe('read')
  })

  it('rejects a shapeless or unnamed action', () => {
    expect(pendingActionName({})).toBeUndefined()
    expect(pendingActionName({ 'pending-action': null })).toBeUndefined()
    expect(pendingActionName({ 'pending-action': ['read'] })).toBeUndefined()
    expect(pendingActionName({ 'pending-action': { name: '' } })).toBeUndefined()
    expect(pendingActionName({ 'pending-action': { name: 42 } })).toBeUndefined()
  })
})
