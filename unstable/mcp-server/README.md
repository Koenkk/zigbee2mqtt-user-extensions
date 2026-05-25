# Zigbee2MQTT MCP Server Extension

A **Model Context Protocol (MCP)** server extension for Zigbee2MQTT that enables AI tools (Claude, ChatGPT, Cursor, OpenClaw, etc.) to interact with your Zigbee network programmatically.

## ✨ Features

- **Zero configuration** — Works out of the box (copy one file, restart)
- **Direct API access** — No MQTT round-trip, uses z2m internal services
- **Live state** — Real-time device state via EventBus subscriptions
- **Full device control** — Turn on/off, brightness, color, temperature, and more
- **Docker & HA ready** — Works in Docker, Home Assistant addon, standalone
- **Single-file install** — `mcp-server.js` is bundled with all dependencies

## 📋 Tools & Resources

### Phase 1 Tools (Core)

| Tool | Purpose | Parameters |
|------|---------|------------|
| `list_devices` | List all Zigbee devices | `include_state` (bool) |
| `get_device` | Get device details | `device` (name/address), `include_exposes` (bool) |
| `control_device` | Send commands | `device` (name/address), `payload` (object) |
| `get_device_state` | Get current state | `device` (name/address) |
| `get_bridge_info` | Bridge info & stats | None |

### Phase 2 Tools (Groups, Bindings, Device Management)

#### Group Management

| Tool | Purpose | Parameters |
|------|---------|------------||
| `list_groups` | List all groups with member counts | None |
| `create_group` | Create new group | `friendly_name` (string), `group_id` (number, optional) |
| `delete_group` | Delete group | `group` (name/id), `force` (bool, optional) |
| `rename_group` | Rename group | `group` (name/id), `new_name` (string) |
| `add_device_to_group` | Add device to group | `device` (name/address), `group` (name/id) |
| `remove_device_from_group` | Remove device from group | `device` (name/address), `group` (name/id) |

#### Binding Management

| Tool | Purpose | Parameters |
|------|---------|------------||
| `bind_device` | Bind source to target/group | `source` (name/address), `target` (optional), `clusters` (array, optional), `source_endpoint` (num, optional), `target_endpoint` (num, optional) |
| `unbind_device` | Unbind source from target | `source` (name/address), `target` (name/id), `clusters` (array, optional), `source_endpoint` (num, optional), `target_endpoint` (num, optional) |
| `clear_binds` | Clear all bindings for device | `device` (name/address) |

#### Device Management

| Tool | Purpose | Parameters |
|------|---------|------------||
| `rename_device` | Rename device | `device` (name/address), `new_name` (string), `ha_sync` (bool, optional) |
| `remove_device` | Remove device from network | `device` (name/address), `block` (bool, optional), `force` (bool, optional) |

### Phase 2 Resources (MCP)

Resources are read-only endpoints for querying data:

| URI | Purpose |
|-----|----------|
| `z2m://devices` | List all devices |
| `z2m://devices/{id}` | Get single device details |
| `z2m://devices/{id}/state` | Get device state only |
| `z2m://groups` | List all groups |
| `z2m://groups/{id}` | Get single group with members |
| `z2m://bridge/info` | Get bridge configuration & status |

## 🚀 Installation

### Standalone Zigbee2MQTT

1. **Download** the bundled extension:
   ```bash
   curl -o data/external_extensions/mcp-server.js https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js
   ```

2. **Restart** Zigbee2MQTT:
   ```bash
   # Docker
   docker restart zigbee2mqtt

   # Systemd
   sudo systemctl restart zigbee2mqtt

   # Manual
   Ctrl+C, then npm start
   ```

3. **Verify** the extension loaded:
   ```bash
   # Check logs for: "[MCP] Server started successfully on 0.0.0.0:4747"
   docker logs zigbee2mqtt | grep MCP
   ```

### Docker

Add to your `docker-compose.yml`:

```yaml
services:
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:latest
    volumes:
      - ./data:/app/data
    environment:
      - ZIGBEE2MQTT_CONFIG_MCP_PORT=4747
      - ZIGBEE2MQTT_CONFIG_MCP_HOST=0.0.0.0
    ports:
      - "8080:8080"
      - "4747:4747"  # MCP server port
```

Then:
```bash
# Download extension
curl -o data/external_extensions/mcp-server.js \
  https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js

docker compose up -d
```

### Home Assistant (Add-on)

The extension is automatically loaded if placed in `data/external_extensions/`. If using the [HA addon](https://github.com/zigbee2mqtt/hassio-zigbee2mqtt):

1. Place `mcp-server.js` in the addon's `data/external_extensions/` directory
2. Restart the addon
3. The MCP server will be available on port 4747 (internal to the container)

To access from outside the container, map the port in your docker-compose or HA configuration.

## ⚙️ Configuration

The extension reads configuration from **environment variables** (no config file needed):

| Variable | Default | Description |
|----------|---------|-------------|
| `ZIGBEE2MQTT_CONFIG_MCP_PORT` | `4747` | HTTP server port |
| `ZIGBEE2MQTT_CONFIG_MCP_HOST` | `0.0.0.0` | HTTP server bind address |
| `ZIGBEE2MQTT_CONFIG_MCP_ENABLED` | `true` | Enable/disable extension |

### Examples

```bash
# Custom port
export ZIGBEE2MQTT_CONFIG_MCP_PORT=5000

# Bind to localhost only (for development)
export ZIGBEE2MQTT_CONFIG_MCP_HOST=127.0.0.1

# Disable the extension
export ZIGBEE2MQTT_CONFIG_MCP_ENABLED=false
```

## 🧠 Using with AI Tools

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zigbee2mqtt": {
      "command": "curl",
      "args": ["http://localhost:4747/mcp"],
      "type": "http"
    }
  }
}
```

### Cursor

In your Cursor settings, add the MCP server:

```json
{
  "mcp": {
    "zigbee2mqtt": {
      "url": "http://localhost:4747/mcp"
    }
  }
}
```

### OpenClaw

Configure in your OpenClaw agent settings:

```yaml
mcp_servers:
  - name: zigbee2mqtt
    transport: http
    endpoint: http://localhost:4747/mcp
```

## 📚 Detailed Tool & Resource Reference

### Phase 1: Core Devices

#### `list_devices`

List all known Zigbee devices with their current state.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "list_devices",
    "arguments": {
      "include_state": true
    }
  }
}
```

**Response (truncated):**
```json
[
  {
    "friendly_name": "living_room_lamp",
    "ieee_address": "0x00158d0002a7b8f1",
    "model": "LCT015",
    "manufacturer": "Philips",
    "type": "Router",
    "supported": true,
    "power_source": "Mains (single phase)",
    "available": true,
    "link_quality": 155,
    "state": {
      "state": "ON",
      "brightness": 254,
      "color": {
        "r": 255,
        "g": 200,
        "b": 100
      }
    }
  }
]
```

#### `get_device`

Get detailed information about a specific device.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_device",
    "arguments": {
      "device": "living_room_lamp",
      "include_exposes": true
    }
  }
}
```

**Response:**
```json
{
  "friendly_name": "living_room_lamp",
  "ieee_address": "0x00158d0002a7b8f1",
  "model": "LCT015",
  "available": true,
  "link_quality": 155,
  "state": {
    "state": "ON",
    "brightness": 254
  },
  "exposes": [
    {
      "type": "light",
      "features": [
        { "name": "state", "type": "binary", "access": 3 },
        { "name": "brightness", "type": "numeric", "access": 3, "value_min": 0, "value_max": 254 }
      ]
    }
  ]
}
```

#### `control_device`

Send a command to a device.

**Request (turn on):**
```json
{
  "method": "tools/call",
  "params": {
    "name": "control_device",
    "arguments": {
      "device": "living_room_lamp",
      "payload": { "state": "ON" }
    }
  }
}
```

**Request (set brightness):**
```json
{
  "method": "tools/call",
  "params": {
    "name": "control_device",
    "arguments": {
      "device": "living_room_lamp",
      "payload": { "brightness": 128 }
    }
  }
}
```

**Request (set color):**
```json
{
  "method": "tools/call",
  "params": {
    "name": "control_device",
    "arguments": {
      "device": "living_room_lamp",
      "payload": { "color": { "r": 255, "g": 0, "b": 0 } }
    }
  }
}
```

#### `get_device_state`

Get the current state of a device.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_device_state",
    "arguments": {
      "device": "living_room_lamp"
    }
  }
}
```

**Response:**
```json
{
  "state": "ON",
  "brightness": 254,
  "color": {
    "r": 255,
    "g": 200,
    "b": 100
  }
}
```

#### `get_bridge_info`

Get bridge information and network statistics.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "get_bridge_info",
    "arguments": {}
  }
}
```

**Response:**
```json
{
  "version": "1.0.0",
  "z2m_version": "via extension",
  "devices_count": 12,
  "groups_count": 3,
  "coordinator": {
    "type": "Enbrighten Zigbee USB Dongle",
    "ieee_address": "00:0d:6f:00:0a:90:69:e7"
  },
  "network": {
    "panid": "0x1234",
    "channel": 11
  },
  "timestamp": "2026-05-25T07:23:00.000Z"
}
```

### Phase 2: Group Management

#### `list_groups`

List all groups with member information.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "list_groups",
    "arguments": {}
  }
}
```

**Response:**
```json
[
  {
    "id": 1,
    "friendly_name": "living_room_lights",
    "members_count": 3,
    "members": [
      {
        "name": "lamp_1",
        "ieee_address": "0x00158d0002a7b8f1",
        "type": "Light"
      }
    ]
  }
]
```

#### `create_group`

Create a new group.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "create_group",
    "arguments": {
      "friendly_name": "bedroom_lights",
      "group_id": 5
    }
  }
}
```

#### `rename_group`

Rename an existing group.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "rename_group",
    "arguments": {
      "group": "living_room_lights",
      "new_name": "living_room_main_lights"
    }
  }
}
```

#### `add_device_to_group` / `remove_device_from_group`

Add or remove devices from groups.

**Request (add):**
```json
{
  "method": "tools/call",
  "params": {
    "name": "add_device_to_group",
    "arguments": {
      "device": "lamp_2",
      "group": "living_room_lights"
    }
  }
}
```

### Phase 2: Binding Management

#### `bind_device`

Bind a source device to a target device or group.

**Request (bind to device):**
```json
{
  "method": "tools/call",
  "params": {
    "name": "bind_device",
    "arguments": {
      "source": "remote_control",
      "target": "lamp_1",
      "clusters": ["0x0006", "0x0008"]
    }
  }
}
```

**Request (bind to group):**
```json
{
  "method": "tools/call",
  "params": {
    "name": "bind_device",
    "arguments": {
      "source": "remote_control",
      "target": "living_room_lights"
    }
  }
}
```

#### `clear_binds`

Clear all bindings for a device.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "clear_binds",
    "arguments": {
      "device": "remote_control"
    }
  }
}
```

### Phase 2: Device Management

#### `rename_device`

Rename a device with optional Home Assistant sync.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "rename_device",
    "arguments": {
      "device": "lamp_1",
      "new_name": "living_room_main_lamp",
      "ha_sync": true
    }
  }
}
```

#### `remove_device`

Remove a device from the network.

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "remove_device",
    "arguments": {
      "device": "lamp_broken",
      "block": true,
      "force": false
    }
  }
}
```

### Phase 2: MCP Resources

Resources are read-only data endpoints accessed via the MCP `resources/read` method.

#### `z2m://devices`

List all devices.

**Request:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "z2m://devices"
  }
}
```

**Response:**
```json
[
  {
    "id": "0x00158d0002a7b8f1",
    "name": "living_room_lamp",
    "model": "LCT015",
    "manufacturer": "Philips",
    "available": true,
    "link_quality": 155
  }
]
```

#### `z2m://devices/{id}`

Get detailed information for a single device.

**Request:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "z2m://devices/living_room_lamp"
  }
}
```

#### `z2m://devices/{id}/state`

Get only the state for a device.

**Request:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "z2m://devices/living_room_lamp/state"
  }
}
```

#### `z2m://groups`

List all groups.

**Request:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "z2m://groups"
  }
}
```

#### `z2m://groups/{id}`

Get a group with its members.

**Request:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "z2m://groups/living_room_lights"
  }
}
```

#### `z2m://bridge/info`

Get bridge configuration and status.

**Request:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "z2m://bridge/info"
  }
}
```

## 🔍 Health Check

The HTTP server provides a health check endpoint:

```bash
curl http://localhost:4747/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-05-25T07:23:00.000Z"
}
```

## 🚀 Usage Examples

### With Claude Desktop

```json
{
  "mcpServers": {
    "zigbee2mqtt": {
      "command": "curl",
      "args": ["http://localhost:4747/mcp"],
      "type": "http"
    }
  }
}
```

### Reading Resources with MCP Client

```javascript
const client = new McpClient();

// Get all devices
const devices = await client.resources.read({ uri: 'z2m://devices' });

// Get single device state
const lampState = await client.resources.read({ uri: 'z2m://devices/living_room_lamp/state' });

// Get group with members
const groupMembers = await client.resources.read({ uri: 'z2m://groups/living_room_lights' });
```

### Real-World Example: Smart Home Automation

**Scenario:** "Turn on all lights in the living room and bind a remote control to them"

```python
# 1. Create a group (if it doesn't exist)
mcp.call_tool('create_group', {
    'friendly_name': 'living_room_all_lights'
})

# 2. Add lights to group
for light in ['lamp_1', 'lamp_2', 'ceiling_light']:
    mcp.call_tool('add_device_to_group', {
        'device': light,
        'group': 'living_room_all_lights'
    })

# 3. Bind remote to group
mcp.call_tool('bind_device', {
    'source': 'living_room_remote',
    'target': 'living_room_all_lights',
    'clusters': ['0x0006', '0x0008']  # on/off, brightness
})

# 4. Control the group
mcp.call_tool('control_device', {
    'device': 'living_room_all_lights',
    'payload': {'state': 'ON', 'brightness': 200}
})
```

## 🐛 Troubleshooting

### Extension not loading

**Check the logs:**
```bash
docker logs zigbee2mqtt | grep -i mcp
```

**Verify the file:**
```bash
ls -la data/external_extensions/mcp-server.js
```

**Ensure it's executable:**
```bash
chmod +x data/external_extensions/mcp-server.js
```

### Port already in use

Change the port:
```bash
export ZIGBEE2MQTT_CONFIG_MCP_PORT=5000
docker restart zigbee2mqtt
```

### Connection refused

**Verify the server is listening:**
```bash
curl http://localhost:4747/health
```

**Check firewall:** Ensure port 4747 is open on your network.

### Device not found error

**Double-check the device name** — use the exact friendly name from z2m:
```bash
# See all device names
curl http://localhost:4747/mcp -X POST -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "list_devices", "arguments": {}}}'
```

## 📖 Architecture

```
AI Tool (Claude, Cursor, etc.)
    │
    ├─► HTTP POST /mcp
    │
Zigbee2MQTT MCP Server Extension
    │
    ├─► JSON-RPC 2.0 Handler
    │
    ├─► Tools (list_devices, get_device, control_device, etc.)
    │
    └─► Z2M Internal Services (zigbee, mqtt, state, eventBus)
         │
         └─► Zigbee Network
```

## 🔐 Security

- **No authentication** — For local networks only (use a firewall or VPN for remote access)
- **CORS enabled** — Allows browser-based clients (configure carefully)
- **No state mutation without permission** — AI tools must explicitly call mutation tools

## 📜 License

Same as Zigbee2MQTT (AGPL-3.0)

## 🤝 Contributing

Issues, PRs, and suggestions welcome in the [zigbee2mqtt-user-extensions](https://github.com/pranjal-joshi/zigbee2mqtt-user-extensions) repository.

---

**Built with ❤️ for the Zigbee2MQTT community**
