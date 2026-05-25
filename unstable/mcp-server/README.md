# Zigbee2MQTT MCP Server Extension

A **Model Context Protocol (MCP)** server extension for Zigbee2MQTT that enables AI tools (Claude, ChatGPT, Cursor, OpenClaw, etc.) to interact with your Zigbee network programmatically.

## ✨ Features

- **Zero configuration** — Works out of the box (copy one file, restart)
- **Direct API access** — No MQTT round-trip, uses z2m internal services
- **Live state** — Real-time device state via EventBus subscriptions
- **Full device control** — Turn on/off, brightness, color, temperature, and more
- **Docker & HA ready** — Works in Docker, Home Assistant addon, standalone
- **Single-file install** — `mcp-server.js` is bundled with all dependencies

## 📋 Phase 1 Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `list_devices` | List all Zigbee devices | `include_state` (bool) |
| `get_device` | Get device details | `device` (name/address), `include_exposes` (bool) |
| `control_device` | Send commands | `device` (name/address), `payload` (object) |
| `get_device_state` | Get current state | `device` (name/address) |
| `get_bridge_info` | Bridge info & stats | None |

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

## 📚 Tool Reference

### `list_devices`

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

### `get_device`

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

### `control_device`

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

### `get_device_state`

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

### `get_bridge_info`

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
