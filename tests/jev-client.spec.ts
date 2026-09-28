import { afterEach, describe, expect, it } from 'vitest'
import {
  EVALUATION_PATH,
  JevClient,
  MAX_RESPONSE_CHARS,
  QUESTION_ID,
  USER_AGENT,
} from '../src/jev-client.ts'
import type { NoulQuestion } from '../src/types.ts'
import {
  answerJson,
  answerNoul,
  answerRaw,
  closeStubs,
  startTypeSafeStub,
  type TypeSafeStub,
} from './type-safe-stub.ts'

const stubs: TypeSafeStub[] = []

/** Start one stub and register it for teardown. */
async function stub(respond: Parameters<typeof startTypeSafeStub>[0]): Promise<TypeSafeStub> {
  const started = await startTypeSafeStub(respond)
  stubs.push(started)
  return started
}

const QUESTION: NoulQuestion = { type: 'noul', instructions: 'Is it a routine read?' }

function clientFor(endpoint: TypeSafeStub, overrides: { apiKey?: string; timeoutMs?: number } = {}): JevClient {
  return new JevClient({
    baseURL: endpoint.url,
    apiKey: overrides.apiKey ?? 'sk-test',
    model: 'jev-latest',
    timeoutMs: overrides.timeoutMs ?? 2000,
  })
}

afterEach(async () => {
  await closeStubs(stubs)
})

describe('JevClient availability', () => {
  it('is unavailable without a key and never contacts the endpoint', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const client = clientFor(endpoint, { apiKey: '' })
    expect(client.available()).toBe(false)
    await expect(client.judge({ a: 1 }, QUESTION, undefined)).resolves.toBeUndefined()
    expect(endpoint.requests).toHaveLength(0)
  })
})

describe('JevClient request', () => {
  it('posts the model, the state, and the question to the evaluation path', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 0.997) })
    const probability = await clientFor(endpoint).judge({ cwd: '/tmp' }, QUESTION, undefined)
    expect(probability).toBe(0.997)
    expect(endpoint.requests).toHaveLength(1)
    const [request] = endpoint.requests
    expect(request?.url).toBe(EVALUATION_PATH)
    expect(request?.method).toBe('POST')
    expect(request?.headers['authorization']).toBe('Bearer sk-test')
    expect(request?.headers['content-type']).toBe('application/json')
    expect(request?.headers['accept']).toBe('application/json')
    expect(request?.headers['user-agent']).toBe(USER_AGENT)
    expect(JSON.parse(request?.body ?? '')).toEqual({
      state: { cwd: '/tmp' },
      model: 'jev-latest',
      questions: { [QUESTION_ID]: QUESTION },
    })
  })

  it('appends the evaluation path to a base URL with a trailing slash', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const client = new JevClient({
      baseURL: `${endpoint.url}/`,
      apiKey: 'sk-test',
      model: 'jev-latest',
      timeoutMs: 2000,
    })
    await client.judge({}, QUESTION, undefined)
    expect(endpoint.requests[0]?.url).toBe(EVALUATION_PATH)
  })
})

describe('JevClient answer handling', () => {
  it('abstains on an answer that is not a noul', async () => {
    const endpoint = await stub((res) => {
      answerJson(res, 200, { answers: { [QUESTION_ID]: { type: 'choice', choice: 'read', probabilities: { read: 1 } } } })
    })
    await expect(clientFor(endpoint).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
  })

  it('abstains on an out-of-range, non-numeric, or missing answer', async () => {
    const outOfRange = await stub((res) => { answerNoul(res, 1.5) })
    await expect(clientFor(outOfRange).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const negative = await stub((res) => { answerNoul(res, -0.1) })
    await expect(clientFor(negative).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const textual = await stub((res) => {
      answerJson(res, 200, { answers: { [QUESTION_ID]: { type: 'noul', noul: '0.9' } } })
    })
    await expect(clientFor(textual).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const missing = await stub((res) => { answerJson(res, 200, { answers: {} }) })
    await expect(clientFor(missing).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const shapeless = await stub((res) => { answerJson(res, 200, 'nope') })
    await expect(clientFor(shapeless).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const noAnswers = await stub((res) => { answerJson(res, 200, { model: 'jev' }) })
    await expect(clientFor(noAnswers).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const arrayAnswers = await stub((res) => { answerJson(res, 200, { answers: [] }) })
    await expect(clientFor(arrayAnswers).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
  })

  it('accepts the boundary probabilities', async () => {
    const zero = await stub((res) => { answerNoul(res, 0) })
    await expect(clientFor(zero).judge({}, QUESTION, undefined)).resolves.toBe(0)
    const one = await stub((res) => { answerNoul(res, 1) })
    await expect(clientFor(one).judge({}, QUESTION, undefined)).resolves.toBe(1)
  })

  it('abstains on every documented error status', async () => {
    for (const status of [401, 422, 429, 529]) {
      const endpoint = await stub((res) => { answerJson(res, status, { error: 'nope' }) })
      await expect(clientFor(endpoint).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    }
  })

  it('abstains on a body that is not JSON or is oversized', async () => {
    const malformed = await stub((res) => { answerRaw(res, 200, 'not json') })
    await expect(clientFor(malformed).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    const oversized = await stub((res) => {
      answerRaw(res, 200, JSON.stringify({ padding: 'x'.repeat(MAX_RESPONSE_CHARS) }))
    })
    await expect(clientFor(oversized).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
  })

  it('refuses a redirect instead of following it with the credential', async () => {
    const target = await stub((res) => { answerNoul(res, 1) })
    const redirecting = await stub((res) => {
      res.writeHead(302, { location: `${target.url}${EVALUATION_PATH}` })
      res.end()
    })
    await expect(clientFor(redirecting).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
    expect(target.requests).toHaveLength(0)
  })
})

describe('JevClient failure handling', () => {
  it('abstains when the endpoint outlives the budget', async () => {
    const endpoint = await stub((res) => {
      setTimeout(() => { answerNoul(res, 1) }, 300)
    })
    await expect(clientFor(endpoint, { timeoutMs: 50 }).judge({}, QUESTION, undefined)).resolves.toBeUndefined()
  })

  it('abstains when the caller cancels', async () => {
    const endpoint = await stub((res) => { answerNoul(res, 1) })
    const controller = new AbortController()
    controller.abort(new Error('reviewer cancelled'))
    await expect(clientFor(endpoint).judge({}, QUESTION, controller.signal)).resolves.toBeUndefined()
  })

  it('abstains when nothing is listening', async () => {
    const client = new JevClient({
      baseURL: 'http://127.0.0.1:1',
      apiKey: 'sk-test',
      model: 'jev-latest',
      timeoutMs: 2000,
    })
    await expect(client.judge({}, QUESTION, undefined)).resolves.toBeUndefined()
  })
})
