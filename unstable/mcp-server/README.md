# Zigbee2MQTT MCP Server Extension

A **Model Context Protocol (MCP)** server extension for Zigbee2MQTT that enables AI tools (Claude, ChatGPT, Cursor, OpenClaw, etc.) to interact with your Zigbee network programmatically.

## 📖 Quick Start

1. **Download:** Copy `mcp-server.js` to `data/external_extensions/`
2. **Restart:** Restart Zigbee2MQTT
3. **Test:** Curl `http://localhost:4747/health`
4. **Configure AI:** Point Claude/Cursor/OpenClaw to `http://localhost:4747/mcp`
5. **Use:** `list_devices`, `control_device`, `check_ota_updates`, etc.

See [Installation](#-installation) below for detailed setup.

## ✨ Features

- **Zero configuration** — Works out of the box (copy one file, restart)
- **Direct API access** — No MQTT round-trip, uses z2m internal services
- **Live state** — Real-time device state via EventBus subscriptions
- **Full device control** — Turn on/off, brightness, color, temperature, and more
- **OTA Updates** — Check and trigger firmware updates for devices
- **Network Monitoring** — View network topology and health metrics
- **Group Management** — Create, rename, and manage device groups
- **Binding Support** — Direct device-to-device bindings and group bindings
- **Docker & HA ready** — Works in Docker, Home Assistant addon, standalone
- **Single-file install** — `mcp-server.js` is bundled with all dependencies
- **Production hardened** — Comprehensive error handling, validation, and graceful degradation

## 📖 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Tools & Resources](#-tools--resources)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Using with AI Tools](#-using-with-ai-tools)
- [Common Use Cases](#-common-use-cases)
- [Troubleshooting](#-troubleshooting)
- [Performance & Tuning](#-performance--tuning)
- [Security](#-security)
- [Architecture](#-architecture)
- [FAQ](#-faq)

## ✨ Features

## 📋 Tools & Resources

### Phase 1 Tools (Core Device Control)

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
|------|---------|------------|
| `list_groups` | List all groups with member counts | None |
| `create_group` | Create new group | `friendly_name` (string), `group_id` (number, optional) |
| `delete_group` | Delete group | `group` (name/id), `force` (bool, optional) |
| `rename_group` | Rename group | `group` (name/id), `new_name` (string) |
| `add_device_to_group` | Add device to group | `device` (name/address), `group` (name/id) |
| `remove_device_from_group` | Remove device from group | `device` (name/address), `group` (name/id) |

#### Binding Management

| Tool | Purpose | Parameters |
|------|---------|------------|
| `bind_device` | Bind source to target/group | `source` (name/address), `target` (optional), `clusters` (array, optional) |
| `unbind_device` | Unbind source from target | `source` (name/address), `target` (name/id) |
| `clear_binds` | Clear all bindings | `device` (name/address) |

#### Device Management

| Tool | Purpose | Parameters |
|------|---------|------------|
| `rename_device` | Rename device | `device` (name/address), `new_name` (string) |
| `remove_device` | Remove device from network | `device` (name/address), `block` (bool, optional) |

### Phase 3 Tools (OTA, Converters, Network & Health)

#### OTA Updates

| Tool | Purpose | Parameters |
|------|---------|------------|
| `check_ota_updates` | Check for firmware updates | `device` (name/address) |
| `update_device_ota` | Trigger OTA firmware update | `device` (name/address), `force` (bool, optional) |

#### Converter Management

| Tool | Purpose | Parameters |
|------|---------|------------|
| `list_converters` | List installed converters | None |
| `generate_external_definition` | Generate device definition | `device` (name/address), `output_format` ('json'\|'yaml') |
| `save_converter` | Save custom converter | `name` (string), `definition_json` (object) |
| `remove_converter` | Remove converter | `name` (string) |

#### Network & Health Checks

| Tool | Purpose | Parameters |
|------|---------|------------|
| `get_network_map` | Get network topology | `format` ('json'\|'graphviz', optional) |
| `check_bridge_health` | Check health & metrics | `detailed` (bool, optional) |
| `restart_coordinator` | Restart coordinator | None |
| `permit_join` | Enable/disable pairing | `enabled` (bool), `timeout` (seconds, optional) |

**Total: 26 tools + 7 resources**

### MCP Resources

| URI | Purpose | Phase |
|-----|---------|-------|
| `z2m://devices` | List all devices | 2 |
| `z2m://devices/{id}` | Single device details | 2 |
| `z2m://devices/{id}/state` | Device state only | 2 |
| `z2m://groups` | List all groups | 2 |
| `z2m://groups/{id}` | Group with members | 2 |
| `z2m://bridge/info` | Bridge config & status | 2 |
| `z2m://network/map` | Network topology | 3 |

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
      - "4747:4747"
```

Then:
```bash
curl -o data/external_extensions/mcp-server.js \
  https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js

docker compose up -d
```

### Home Assistant

1. Place `mcp-server.js` in addon's `data/external_extensions/`
2. Restart the addon
3. MCP available on port 4747

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ZIGBEE2MQTT_CONFIG_MCP_PORT` | `4747` | HTTP server port |
| `ZIGBEE2MQTT_CONFIG_MCP_HOST` | `0.0.0.0` | Bind address |
| `ZIGBEE2MQTT_CONFIG_MCP_ENABLED` | `true` | Enable/disable |

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

```yaml
mcp_servers:
  - name: zigbee2mqtt
    transport: http
    endpoint: http://localhost:4747/mcp
```

## 📚 Common Use Cases

### OTA Firmware Updates

**Check if updates are available:**
```python
mcp.call_tool('check_ota_updates', {'device': 'living_room_lamp'})
```

**Trigger update:**
```python
mcp.call_tool('update_device_ota', {
    'device': 'living_room_lamp',
    'force': False
})
```

### Network Health & Monitoring

**Get detailed health stats:**
```python
health = mcp.call_tool('check_bridge_health', {'detailed': True})
# Returns: device availability, battery levels, link quality, coordinator status
```

**View network topology:**
```python
# JSON format
map_json = mcp.call_tool('get_network_map', {'format': 'json'})

# Graphviz format (for visualization)
map_viz = mcp.call_tool('get_network_map', {'format': 'graphviz'})
```

### Permit Join (Pairing Mode)

**Enable pairing for 120 seconds:**
```python
mcp.call_tool('permit_join', {
    'enabled': True,
    'timeout': 120
})
```

**Disable pairing:**
```python
mcp.call_tool('permit_join', {'enabled': False})
```

### Converter Management

**List available converters:**
```python
converters = mcp.call_tool('list_converters', {})
```

**Generate device definition for custom converter:**
```python
definition = mcp.call_tool('generate_external_definition', {
    'device': 'my_custom_device',
    'output_format': 'json'
})
```

**Save custom converter:**
```python
mcp.call_tool('save_converter', {
    'name': 'my_custom_converter',
    'definition_json': {
        'zigbeeModel': ['MY_MODEL'],
        'model': 'MY_MODEL',
        'vendor': 'CustomVendor',
        'description': 'My custom device',
        'fromZigbee': [],
        'toZigbee': [],
        'exposes': []
    }
})
```

## 🔧 Troubleshooting

### Extension not loading

```bash
docker logs zigbee2mqtt | grep -i mcp
```

### Port already in use

```bash
export ZIGBEE2MQTT_CONFIG_MCP_PORT=5000
docker restart zigbee2mqtt
```

### Connection refused

```bash
curl http://localhost:4747/health
```

### Device not found

```bash
# Get exact device names
curl http://localhost:4747/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "list_devices", "arguments": {}}}'
```

## 📊 Health Check Endpoint

```bash
curl http://localhost:4747/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-05-25T07:48:00.000Z"
}
```

## 🏗️ Architecture

```
AI Tool (Claude, Cursor, OpenClaw)
    ↓
HTTP POST /mcp (JSON-RPC 2.0)
    ↓
MCP Server Extension
    ├─ Tools (26 total)
    ├─ Resources (7 total)
    ├─ Error Handler (standardized responses)
    ├─ Validation Layer (parameter checking)
    ↓
Zigbee2MQTT Internal Services
    ├─ zigbee (device mgmt)
    ├─ mqtt (publish/subscribe)
    ├─ state (device state)
    └─ eventBus (live updates)
    ↓
Zigbee Network (2.4GHz mesh)
```

## ⚡ Performance & Tuning

### Bundle Size
- **Current:** 1.3 MB (bundled with all dependencies)
- **Memory:** ~50-100 MB typical (Zigbee2MQTT overhead)
- **CPU:** Minimal (only active when tools called)

### Optimization Tips

**Max Devices:** No hard limit, but recommend <500 in a single network
```bash
# Monitor device count
curl http://localhost:4747/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "get_bridge_info"}}'
```

**Network Map Performance:** For networks >200 devices, use JSON format instead of Graphviz
```bash
curl -d '{"method": "tools/call", "params": {"name": "get_network_map", "arguments": {"format": "json"}}}'
```

**Connection Pooling:** HTTP server reuses connections (no need to configure)

### Health Monitoring

```bash
# Check health endpoint (lightweight)
curl http://localhost:4747/health

# Check detailed bridge health
curl -d '{"method": "tools/call", "params": {"name": "check_bridge_health", "arguments": {"detailed": true}}}'
```

## 🔐 Security Considerations

### Local Network Only
- **No authentication** — This extension has no auth layer
- **Firewall required** — Do NOT expose port 4747 directly to internet
- **Use VPN/SSH tunnel** for remote access

### Safe by Default
- **Parameter validation** — All inputs are checked and sanitized
- **Graceful errors** — Invalid requests return 400, not crashes
- **No code execution** — Tool calls are device commands only, not arbitrary code
- **Idempotent operations** — Most operations are safe to retry

### Best Practices

```bash
# ❌ UNSAFE: Exposed to internet
ufw allow 4747
expose 4747 in cloud

# ✅ SAFE: Firewalled locally
Firewall blocks external access to 4747
SSH tunnel for remote: ssh -L 4747:localhost:4747 user@home
```

### CORS Configuration

CORS is enabled for localhost. To restrict to specific origins:

```javascript
// In mcp-server-impl.js, modify _setupServer():
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
```

## 📖 Error Handling

All tools return standardized error responses:

```json
{
  "content": [{
    "type": "text",
    "text": "Device not found: \"living_room_lamp\""
  }],
  "isError": true
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Device not found | Wrong name/address | Use `list_devices` to verify |
| Bridge unavailable | Z2M not connected | Check `docker logs` or restart Z2M |
| Permission denied | Feature not supported | Check device `exposes` |
| Operation failed | MQTT error | Restart Zigbee2MQTT |
| Invalid parameter | Wrong type/value | Check parameter types (string vs number) |

## ❓ FAQ

### Q: Does this work with Home Assistant?
**A:** Yes! Place `mcp-server.js` in the Zigbee2MQTT addon's `data/external_extensions/` folder and restart.

### Q: Can I use this with multiple AI tools simultaneously?
**A:** Yes. Multiple clients can connect to the same MCP server. They don't interfere.

### Q: What happens if Zigbee2MQTT crashes?
**A:** The MCP server runs as an extension. It's part of Z2M, so it crashes too. Restart Z2M.

### Q: Can I run this on a remote machine?
**A:** Yes, but use SSH tunneling or VPN. Don't expose port 4747 directly.

### Q: Does it work on Windows?
**A:** Yes. If running Zigbee2MQTT in Docker, port 4747 must be exposed to host.

### Q: How do I update the extension?
**A:** Re-download `mcp-server.js` and restart Zigbee2MQTT. No configuration needed.

### Q: Can I customize the HTTP port?
**A:** Yes, set `ZIGBEE2MQTT_CONFIG_MCP_PORT=5000` before starting.

### Q: What if my device isn't responding?
**A:** Check device availability in `list_devices`. If `available: false`, the device is offline or unreachable.

### Q: Can I bind devices across networks?
**A:** No. Binding only works within a single Zigbee network.

### Q: How often is device state updated?
**A:** In real-time (from Z2M EventBus). State is fresh within milliseconds.

### Q: What's the difference between `control_device` and binding?
**A:** `control_device` sends direct commands (one-time). Binding creates a permanent link (coordinator-less automation).

### Q: Can I use this without MQTT?
**A:** Yes. This extension doesn't require MQTT publishing. You control devices directly via Z2M internal APIs.

## 📈 Version Info

- **Phase 1:** Core device control (5 tools)
- **Phase 2:** Groups, bindings, device management (16 tools, 6 resources)
- **Phase 3:** OTA, converters, network & health (10 tools, 1 resource)
- **Phase 4:** Error handling, comprehensive documentation, production hardening

**Total: 26 tools + 7 resources**

Build: `mcp-server.js` 1.3 MB (bundled with dependencies)

## 📜 License

AGPL-3.0 (same as Zigbee2MQTT)

## 🤝 Contributing

Issues, PRs, and suggestions welcome in the [zigbee2mqtt-user-extensions](https://github.com/pranjal-joshi/zigbee2mqtt-user-extensions) repository.

---

**Built with ❤️ for the Zigbee2MQTT community**
