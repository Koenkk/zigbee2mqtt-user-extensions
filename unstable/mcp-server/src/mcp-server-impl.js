/**
 * McpServerImpl — MCP Protocol Implementation
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0) server
 * with tool registration and MCP resources for Zigbee2MQTT operations.
 *
 * Phase 1 Tools:
 *  - list_devices: List all Zigbee devices
 *  - get_device: Get device by friendly name or IEEE address
 *  - control_device: Send command to device
 *  - get_device_state: Get device current state
 *  - get_bridge_info: Get bridge information
 *
 * Phase 2 Tools:
 *  - Group Management: list_groups, create_group, delete_group, rename_group, add_device_to_group, remove_device_from_group
 *  - Binding: bind_device, unbind_device, clear_binds
 *  - Device Management: rename_device, remove_device
 *
 * Phase 2 Resources:
 *  - z2m://devices
 *  - z2m://devices/{id}
 *  - z2m://devices/{id}/state
 *  - z2m://groups
 *  - z2m://groups/{id}
 *  - z2m://bridge/info
 *
 * Phase 3 Tools:
 *  - OTA: check_ota_updates, update_device_ota
 *  - Converters: list_converters, generate_external_definition, save_converter, remove_converter
 *  - Network & Health: get_network_map, check_bridge_health, restart_coordinator, permit_join
 *
 * Phase 3 Resources:
 *  - z2m://network/map
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');

/**
 * Error handler utilities for standardized error responses
 */
const ErrorHandler = {
  NOT_FOUND: (type, value) => ({
    content: [{ type: 'text', text: `${type} not found: "${value}"` }],
    isError: true
  }),
  INVALID_PARAM: (param, reason) => ({
    content: [{ type: 'text', text: `Invalid parameter "${param}": ${reason}` }],
    isError: true
  }),
  MISSING_PARAM: (param) => ({
    content: [{ type: 'text', text: `Missing required parameter: "${param}"` }],
    isError: true
  }),
  PERMISSION_DENIED: (reason) => ({
    content: [{ type: 'text', text: `Permission denied: ${reason}` }],
    isError: true
  }),
  UNAVAILABLE: (resource, reason) => ({
    content: [{ type: 'text', text: `${resource} unavailable: ${reason}` }],
    isError: true
  }),
  OPERATION_FAILED: (operation, reason) => ({
    content: [{ type: 'text', text: `${operation} failed: ${reason}` }],
    isError: true
  }),
  INTERNAL_ERROR: (error) => ({
    content: [{ type: 'text', text: `Internal error: ${error.message || String(error)}` }],
    isError: true
  }),
  SUCCESS: (message, data = null) => ({
    content: [{
      type: 'text',
      text: JSON.stringify(data ? { status: 'ok', message, data } : { status: 'ok', message }, null, 2)
    }]
  })
};

/**
 * Safe async handler wrapper for tools
 */
function wrapToolHandler(handler, logger, toolName) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      logger.error(`[MCP Tool ${toolName}] ${error.message}`);
      return ErrorHandler.INTERNAL_ERROR(error);
    }
  };
}

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
      version: '2.0.0'
    });

    // Register tools and resources
    this._registerTools();
    this._registerResources();
  }

  /**
   * Safely resolve a device entity with detailed error handling
   */
  _resolveDevice(deviceId) {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      return { error: ErrorHandler.INVALID_PARAM('device', 'must be a non-empty string') };
    }

    try {
      const entity = this.zigbee.resolveEntity(deviceId.trim());
      if (!entity) {
        return { error: ErrorHandler.NOT_FOUND('Device', deviceId) };
      }
      return { entity };
    } catch (err) {
      this.logger.error(`Device resolution error for "${deviceId}": ${err.message}`);
      return { error: ErrorHandler.INTERNAL_ERROR(err) };
    }
  }

  /**
   * Safely get device state with graceful property handling
   */
  _getDeviceState(device) {
    try {
      const state = this.state.get(device);
      return state || {};
    } catch (err) {
      this.logger.warn(`Failed to get state for device ${device.name || device}: ${err.message}`);
      return {};
    }
  }

  /**
   * Check if z2m bridge is connected
   */
  _isBridgeConnected() {
    try {
      return this.zigbee && this.zigbee.connected !== false;
    } catch {
      return false;
    }
  }

  /**
   * Safely publish MQTT message with error handling
   */
  _publishMqtt(topic, payload, logger = this.logger) {
    try {
      if (!this._isBridgeConnected()) {
        return { error: ErrorHandler.UNAVAILABLE('Bridge', 'MQTT connection not available') };
      }
      this.mqtt.publish(topic, JSON.stringify(payload));
      return { success: true };
    } catch (err) {
      logger.error(`MQTT publish error on ${topic}: ${err.message}`);
      return { error: ErrorHandler.UNAVAILABLE('Bridge', `MQTT error: ${err.message}`) };
    }
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
          
          if (!this._isBridgeConnected()) {
            return ErrorHandler.UNAVAILABLE('Bridge', 'Zigbee2MQTT not connected');
          }

          for (const device of this.zigbee.devicesIterator()) {
            const deviceData = {
              friendly_name: device.name || 'unknown',
              ieee_address: device.ieeeAddr || 'unknown',
              model: device.model || 'unknown',
              manufacturer: device.manufacturerName || 'unknown',
              type: device.type || 'unknown',
              supported: device.supported !== false,
              power_source: device.powerSource || 'unknown',
              available: device.available !== false,
              link_quality: device.linkquality || null
            };

            if (include_state) {
              deviceData.state = this._getDeviceState(device);
            }

            devices.push(deviceData);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ count: devices.length, devices }, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`[MCP] list_devices error: ${error.message}`);
          return ErrorHandler.INTERNAL_ERROR(error);
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
          const resolved = this._resolveDevice(device);
          if (resolved.error) return resolved.error;

          const entity = resolved.entity;
          const deviceData = {
            friendly_name: entity.name || 'unknown',
            ieee_address: entity.ieeeAddr || 'unknown',
            model: entity.model || 'unknown',
            manufacturer: entity.manufacturerName || 'unknown',
            type: entity.type || 'unknown',
            supported: entity.supported !== false,
            power_source: entity.powerSource || 'unknown',
            available: entity.available !== false,
            link_quality: entity.linkquality || null,
            last_seen: entity.lastSeen ? new Date(entity.lastSeen).toISOString() : null,
            state: this._getDeviceState(entity)
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
          return ErrorHandler.INTERNAL_ERROR(error);
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

    // ========== PHASE 2: GROUP MANAGEMENT TOOLS ==========

    /**
     * list_groups — List all groups with member count
     */
    this.server.tool(
      'list_groups',
      {},
      async () => {
        try {
          const groups = [];
          for (const group of this.zigbee.groupsIterator()) {
            groups.push({
              id: group.groupID,
              friendly_name: group.name,
              members_count: group.members?.length || 0,
              members: (group.members || []).map(m => ({
                name: m.name,
                ieee_address: m.ieeeAddr,
                type: m.type
              }))
            });
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }]
          };
        } catch (error) {
          this.logger.error(`[MCP] list_groups error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * create_group — Create new group
     */
    this.server.tool(
      'create_group',
      {
        friendly_name: z.string().describe('Group name'),
        group_id: z.number().optional().describe('Optional group ID (will be auto-assigned if not provided)')
      },
      async ({ friendly_name, group_id }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            friendly_name,
            ...(group_id && { group_id })
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/group/add`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Group creation request sent for: ${friendly_name}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] create_group error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * delete_group — Delete group
     */
    this.server.tool(
      'delete_group',
      {
        group: z.string().describe('Group name or ID'),
        force: z.boolean().optional().describe('Force delete even if group has members (default: false)')
      },
      async ({ group, force = false }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            id: group,
            force
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/group/remove`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Group deletion request sent for: ${group}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] delete_group error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * rename_group — Rename group
     */
    this.server.tool(
      'rename_group',
      {
        group: z.string().describe('Current group name or ID'),
        new_name: z.string().describe('New group name')
      },
      async ({ group, new_name }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            id: group,
            friendly_name: new_name
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/group/options`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Group rename request sent: ${group} → ${new_name}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] rename_group error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * add_device_to_group — Add device to group
     */
    this.server.tool(
      'add_device_to_group',
      {
        device: z.string().describe('Device friendly name or IEEE address'),
        group: z.string().describe('Group name or ID')
      },
      async ({ device, group }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            device: entity.name,
            group,
            action: 'add'
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/group/members/add`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Add device request sent: ${entity.name} → ${group}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] add_device_to_group error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * remove_device_from_group — Remove device from group
     */
    this.server.tool(
      'remove_device_from_group',
      {
        device: z.string().describe('Device friendly name or IEEE address'),
        group: z.string().describe('Group name or ID')
      },
      async ({ device, group }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            device: entity.name,
            group,
            action: 'remove'
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/group/members/remove`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Remove device request sent: ${entity.name} ← ${group}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] remove_device_from_group error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // ========== PHASE 2: BINDING TOOLS ==========

    /**
     * bind_device — Bind source device to target device or group
     */
    this.server.tool(
      'bind_device',
      {
        source: z.string().describe('Source device (friendly name or IEEE address)'),
        target: z.string().optional().describe('Target device or group (optional, omit for groupcast binding)'),
        clusters: z.array(z.string()).optional().describe('Specific clusters to bind (e.g., ["0x0006", "0x0008"])'),
        source_endpoint: z.number().optional().describe('Source endpoint (default: auto-detect)'),
        target_endpoint: z.number().optional().describe('Target endpoint (default: auto-detect)')
      },
      async ({ source, target, clusters, source_endpoint, target_endpoint }) => {
        try {
          const sourceEntity = this.zigbee.resolveEntity(source);
          if (!sourceEntity) {
            return {
              content: [{ type: 'text', text: `Source device not found: ${source}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            source: sourceEntity.name,
            ...(target && { target }),
            ...(clusters && { clusters }),
            ...(source_endpoint !== undefined && { source_endpoint }),
            ...(target_endpoint !== undefined && { target_endpoint })
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/bind`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Bind request sent: ${sourceEntity.name} → ${target || 'group'}`,
                payload
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] bind_device error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * unbind_device — Unbind source device from target
     */
    this.server.tool(
      'unbind_device',
      {
        source: z.string().describe('Source device (friendly name or IEEE address)'),
        target: z.string().describe('Target device or group'),
        clusters: z.array(z.string()).optional().describe('Specific clusters to unbind'),
        source_endpoint: z.number().optional().describe('Source endpoint'),
        target_endpoint: z.number().optional().describe('Target endpoint')
      },
      async ({ source, target, clusters, source_endpoint, target_endpoint }) => {
        try {
          const sourceEntity = this.zigbee.resolveEntity(source);
          if (!sourceEntity) {
            return {
              content: [{ type: 'text', text: `Source device not found: ${source}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            source: sourceEntity.name,
            target,
            ...(clusters && { clusters }),
            ...(source_endpoint !== undefined && { source_endpoint }),
            ...(target_endpoint !== undefined && { target_endpoint })
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/unbind`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Unbind request sent: ${sourceEntity.name} ← ${target}`,
                payload
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] unbind_device error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * clear_binds — Clear all bindings for a device
     */
    this.server.tool(
      'clear_binds',
      {
        device: z.string().describe('Device friendly name or IEEE address')
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

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            device: entity.name
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/unbind_all`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Clear bindings request sent for: ${entity.name}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] clear_binds error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // ========== PHASE 2: DEVICE MANAGEMENT TOOLS ==========

    /**
     * rename_device — Rename a device
     */
    this.server.tool(
      'rename_device',
      {
        device: z.string().describe('Current device name or IEEE address'),
        new_name: z.string().describe('New device friendly name'),
        ha_sync: z.boolean().optional().describe('Sync with Home Assistant (default: true)')
      },
      async ({ device, new_name, ha_sync = true }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            device: entity.name,
            new_name,
            ha_sync
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/rename`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Rename request sent: ${entity.name} → ${new_name}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] rename_device error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * remove_device — Remove device from network
     */
    this.server.tool(
      'remove_device',
      {
        device: z.string().describe('Device friendly name or IEEE address'),
        block: z.boolean().optional().describe('Block device from rejoining (default: true)'),
        force: z.boolean().optional().describe('Force remove even if offline (default: false)')
      },
      async ({ device, block = true, force = false }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            id: entity.name,
            block,
            force
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/remove`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Remove request sent for: ${entity.name}`,
                block,
                force
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] remove_device error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // ========== PHASE 3: OTA UPDATE TOOLS ==========

    /**
     * check_ota_updates — Check for firmware updates for a device
     */
    this.server.tool(
      'check_ota_updates',
      {
        device: z.string().describe('Device friendly name or IEEE address')
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

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            device: entity.name
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/ota_update/check`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `OTA check request sent for: ${entity.name}`,
                device: entity.name,
                ieee_address: entity.ieeeAddr
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] check_ota_updates error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * update_device_ota — Trigger OTA update for a device
     */
    this.server.tool(
      'update_device_ota',
      {
        device: z.string().describe('Device friendly name or IEEE address'),
        force: z.boolean().optional().describe('Force update even if already on latest (default: false)')
      },
      async ({ device, force = false }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            device: entity.name,
            force
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/ota_update/update`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `OTA update request sent for: ${entity.name}`,
                device: entity.name,
                force
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] update_device_ota error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // ========== PHASE 3: CONVERTER TOOLS ==========

    /**
     * list_converters — List installed external converters
     */
    this.server.tool(
      'list_converters',
      {},
      async () => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const converters = [];

          // Get converters from Zigbee2MQTT state
          // Note: Actual converter list comes from z2m's converter registry
          // This is a placeholder that queries via MQTT bridge request
          const converterList = this.zigbee.deviceDefinitions || [];

          for (const converter of converterList) {
            converters.push({
              name: converter.name || 'unknown',
              model: converter.model || 'unknown',
              manufacturer: converter.manufacturerName || 'unknown',
              type: 'built-in'
            });
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                converters: converters,
                total_count: converters.length
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] list_converters error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * generate_external_definition — Generate device definition for external converter
     */
    this.server.tool(
      'generate_external_definition',
      {
        device: z.string().describe('Device friendly name or IEEE address'),
        output_format: z.enum(['json', 'yaml']).optional().describe('Output format (default: json)')
      },
      async ({ device, output_format = 'json' }) => {
        try {
          const entity = this.zigbee.resolveEntity(device);
          if (!entity) {
            return {
              content: [{ type: 'text', text: `Device not found: ${device}` }],
              isError: true
            };
          }

          // Generate definition from device metadata
          const definition = {
            zigbeeModel: [entity.model || 'unknown'],
            model: entity.model || 'unknown',
            vendor: entity.manufacturerName || 'unknown',
            description: `Auto-generated definition for ${entity.name}`,
            devices: [
              {
                ieeeAddr: entity.ieeeAddr
              }
            ],
            fromZigbee: [],
            toZigbee: [],
            exposes: entity.definition?.exposes || [],
            meta: {
              disableDefaultResponse: true
            },
            ota: null
          };

          let output = '';
          if (output_format === 'yaml') {
            // Simple YAML conversion
            output = `zigbeeModel:\n  - ${definition.zigbeeModel[0]}\nmodel: ${definition.model}\nvendor: ${definition.vendor}\ndescription: ${definition.description}\ndevices:\n  - ieeeAddr: ${definition.devices[0].ieeeAddr}\nfromZigbee: []\ntoZigbee: []\nmeta:\n  disableDefaultResponse: true\n`;
          } else {
            output = JSON.stringify(definition, null, 2);
          }

          return {
            content: [{
              type: 'text',
              text: output
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] generate_external_definition error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * save_converter — Save custom converter definition
     */
    this.server.tool(
      'save_converter',
      {
        name: z.string().describe('Converter name (e.g., "my_custom_converter")'),
        definition_json: z.record(z.unknown()).describe('Converter definition object')
      },
      async ({ name, definition_json }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            converter_name: name,
            definition: definition_json
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/add_external_converter`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Save converter request sent: ${name}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] save_converter error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * remove_converter — Remove custom converter
     */
    this.server.tool(
      'remove_converter',
      {
        name: z.string().describe('Converter name to remove')
      },
      async ({ name }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            converter_name: name
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/device/remove_external_converter`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: `Remove converter request sent: ${name}`
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] remove_converter error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // ========== PHASE 3: NETWORK & HEALTH TOOLS ==========

    /**
     * get_network_map — Get Zigbee network topology
     */
    this.server.tool(
      'get_network_map',
      {
        format: z.enum(['json', 'graphviz']).optional().describe('Output format (default: json)')
      },
      async ({ format = 'json' }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;

          // Request network map from Z2M
          this.mqtt.publish(`${baseTopic}/bridge/request/networkmap/routes`, JSON.stringify({
            format
          }));

          // Build local map from device data
          const devices = [];
          const links = [];
          const coordinator = this.zigbee.controller;

          for (const device of this.zigbee.devicesIterator()) {
            devices.push({
              id: device.ieeeAddr,
              name: device.name,
              type: device.type,
              model: device.model,
              available: device.available !== false,
              link_quality: device.linkquality || 0,
              parent: device.parent ? {
                id: device.parent.ieeeAddr,
                name: device.parent.name
              } : null
            });

            // Create link from device to parent
            if (device.parent) {
              links.push({
                source: device.parent.ieeeAddr,
                target: device.ieeeAddr,
                quality: device.linkquality || 0
              });
            }
          }

          let output = '';
          if (format === 'graphviz') {
            // Generate simple graphviz DOT format
            output = 'digraph {\n';
            output += '  rankdir=LR;\n';
            output += `  coordinator [label="${coordinator?.meta?.product || 'Coordinator'}", shape=box];\n`;
            for (const device of devices) {
              const label = `${device.name}\n(${device.type})`;
              output += `  "${device.id}" [label="${label}"];\n`;
            }
            for (const link of links) {
              output += `  "${link.source}" -> "${link.target}" [label="${link.quality}"];\n`;
            }
            output += '}\n';
          } else {
            output = JSON.stringify({
              devices,
              links,
              coordinator: {
                id: coordinator?.ieee_addr || 'unknown',
                type: coordinator?.meta?.product || 'unknown'
              }
            }, null, 2);
          }

          return {
            content: [{
              type: 'text',
              text: output
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] get_network_map error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * check_bridge_health — Check bridge and network health
     */
    this.server.tool(
      'check_bridge_health',
      {
        detailed: z.boolean().optional().describe('Include detailed device health (default: false)')
      },
      async ({ detailed = false }) => {
        try {
          const devices = [];
          let totalDevices = 0;
          let availableDevices = 0;
          let totalBatteryDevices = 0;
          let lowBatteryDevices = 0;
          let totalLinkQuality = 0;
          let minLinkQuality = 255;
          let maxLinkQuality = 0;

          for (const device of this.zigbee.devicesIterator()) {
            totalDevices++;
            if (device.available !== false) availableDevices++;

            const state = this.state.get(device) || {};
            const battery = state.battery;

            if (battery !== undefined) {
              totalBatteryDevices++;
              if (battery < 20) lowBatteryDevices++;
            }

            const lq = device.linkquality || 0;
            totalLinkQuality += lq;
            minLinkQuality = Math.min(minLinkQuality, lq);
            maxLinkQuality = Math.max(maxLinkQuality, lq);

            if (detailed) {
              devices.push({
                name: device.name,
                available: device.available !== false,
                battery: battery || null,
                link_quality: lq,
                last_seen: device.lastSeen ? new Date(device.lastSeen).toISOString() : null
              });
            }
          }

          const avgLinkQuality = totalDevices > 0 ? (totalLinkQuality / totalDevices).toFixed(1) : 0;
          const availabilityPercent = totalDevices > 0 ? ((availableDevices / totalDevices) * 100).toFixed(1) : 0;

          const health = {
            status: availableDevices === totalDevices ? 'healthy' : 'degraded',
            devices: {
              total: totalDevices,
              available: availableDevices,
              unavailable: totalDevices - availableDevices,
              availability_percent: parseFloat(availabilityPercent)
            },
            battery: {
              monitored: totalBatteryDevices,
              low_battery: lowBatteryDevices,
              low_battery_threshold: '< 20%'
            },
            link_quality: {
              average: parseFloat(avgLinkQuality),
              min: minLinkQuality,
              max: maxLinkQuality
            },
            coordinator: {
              type: this.zigbee.controller?.meta?.product || 'unknown',
              ieee_address: this.zigbee.controller?.ieee_addr || 'unknown',
              pan_id: this.zigbee.controller?.meta?.pan_id || 'unknown',
              channel: this.zigbee.controller?.meta?.channel || 'unknown'
            },
            timestamp: new Date().toISOString()
          };

          if (detailed) {
            health.devices_detail = devices;
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(health, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] check_bridge_health error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * restart_coordinator — Restart Zigbee coordinator
     */
    this.server.tool(
      'restart_coordinator',
      {},
      async () => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {};

          this.mqtt.publish(`${baseTopic}/bridge/request/restart`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: 'Restart coordinator request sent',
                warning: 'Bridge will be temporarily unavailable'
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] restart_coordinator error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    /**
     * permit_join — Set permit join mode (allow new devices to join network)
     */
    this.server.tool(
      'permit_join',
      {
        enabled: z.boolean().describe('Enable/disable permit join'),
        timeout: z.number().optional().describe('Timeout in seconds (default: 0 = no timeout)')
      },
      async ({ enabled, timeout = 0 }) => {
        try {
          const baseTopic = this.settings.get().mqtt.base_topic;
          const payload = {
            value: enabled,
            ...(timeout > 0 && { timeout })
          };

          this.mqtt.publish(`${baseTopic}/bridge/request/permit_join`, JSON.stringify(payload));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'ok',
                message: enabled ? 'Permit join enabled' : 'Permit join disabled',
                enabled,
                timeout: timeout > 0 ? `${timeout}s` : 'no timeout'
              }, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] permit_join error: ${error.message}`);
          return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
          };
        }
      }
    );
  }

  // ========== PHASE 2: MCP RESOURCES ==========

  _registerResources() {
    const { ResourceTemplate } = require('@modelcontextprotocol/sdk/types.js');

    /**
     * z2m://devices — List all devices
     */
    this.server.resource(
      'z2m://devices',
      { uri: { type: 'string' } },
      async () => {
        try {
          const devices = [];
          for (const device of this.zigbee.devicesIterator()) {
            devices.push({
              id: device.ieeeAddr,
              name: device.name,
              model: device.model || 'unknown',
              manufacturer: device.manufacturerName || 'unknown',
              type: device.type || 'unknown',
              available: device.available !== false,
              link_quality: device.linkquality || null
            });
          }

          return {
            contents: [{
              uri: 'z2m://devices',
              mimeType: 'application/json',
              text: JSON.stringify(devices, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://devices error: ${error.message}`);
          throw error;
        }
      }
    );

    /**
     * z2m://devices/{id} — Get single device details
     */
    this.server.resource(
      'z2m://devices/{id}',
      { uri: { type: 'string' } },
      async (uri) => {
        try {
          const id = uri.split('/').pop();
          const entity = this.zigbee.resolveEntity(id);
          if (!entity) {
            throw new Error(`Device not found: ${id}`);
          }

          const deviceData = {
            id: entity.ieeeAddr,
            name: entity.name,
            model: entity.model || 'unknown',
            manufacturer: entity.manufacturerName || 'unknown',
            type: entity.type || 'unknown',
            supported: entity.supported !== false,
            power_source: entity.powerSource || 'unknown',
            available: entity.available !== false,
            link_quality: entity.linkquality || null,
            last_seen: entity.lastSeen ? new Date(entity.lastSeen).toISOString() : null,
            state: this.state.get(entity) || {},
            exposes: entity.definition?.exposes || []
          };

          return {
            contents: [{
              uri: `z2m://devices/${id}`,
              mimeType: 'application/json',
              text: JSON.stringify(deviceData, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://devices/{id} error: ${error.message}`);
          throw error;
        }
      }
    );

    /**
     * z2m://devices/{id}/state — Get device state only
     */
    this.server.resource(
      'z2m://devices/{id}/state',
      { uri: { type: 'string' } },
      async (uri) => {
        try {
          const id = uri.split('/')[2];
          const entity = this.zigbee.resolveEntity(id);
          if (!entity) {
            throw new Error(`Device not found: ${id}`);
          }

          const state = this.state.get(entity) || {};

          return {
            contents: [{
              uri: `z2m://devices/${id}/state`,
              mimeType: 'application/json',
              text: JSON.stringify(state, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://devices/{id}/state error: ${error.message}`);
          throw error;
        }
      }
    );

    /**
     * z2m://groups — List all groups
     */
    this.server.resource(
      'z2m://groups',
      { uri: { type: 'string' } },
      async () => {
        try {
          const groups = [];
          for (const group of this.zigbee.groupsIterator()) {
            groups.push({
              id: group.groupID,
              name: group.name,
              members_count: group.members?.length || 0
            });
          }

          return {
            contents: [{
              uri: 'z2m://groups',
              mimeType: 'application/json',
              text: JSON.stringify(groups, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://groups error: ${error.message}`);
          throw error;
        }
      }
    );

    /**
     * z2m://groups/{id} — Get single group with members
     */
    this.server.resource(
      'z2m://groups/{id}',
      { uri: { type: 'string' } },
      async (uri) => {
        try {
          const id = uri.split('/').pop();
          const groupId = isNaN(id) ? id : parseInt(id, 10);
          let group = null;

          for (const g of this.zigbee.groupsIterator()) {
            if (g.groupID === groupId || g.name === id) {
              group = g;
              break;
            }
          }

          if (!group) {
            throw new Error(`Group not found: ${id}`);
          }

          const groupData = {
            id: group.groupID,
            name: group.name,
            members: (group.members || []).map(m => ({
              name: m.name,
              ieee_address: m.ieeeAddr,
              type: m.type
            })),
            members_count: group.members?.length || 0
          };

          return {
            contents: [{
              uri: `z2m://groups/${id}`,
              mimeType: 'application/json',
              text: JSON.stringify(groupData, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://groups/{id} error: ${error.message}`);
          throw error;
        }
      }
    );

    /**
     * z2m://bridge/info — Get bridge configuration and status
     */
    this.server.resource(
      'z2m://bridge/info',
      { uri: { type: 'string' } },
      async () => {
        try {
          const bridgeInfo = {
            version: require('../package.json').version || 'unknown',
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
            contents: [{
              uri: 'z2m://bridge/info',
              mimeType: 'application/json',
              text: JSON.stringify(bridgeInfo, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://bridge/info error: ${error.message}`);
          throw error;
        }
      }
    );

    /**
     * z2m://network/map — Get network topology/map
     */
    this.server.resource(
      'z2m://network/map',
      { uri: { type: 'string' } },
      async () => {
        try {
          const devices = [];
          const links = [];
          const coordinator = this.zigbee.controller;

          for (const device of this.zigbee.devicesIterator()) {
            devices.push({
              id: device.ieeeAddr,
              name: device.name,
              type: device.type,
              model: device.model,
              available: device.available !== false,
              link_quality: device.linkquality || 0,
              parent: device.parent ? {
                id: device.parent.ieeeAddr,
                name: device.parent.name
              } : null
            });

            if (device.parent) {
              links.push({
                source: device.parent.ieeeAddr,
                target: device.ieeeAddr,
                quality: device.linkquality || 0
              });
            }
          }

          const networkMap = {
            devices,
            links,
            coordinator: {
              id: coordinator?.ieee_addr || 'unknown',
              type: coordinator?.meta?.product || 'unknown',
              pan_id: coordinator?.meta?.pan_id || 'unknown',
              channel: coordinator?.meta?.channel || 'unknown'
            },
            timestamp: new Date().toISOString()
          };

          return {
            contents: [{
              uri: 'z2m://network/map',
              mimeType: 'application/json',
              text: JSON.stringify(networkMap, null, 2)
            }]
          };
        } catch (error) {
          this.logger.error(`[MCP] Resource z2m://network/map error: ${error.message}`);
          throw error;
        }
      }
    );
  }
}

module.exports = McpServerImpl;
