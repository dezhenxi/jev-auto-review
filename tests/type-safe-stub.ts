/**
 * A loopback stand-in for the TypeSafe evaluation endpoint.
 *
 * Each stub owns its own ephemeral port and records every request it receives,
 * so a suite can assert both what was answered and what was never contacted.
 *
 * @module
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One request a stub received. */
export interface RecordedRequest {
  readonly url: string
  readonly method: string
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

/** One running stub endpoint. */
export interface TypeSafeStub {
  /** Base URL to configure as `baseURL`. */
  readonly url: string
  /** Requests received so far, in arrival order. */
  readonly requests: RecordedRequest[]
  /** Stop listening and close every live connection. */
  close(): Promise<void>
}

/**
 * Start one loopback stub.
 * @param respond - answers one recorded request; a throw is swallowed because
 *   the client may already have abandoned the response.
 * @returns the running stub.
 */
export async function startTypeSafeStub(respond: (res: ServerResponse, body: string) => void): Promise<TypeSafeStub> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('error', () => {})
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body })
      try {
        respond(res, body)
      } catch {
        // The client gave up on this response.
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}

/**
 * Answer one request with the evaluation endpoint's `noul` body.
 * @param res - the response to write.
 * @param probability - the yes probability to report.
 */
export function answerNoul(res: ServerResponse, probability: number): void {
  answerJson(res, 200, {
    model: 'jev-1.13.0',
    answers: { allow: { type: 'noul', noul: probability } },
    usage: { input_tokens: 12, output_tokens: 3 },
  })
}

/**
 * Answer one request with a JSON body.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param body - the JSON value.
 */
export function answerJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Answer one request with a raw string body.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param body - the body text.
 */
export function answerRaw(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}

/**
 * Close every stub a suite started.
 * @param stubs - the stubs to drain, newest last.
 */
export async function closeStubs(stubs: TypeSafeStub[]): Promise<void> {
  while (stubs.length > 0) await stubs.pop()?.close()
}
