/**
 * McpServerExtension — Main Zigbee2MQTT MCP Server Extension
 *
 * This is a user extension for Zigbee2MQTT that adds Model Context Protocol (MCP)
 * support, enabling AI tools like Claude, ChatGPT, and OpenClaw to interact
 * with your Zigbee network programmatically.
 *
 * Installation:
 *  1. Copy mcp-server.js to data/external_extensions/
 *  2. Restart Zigbee2MQTT
 *  3. Connect MCP client to http://localhost:4747/mcp
 *
 * Configuration (environment variables):
 *  - ZIGBEE2MQTT_CONFIG_MCP_PORT (default: 4747)
 *  - ZIGBEE2MQTT_CONFIG_MCP_HOST (default: 0.0.0.0)
 *  - ZIGBEE2MQTT_CONFIG_MCP_ENABLED (default: true)
 */

const McpServerImpl = require('./mcp-server-impl.js');
const HttpTransport = require('./http-transport.js');

class McpServerExtension {
  constructor(
    zigbee,
    mqtt,
    state,
    publishEntityState,
    eventBus,
    enableDisableExtension,
    restartCallback,
    addExtension,
    settings,
    logger
  ) {
    // Store all injected services from z2m
    this.zigbee = zigbee
    this.mqtt = mqtt
    this.state = state
    this.publishEntityState = publishEntityState
    this.eventBus = eventBus
    this.restartCallback = restartCallback
    this.addExtension = addExtension
    this.enableDisableExtension = enableDisableExtension
    this.settings = settings
    this.logger = logger

    // Read configuration from environment variables
    this.port = parseInt(process.env.ZIGBEE2MQTT_CONFIG_MCP_PORT || '4747', 10)
    this.host = process.env.ZIGBEE2MQTT_CONFIG_MCP_HOST || '0.0.0.0'
    this.enabled = process.env.ZIGBEE2MQTT_CONFIG_MCP_ENABLED !== 'false'

    this.mcpServer = null
    this.httpTransport = null

    this.logger.info(`[MCP] Extension initialized (port: ${this.port}, host: ${this.host})`)
  }

  async start() {
    if (!this.enabled) {
      this.logger.info('[MCP] Extension disabled via ZIGBEE2MQTT_CONFIG_MCP_ENABLED=false')
      return
    }

    try {
      // 1. Create MCP server implementation
      this.mcpServer = new McpServerImpl(
        this.zigbee,
        this.mqtt,
        this.state,
        this.publishEntityState,
        this.eventBus,
        this.settings,
        this.logger
      )

      // 2. Initialize HTTP transport
      this.httpTransport = new HttpTransport(
        this.mcpServer.server,
        this.port,
        this.host,
        this.logger
      )

      // 3. Start HTTP server
      await this.httpTransport.start()

      this.logger.info(`[MCP] Server started successfully on ${this.host}:${this.port}`)
    } catch (error) {
      this.logger.error(`[MCP] Failed to start: ${error.message}`)
      throw error
    }
  }

  async stop() {
    if (!this.httpTransport) return

    try {
      // Clean up EventBus listeners
      this.eventBus.removeListeners(this)
      
      await this.httpTransport.stop()
      this.logger.info('[MCP] Server stopped')
    } catch (error) {
      this.logger.error(`[MCP] Error stopping server: ${error.message}`)
    }
  }
}

module.exports = McpServerExtension
