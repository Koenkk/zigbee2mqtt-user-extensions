const assert = require('node:assert/strict')
const { test } = require('node:test')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const HttpTransport = require('../src/http-transport')

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
}

async function fixture(t, createServer) {
  const errors = []
  const transport = new HttpTransport(
    createServer || (() => ({ server: new McpServer({ name: 'test', version: '1' }) })),
    0, '127.0.0.1', { info() {}, error(message) { errors.push(message) } }
  )
  await transport.start()
  t.after(() => transport.stop())
  const url = `http://127.0.0.1:${transport.server.address().port}/mcp`
  const request = (method, body, sessionId) => fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  return { transport, request, errors }
}

async function openSession(request) {
  const response = await request('POST', initialize)
  assert.equal(response.status, 200)
  await response.text()
  const id = response.headers.get('mcp-session-id')
  assert.ok(id)
  return id
}

test('DELETE clears the timer and session; another client remains usable', async t => {
  const { transport, request } = await fixture(t)
  const first = await openSession(request)
  const second = await openSession(request)
  assert.notEqual(first, second)
  const session = transport.sessions.get(first)
  const timer = session.idleTimer
  const deleted = await request('DELETE', null, first)
  assert.equal(deleted.status, 200)
  await deleted.text()
  assert.equal(session.closing, true)
  assert.equal(session.idleTimer, null)
  assert.equal(timer._destroyed, true)
  assert.equal(transport.sessions.has(first), false)
  assert.equal(transport.activeSessions.size, 1)
  const stale = await request('POST', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, first)
  assert.equal(stale.status, 404)
  await stale.text()
  const other = await request('POST', { jsonrpc: '2.0', id: 3, method: 'tools/list' }, second)
  assert.equal(other.status, 200)
  await other.text()
  await transport.stop()
  assert.equal(transport.activeSessions.size, 0)
})

test('invalid initialization frees capacity and missing session headers are rejected', async t => {
  const { transport, request } = await fixture(t)
  const invalid = await request('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  assert.equal(invalid.status, 400)
  await invalid.text()
  assert.equal(transport.activeSessions.size, 0)
  for (const method of ['GET', 'DELETE']) {
    const response = await request(method)
    assert.equal(response.status, 400)
    await response.text()
  }
  const preflight = await request('OPTIONS')
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/)
  assert.match(preflight.headers.get('access-control-expose-headers'), /Mcp-Session-Id/)
})

test('capacity includes concurrent pending connections and is released on close', async t => {
  let release
  const connected = new Promise(resolve => { release = resolve })
  const { transport, request } = await fixture(t, () => ({
    server: { connect: () => connected, async close() {} }
  }))
  const pending = Array.from({ length: 100 }, () => transport._createSession())
  t.after(release)
  assert.equal(transport.sessions.size, 0)
  assert.equal(transport.activeSessions.size, 100)
  const full = await request('POST', initialize)
  assert.equal(full.status, 503)
  await full.text()
  release()
  const sessions = await Promise.all(pending)
  await Promise.all(sessions.map(session => transport._closeSession(session)))
  assert.equal(transport.activeSessions.size, 0)
  const invalid = await request('POST', {})
  assert.notEqual(invalid.status, 503)
  await invalid.text()
  assert.equal(transport.activeSessions.size, 0)
})

test('failed MCP connection releases its slot', async t => {
  const { transport } = await fixture(t, () => ({
    server: { async connect() { throw new Error('connect failed') }, async close() {} }
  }))
  await assert.rejects(transport._createSession(), /connect failed/)
  assert.equal(transport.activeSessions.size, 0)
})

test('HTTP errors reject startup and remain handled after listening', async t => {
  const { transport, errors } = await fixture(t)
  transport.server.emit('error', new Error('runtime error'))
  assert.match(errors.at(-1), /runtime error/)
  const conflicting = new HttpTransport(() => {}, transport.server.address().port, '127.0.0.1', {
    info() {}, error() {}
  })
  await assert.rejects(conflicting.start(), { code: 'EADDRINUSE' })
})
