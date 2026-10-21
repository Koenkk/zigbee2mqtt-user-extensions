/**
 * HttpTransport — HTTP Server for MCP Protocol
 *
 * Provides a Node.js HTTP server that listens for MCP requests
 * and bridges them to the MCP SDK's Streamable HTTP transport.
 *
 * Endpoints:
 *  - POST /mcp — MCP protocol endpoint (JSON-RPC 2.0)
 *  - GET /mcp — MCP server-initiated event stream
 *  - DELETE /mcp — close an MCP session
 *  - GET /health — Health check (200 OK)
 */

const http = require('http')
const { randomUUID } = require('crypto')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')

const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

class HttpTransport {
  constructor(createMcpServer, port, host, logger) {
    this.createMcpServer = createMcpServer
    this.port = port
    this.host = host
    this.logger = logger
    this.server = null
    this.sessions = new Map()
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res).catch(error => {
        this.logger.error(`[MCP HTTP] Request error: ${error.message}`)
        this._writeError(res, 500, 'Internal server error')
      })
    })

    await new Promise((resolve, reject) => {
      const onError = error => {
        this.logger.error(`[MCP HTTP] Server error: ${error.message}`)
        reject(error)
      }

      this.server.once('error', onError)
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', onError)
        this.logger.info(`[MCP HTTP] Transport listening on ${this.host}:${this.port}`)
        resolve()
      })
    })

    // Graceful shutdown timeout
    this.server.requestTimeout = 30000
  }

  async _handleRequest(req, res) {
    this._setCorsHeaders(res)

    if (req.method === 'OPTIONS' && req.url === '/mcp') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }))
      return
    }

    if (req.url !== '/mcp' || !['POST', 'GET', 'DELETE'].includes(req.method)) {
      this._writeError(res, 404, 'Not Found')
      return
    }

    const sessionId = req.headers['mcp-session-id']
    let session
    let createdSession = false

    if (sessionId) {
      session = this.sessions.get(sessionId)
      if (!session) {
        this._writeError(res, 404, 'Session not found')
        return
      }
    } else if (req.method === 'POST') {
      // The SDK transport creates a session only for an initialize request. If
      // this is some other request, it returns the protocol's 400 response and
      // the unused server/transport are disposed in the finally block below.
      session = await this._createSession()
      createdSession = true
    } else {
      this._writeError(res, 400, 'Mcp-Session-Id header is required')
      return
    }

    this._touchSession(session)

    try {
      await session.transport.handleRequest(req, res)
    } catch (error) {
      this.logger.error(`[MCP HTTP] Session request error: ${error.message}`)
      this._writeError(res, 500, 'Internal server error')
    } finally {
      if (createdSession && !session.transport.sessionId) {
        await this._closeSession(session)
      } else if (session.transport.sessionId) {
        this._touchSession(session)
      }
    }
  }

  async _createSession() {
    const mcpServer = this.createMcpServer()
    const session = { mcpServer, transport: null, sessionId: null, idleTimer: null, closing: false }

    session.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: sessionId => {
        session.sessionId = sessionId
        this.sessions.set(sessionId, session)
        this._touchSession(session)
      }
    })

    try {
      await mcpServer.server.connect(session.transport)

      // `connect()` installs the MCP server's own close handler on the
      // transport, so chain ours after it to keep both lifecycles intact.
      const onclose = session.transport.onclose
      session.transport.onclose = () => {
        onclose?.()
        this._removeSession(session)
      }

      return session
    } catch (error) {
      await this._closeSession(session)
      throw error
    }
  }

  _touchSession(session) {
    if (session.closing || !session.sessionId) return

    clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => {
      this.logger.info(`[MCP HTTP] Closing idle session ${session.sessionId}`)
      this._closeSession(session).catch(error => {
        this.logger.error(`[MCP HTTP] Failed to close idle session: ${error.message}`)
      })
    }, SESSION_IDLE_TIMEOUT_MS)
    session.idleTimer.unref?.()
  }

  _removeSession(session) {
    clearTimeout(session.idleTimer)
    if (session.sessionId && this.sessions.get(session.sessionId) === session) {
      this.sessions.delete(session.sessionId)
    }
  }

  async _closeSession(session) {
    if (session.closing) return
    session.closing = true
    this._removeSession(session)

    try {
      await session.mcpServer.server.close()
    } catch (error) {
      this.logger.error(`[MCP HTTP] Session close error: ${error.message}`)
    }
  }

  _setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version')
  }

  _writeError(res, statusCode, message) {
    if (res.headersSent) {
      res.destroy()
      return
    }

    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: message }))
  }

  async stop() {
    if (!this.server) return

    const server = this.server
    this.server = null
    const serverClosed = new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })

    await Promise.all([...this.sessions.values()].map(session => this._closeSession(session)))
    await serverClosed
    this.logger.info('[MCP HTTP] Server closed')
  }
}

module.exports = HttpTransport
