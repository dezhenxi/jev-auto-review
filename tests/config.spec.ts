import { describe, expect, it } from 'vitest'
import {
  API_KEY_ENV,
  Config,
  DEFAULT_BASE_URL,
  DEFAULT_CACHE,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  resolveConfig,
  type Config as JevConfig,
} from '../src/config.ts'

/** The least configuration a deployment must write. */
function base(overrides: Partial<JevConfig> = {}): JevConfig {
  return { allowTools: ['read'], minProbability: 0.98, ...overrides }
}

describe('resolveConfig defaults', () => {
  it('fills every unset field and freezes the result', () => {
    const resolved = resolveConfig(base())
    expect(resolved).toEqual({
      apiKey: '',
      baseURL: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      allowTools: ['read'],
      minProbability: 0.98,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cache: DEFAULT_CACHE,
      cacheMaxEntries: DEFAULT_CACHE_MAX_ENTRIES,
      stateSections: ['environment', 'pending-action'],
    })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.allowTools)).toBe(true)
  })

  it('normalizes the allowlist and the section list', () => {
    const resolved = resolveConfig(base({
      allowTools: [' read ', 'read', '', 'grep'],
      stateSections: ['pending-action', 'pending-action', 'environment'],
    }))
    expect(resolved.allowTools).toEqual(['read', 'grep'])
    expect(resolved.stateSections).toEqual(['pending-action', 'environment'])
  })

  it('accepts the boundary thresholds', () => {
    expect(resolveConfig(base({ minProbability: 0 })).minProbability).toBe(0)
    expect(resolveConfig(base({ minProbability: 1 })).minProbability).toBe(1)
  })

  it('prefers the configured credential and falls back to the launch environment', () => {
    expect(resolveConfig(base({ apiKey: 'sk-configured' }), 'sk-environment').apiKey).toBe('sk-configured')
    expect(resolveConfig(base(), 'sk-environment').apiKey).toBe('sk-environment')
    expect(resolveConfig(base({ apiKey: '' }), 'sk-environment').apiKey).toBe('sk-environment')
    expect(resolveConfig(base()).apiKey).toBe('')
  })
})

describe('resolveConfig rejection', () => {
  it('rejects a state section list that cannot describe the action', () => {
    expect(() => resolveConfig(base({ stateSections: [] }))).toThrow(/at least one section/)
    expect(() => resolveConfig(base({ stateSections: ['environment'] }))).toThrow(/pending-action/)
  })

  it('rejects a threshold outside the unit interval', () => {
    expect(() => resolveConfig(base({ minProbability: Number.NaN }))).toThrow(/within 0 and 1/)
    expect(() => resolveConfig(base({ minProbability: 1.5 }))).toThrow(/within 0 and 1/)
    expect(() => resolveConfig(base({ minProbability: -0.5 }))).toThrow(/within 0 and 1/)
  })

  it('rejects a base URL that is not an absolute http endpoint', () => {
    expect(() => resolveConfig(base({ baseURL: 'not a url' }))).toThrow(/must be an absolute URL/)
    expect(() => resolveConfig(base({ baseURL: 'ftp://typesafe.ai' }))).toThrow(/must use http or https/)
  })

  it('rejects an empty model and non-positive budgets', () => {
    expect(() => resolveConfig(base({ model: '' }))).toThrow(/model must not be empty/)
    expect(() => resolveConfig(base({ timeoutMs: 0 }))).toThrow(/timeoutMs \(0\) must be a positive integer/)
    expect(() => resolveConfig(base({ cacheMaxEntries: 0 }))).toThrow(/cacheMaxEntries \(0\) must be a positive integer/)
  })
})

describe('Config schema', () => {
  it('names the environment variable read when no key is configured', () => {
    expect(API_KEY_ENV).toBe('TYPESAFE_API_KEY')
  })

  it('requires the two deployment-owned values', () => {
    expect(() => Config({ allowTools: ['read'] } as never)).toThrow()
    expect(() => Config({ minProbability: 0.9 } as never)).toThrow()
  })

  it('rejects an unknown state section', () => {
    expect(() => Config({ allowTools: [], minProbability: 0.9, stateSections: ['everything'] } as never)).toThrow()
  })
})
