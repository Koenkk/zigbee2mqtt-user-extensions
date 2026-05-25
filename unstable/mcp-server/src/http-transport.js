/**
 * HttpTransport — HTTP Server for MCP Protocol
 *
 * Provides a Node.js HTTP server that listens for MCP requests
 * and bridges them to the MCP SDK's Streamable HTTP transport.
 *
 * Endpoints:
 *  - POST /mcp — MCP protocol endpoint (JSON-RPC 2.0)
 *  - GET /health — Health check (200 OK)
 */

const http = require('http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

class HttpTransport {
  constructor(mcpServer, port, host, logger) {
    this.mcpServer = mcpServer;
    this.port = port;
    this.host = host;
    this.logger = logger;
    this.server = null;
    this.transport = new StreamableHTTPServerTransport({
      endpoint: '/mcp'
    });
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Health check endpoint
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
          return;
        }

        // MCP protocol endpoint
        if (req.method === 'POST' && req.url === '/mcp') {
          // Add CORS headers
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
          }

          try {
            this.transport.handleRequest(req, res);
          } catch (error) {
            this.logger.error(`[MCP HTTP] Request error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
          return;
        }

        // 404 for other routes
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      });

      this.server.on('error', (error) => {
        this.logger.error(`[MCP HTTP] Server error: ${error.message}`);
        reject(error);
      });

      this.server.listen(this.port, this.host, () => {
        this.logger.info(`[MCP HTTP] Transport listening on ${this.host}:${this.port}`);
        resolve();
      });

      // Graceful shutdown timeout
      this.server.requestTimeout = 30000;
    });
  }

  async stop() {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('[MCP HTTP] Server closed');
        resolve();
      });
    });
  }
}

module.exports = HttpTransport;
