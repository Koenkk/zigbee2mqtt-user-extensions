/**
 * McpServerImpl — MCP Protocol Implementation
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0) server
 * with tool registration and handlers for Zigbee2MQTT operations.
 *
 * Phase 1 Tools:
 *  - list_devices: List all Zigbee devices
 *  - get_device: Get device by friendly name or IEEE address
 *  - control_device: Send command to device
 *  - get_device_state: Get device current state
 *  - get_bridge_info: Get bridge information
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');

class McpServerImpl {
  constructor(zigbee, mqtt, state, publishEntityState, eventBus, settings, logger) {
    this.zigbee = zigbee;
    this.mqtt = mqtt;
    this.state = state;
    this.publishEntityState = publishEntityState;
    this.eventBus = eventBus;
    this.settings = settings;
    this.logger = logger;

    // Create MCP server
    this.server = new McpServer({
      name: 'zigbee2mqtt-mcp',
      version: '1.0.0'
    });

    // Register tools
    this._registerTools();
  }

  _registerTools() {
    /**
     * list_devices — List all known Zigbee devices
     */
    this.server.tool(
      'list_devices',
      {
        include_state: z.boolean().optional().describe('Include current device state (default: true)')
      },
      async ({ include_state = true }) => {
        try {
          const devices = [];
          for (const device of this.zigbee.devicesIterator()) {
            const deviceData = {
              friendly_name: device.name,
              ieee_address: device.ieeeAddr,
              model: device.model || 'unknown',
              manufacturer: device.manufacturerName || 'unknown',
              type: device.type || 'unknown',
              supported: device.supported !== false,
              power_source: device.powerSource || 'unknown',
              available: device.available !== false,
              link_quality: device.linkquality || null
            };

            if (include_state) {
              const deviceState = this.state.get(device);
              deviceData.state = deviceState || {};
            }

            devices.push(deviceData);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(devices, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`[MCP] list_devices error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * get_device — Get detailed information about a specific device
     */
    this.server.tool(
      'get_device',
      {
        device: z.string().describe('Friendly name or IEEE address'),
        include_exposes: z.boolean().optional().describe('Include device capability exposes (default: true)')
      },
      async ({ device, include_exposes = true }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const deviceData = {
            friendly_name: entity.name,
            ieee_address: entity.ieeeAddr,
            model: entity.model || 'unknown',
            manufacturer: entity.manufacturerName || 'unknown',
            type: entity.type || 'unknown',
            supported: entity.supported !== false,
            power_source: entity.powerSource || 'unknown',
            available: entity.available !== false,
            link_quality: entity.linkquality || null,
            last_seen: entity.lastSeen ? new Date(entity.lastSeen).toISOString() : null,
            state: this.state.get(entity) || {}
          };

          if (include_exposes && entity.definition?.exposes) {
            deviceData.exposes = entity.definition.exposes;
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(deviceData, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`[MCP] get_device error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * control_device — Send command to device (set state, brightness, color, etc.)
     */
    this.server.tool(
      'control_device',
      {
        device: z.string().describe('Friendly name or IEEE address'),
        payload: z.record(z.unknown()).describe('Command payload (e.g., {state: "ON"}, {brightness: 200})')
      },
      async ({ device, payload }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const topic = `${baseTopic}/${entity.name}/set`;

          this.mqtt.publish(topic, JSON.stringify(payload));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'ok',
                  message: `Command sent to ${entity.name}`,
                  topic,
                  payload
                }, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`[MCP] control_device error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * get_device_state — Get current device state
     */
    this.server.tool(
      'get_device_state',
      {
        device: z.string().describe('Friendly name or IEEE address')
      },
      async ({ device }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const deviceState = this.state.get(entity) || {};

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(deviceState, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`[MCP] get_device_state error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * get_bridge_info — Get bridge information and status
     */
    this.server.tool(
      'get_bridge_info',
      {},
      async () => {
        try {
          const bridgeInfo = {
            version: require('../package.json').version || 'unknown',
            z2m_version: 'via extension',
            devices_count: [...this.zigbee.devicesIterator()].length,
            groups_count: [...this.zigbee.groupsIterator()].length,
            coordinator: {
              type: this.zigbee.controller?.meta?.product || 'unknown',
              ieee_address: this.zigbee.controller?.ieee_addr || 'unknown'
            },
            network: {
              panid: this.zigbee.controller?.meta?.pan_id || 'unknown',
              channel: this.zigbee.controller?.meta?.channel || 'unknown'
            },
            timestamp: new Date().toISOString()
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(bridgeInfo, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`[MCP] get_bridge_info error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );
  }
}

module.exports = McpServerImpl;
