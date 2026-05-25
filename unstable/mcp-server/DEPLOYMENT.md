# Deployment Guide

Comprehensive guide for deploying the Zigbee2MQTT MCP Server Extension in various environments.

## Table of Contents

1. [Standalone Installation](#standalone-installation)
2. [Docker & Docker Compose](#docker--docker-compose)
3. [Home Assistant Addon](#home-assistant-addon)
4. [Kubernetes & Podman](#kubernetes--podman)
5. [Integration with AI Tools](#integration-with-ai-tools)
6. [Monitoring & Health Checks](#monitoring--health-checks)
7. [Troubleshooting](#troubleshooting)

---

## Standalone Installation

### Prerequisites

- Zigbee2MQTT running locally or remotely
- Node.js 20.15+ (for Zigbee2MQTT)
- Internet connection (for initial download)

### Steps

1. **Download the extension:**
```bash
mkdir -p /path/to/zigbee2mqtt/data/external_extensions
curl -o /path/to/zigbee2mqtt/data/external_extensions/mcp-server.js \
  https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js
```

2. **Verify the file:**
```bash
file /path/to/zigbee2mqtt/data/external_extensions/mcp-server.js
# Should output: JavaScript source code
```

3. **Restart Zigbee2MQTT:**
```bash
# Systemd
sudo systemctl restart zigbee2mqtt

# Manual
cd /path/to/zigbee2mqtt
npm start

# Docker
docker restart zigbee2mqtt
```

4. **Verify it loaded:**
```bash
# Check logs for MCP startup message
docker logs zigbee2mqtt | grep -i mcp
# Or
tail -f /var/log/zigbee2mqtt/latest.log | grep MCP
```

5. **Test the endpoint:**
```bash
curl -X POST http://localhost:4747/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
```

---

## Docker & Docker Compose

### Basic Docker Run

```bash
docker run -d \
  --name zigbee2mqtt \
  --device /dev/ttyUSB0:/dev/ttyUSB0 \
  -e ZIGBEE2MQTT_CONFIG_MCP_PORT=4747 \
  -e ZIGBEE2MQTT_CONFIG_MCP_HOST=0.0.0.0 \
  -p 8080:8080 \
  -p 4747:4747 \
  -v zigbee2mqtt_data:/app/data \
  koenkk/zigbee2mqtt:latest
```

Then add the extension:
```bash
docker exec zigbee2mqtt sh -c '\
  curl -o /app/data/external_extensions/mcp-server.js \
  https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js'

docker restart zigbee2mqtt
```

### Docker Compose (Full Stack)

```yaml
version: '3.8'

services:
  # Zigbee2MQTT with MCP extension
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:latest
    container_name: zigbee2mqtt
    restart: unless-stopped
    privileged: true
    
    # USB radio device
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0

    # Ports
    ports:
      - "8080:8080"    # Web UI
      - "4747:4747"    # MCP Server (exposed for remote access)

    # Volumes
    volumes:
      - ./zigbee2mqtt_data:/app/data
      - /run/dbus:/run/dbus:ro

    # Environment
    environment:
      TZ: ${TZ:-UTC}
      ZIGBEE2MQTT_CONFIG_HOMEASSISTANT: "true"
      ZIGBEE2MQTT_CONFIG_HOMEASSISTANT_DISCOVERY_TOPIC: "homeassistant"
      ZIGBEE2MQTT_CONFIG_PERMIT_JOIN: "false"
      ZIGBEE2MQTT_CONFIG_MQTT_SERVER: "mqtt://mosquitto:1883"
      ZIGBEE2MQTT_CONFIG_MQTT_USER: "${MQTT_USER:-zigbee}"
      ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD: "${MQTT_PASS:-zigbee}"
      
      # MCP Configuration
      ZIGBEE2MQTT_CONFIG_MCP_ENABLED: "true"
      ZIGBEE2MQTT_CONFIG_MCP_PORT: "4747"
      ZIGBEE2MQTT_CONFIG_MCP_HOST: "0.0.0.0"

    # Healthcheck
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4747/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

    depends_on:
      - mosquitto

  # MQTT Broker (optional)
  mosquitto:
    image: eclipse-mosquitto:latest
    container_name: mosquitto
    restart: unless-stopped
    ports:
      - "1883:1883"
    volumes:
      - ./mosquitto_data:/mosquitto/data
      - ./mosquitto_config:/mosquitto/config

  # Optional: Portainer for management
  portainer:
    image: portainer/portainer-ce:latest
    container_name: portainer
    restart: unless-stopped
    ports:
      - "9000:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./portainer_data:/data

volumes:
  zigbee2mqtt_data:
  mosquitto_data:
  portainer_data:

networks:
  default:
    name: zigbee_network
```

**Start the stack:**
```bash
# Create environment file
cat > .env << EOF
TZ=UTC
MQTT_USER=zigbee
MQTT_PASS=zigbee_secure_password
EOF

# Create data directories
mkdir -p zigbee2mqtt_data mosquitto_data mosquitto_config portainer_data

# Configure Mosquitto
cat > mosquitto_config/mosquitto.conf << EOF
listener 1883
protocol mqtt
allow_anonymous false
password_file /mosquitto/config/passwd

listener 9001
protocol websockets
EOF

mosquitto_passwd -b mosquitto_config/passwd zigbee zigbee_secure_password

# Start services
docker compose up -d

# Verify MCP
curl http://localhost:4747/health
```

**Post-startup setup:**
```bash
# Install MCP extension
docker exec zigbee2mqtt mkdir -p /app/data/external_extensions
docker exec zigbee2mqtt curl -o /app/data/external_extensions/mcp-server.js \
  https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js

# Restart to load extension
docker compose restart zigbee2mqtt
```

---

## Home Assistant Addon

### Installation

1. **Add custom repository:**
   - Settings → Addons → Addon Store (three dots) → Repositories
   - Add: `https://github.com/pranjal-joshi/zigbee2mqtt-user-extensions`
   - Click Add

2. **Install Zigbee2MQTT addon** (if not already installed)

3. **Add MCP extension to addon:**
   ```bash
   # SSH into Home Assistant
   ssh root@homeassistant
   
   # Navigate to addon data
   cd /config/addons_configs/zigbee2mqtt/data
   
   # Create external_extensions directory
   mkdir -p external_extensions
   
   # Download extension
   curl -o external_extensions/mcp-server.js \
     https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js
   ```

4. **Restart the addon:**
   - Settings → Addons → Zigbee2MQTT → Restart

5. **Access the MCP server:**
   - From Home Assistant host: `http://localhost:4747/mcp`
   - From other machines: `http://homeassistant.local:4747/mcp` (if mDNS available)

### Configuration (addon config)

Home Assistant → Zigbee2MQTT addon → Configuration:

```yaml
# MCP Server Settings
mcp:
  enabled: true
  port: 4747
  host: '0.0.0.0'
```

### Home Assistant Integration Script

```python
# automations/mcp_integration.yaml
automation:
  - alias: "MCP Health Check"
    trigger:
      platform: time_pattern
      minutes: "/15"  # Every 15 minutes
    action:
      - service: shell_command.check_mcp_health

  - alias: "Sync Z2M Devices from MCP"
    trigger:
      platform: homeassistant
      event: start
    action:
      - service: shell_command.sync_z2m_devices

# configuration.yaml
shell_command:
  check_mcp_health: 'curl -s http://localhost:4747/health | jq .'
  sync_z2m_devices: 'curl -X POST http://localhost:4747/mcp -H "Content-Type: application/json" -d "{\"method\": \"tools/call\", \"params\": {\"name\": \"list_devices\"}}"'

template:
  - sensor:
      - name: "MCP Server Status"
        unique_id: "mcp_status"
        state: "{{ state_attr('automation.mcp_health_check', 'last_triggered') }}"
```

---

## Kubernetes & Podman

### Kubernetes Deployment

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: zigbee2mqtt-config
  namespace: zigbee
data:
  configuration.yaml: |
    homeassistant: false
    permit_join: false
    mqtt:
      server: mqtt://mosquitto:1883
      user: zigbee
      password: zigbee_password
    frontend: true
    serial:
      port: /dev/ttyUSB0

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zigbee2mqtt
  namespace: zigbee
spec:
  replicas: 1
  selector:
    matchLabels:
      app: zigbee2mqtt
  template:
    metadata:
      labels:
        app: zigbee2mqtt
    spec:
      containers:
      - name: zigbee2mqtt
        image: koenkk/zigbee2mqtt:latest
        ports:
        - containerPort: 8080
          name: web
        - containerPort: 4747
          name: mcp
        
        env:
        - name: ZIGBEE2MQTT_CONFIG_MCP_ENABLED
          value: "true"
        - name: ZIGBEE2MQTT_CONFIG_MCP_PORT
          value: "4747"
        - name: ZIGBEE2MQTT_CONFIG_MCP_HOST
          value: "0.0.0.0"
        
        volumeMounts:
        - name: data
          mountPath: /app/data
        - name: config
          mountPath: /app/data/configuration.yaml
          subPath: configuration.yaml
        
        # USB device passthrough (requires privileged)
        securityContext:
          privileged: true
        
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        
        livenessProbe:
          httpGet:
            path: /health
            port: 4747
          initialDelaySeconds: 60
          periodSeconds: 30
        
        readinessProbe:
          httpGet:
            path: /health
            port: 4747
          initialDelaySeconds: 10
          periodSeconds: 10
      
      # Init container to download MCP extension
      initContainers:
      - name: download-mcp
        image: curlimages/curl:latest
        command:
        - sh
        - -c
        - |
          mkdir -p /app/data/external_extensions
          curl -o /app/data/external_extensions/mcp-server.js \
            https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js
        volumeMounts:
        - name: data
          mountPath: /app/data
      
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: zigbee2mqtt-data
      - name: config
        configMap:
          name: zigbee2mqtt-config

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: zigbee2mqtt-data
  namespace: zigbee
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi

---
apiVersion: v1
kind: Service
metadata:
  name: zigbee2mqtt
  namespace: zigbee
spec:
  type: ClusterIP
  selector:
    app: zigbee2mqtt
  ports:
  - name: web
    port: 8080
    targetPort: 8080
  - name: mcp
    port: 4747
    targetPort: 4747
```

Deploy:
```bash
kubectl create namespace zigbee
kubectl apply -f zigbee2mqtt-k8s.yaml
kubectl port-forward -n zigbee svc/zigbee2mqtt 4747:4747
```

### Podman (Rootless)

```bash
# Create Podman pod
podman pod create \
  --name zigbee2mqtt \
  -p 8080:8080 \
  -p 4747:4747

# Download MCP extension
mkdir -p ~/.local/share/podman/volumes/zigbee2mqtt/_data/external_extensions
curl -o ~/.local/share/podman/volumes/zigbee2mqtt/_data/external_extensions/mcp-server.js \
  https://raw.githubusercontent.com/pranjal-joshi/zigbee2mqtt-user-extensions/feat/mcp/unstable/mcp-server/mcp-server.js

# Run container
podman run -d \
  --pod zigbee2mqtt \
  --name z2m \
  --device /dev/ttyUSB0:/dev/ttyUSB0 \
  -e ZIGBEE2MQTT_CONFIG_MCP_PORT=4747 \
  -e ZIGBEE2MQTT_CONFIG_MCP_HOST=0.0.0.0 \
  -v zigbee2mqtt:/app/data \
  koenkk/zigbee2mqtt:latest

# Check logs
podman logs z2m -f
```

---

## Integration with AI Tools

### Claude Desktop

Edit `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zigbee2mqtt": {
      "command": "curl",
      "args": [
        "-X", "POST",
        "http://localhost:4747/mcp",
        "-H", "Content-Type: application/json",
        "-d", "{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\", \"params\": {}}"
      ],
      "env": {
        "MCP_ENDPOINT": "http://localhost:4747/mcp"
      }
    }
  }
}
```

### Cursor IDE

In Cursor settings (JSON):

```json
{
  "codebase": {
    "mcpServers": [
      {
        "name": "zigbee2mqtt",
        "url": "http://localhost:4747/mcp",
        "type": "http"
      }
    ]
  }
}
```

### OpenClaw

In OpenClaw workspace config:

```yaml
mcp_servers:
  - name: zigbee2mqtt
    type: http
    endpoint: http://localhost:4747/mcp
    description: "Control Zigbee2MQTT devices via MCP"
    enabled: true
    
# Optional: Add to specific agents
agents:
  - name: home-automation
    mcp_servers:
      - zigbee2mqtt
```

### Custom HTTP Client (curl, Python, etc.)

```bash
# List devices
curl -X POST http://localhost:4747/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_devices",
      "arguments": {"include_state": true}
    }
  }' | jq .

# Control a device
curl -X POST http://localhost:4747/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "control_device",
      "arguments": {
        "device": "living_room_lamp",
        "payload": {"brightness": 200}
      }
    }
  }' | jq .
```

```python
# Python client
import requests
import json

MCP_URL = "http://localhost:4747/mcp"

def call_mcp_tool(tool_name, **kwargs):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": kwargs
        }
    }
    response = requests.post(MCP_URL, json=payload)
    return response.json()

# List devices
devices = call_mcp_tool("list_devices", include_state=True)
print(json.dumps(devices, indent=2))

# Control device
result = call_mcp_tool(
    "control_device",
    device="living_room_lamp",
    payload={"brightness": 150}
)
print(json.dumps(result, indent=2))
```

---

## Monitoring & Health Checks

### Health Endpoint

```bash
# Basic health check
curl http://localhost:4747/health

# Expected response:
# {"status": "ok", "timestamp": "2026-05-25T07:53:00.000Z"}
```

### Prometheus Metrics (Optional)

Customize MCP server to export metrics:

```javascript
// In src/http-transport.js, add:
app.get('/metrics', (req, res) => {
  const metrics = `
# HELP mcp_tools_calls_total Total tool calls processed
# TYPE mcp_tools_calls_total counter
mcp_tools_calls_total 0

# HELP mcp_devices_count Current device count
# TYPE mcp_devices_count gauge
mcp_devices_count ${deviceCount}

# HELP mcp_response_time_ms Response time in milliseconds
# TYPE mcp_response_time_ms histogram
mcp_response_time_ms 0
  `;
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});
```

### Docker Health Check

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:4747/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Systemd Health Check

```ini
# /etc/systemd/system/zigbee2mqtt-health.timer
[Unit]
Description=Zigbee2MQTT Health Check
After=network.target

[Timer]
OnBootSec=60s
OnUnitActiveSec=5m
Unit=zigbee2mqtt-health.service

[Install]
WantedBy=timers.target

# /etc/systemd/system/zigbee2mqtt-health.service
[Unit]
Description=Zigbee2MQTT Health Check Service
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -f http://localhost:4747/health || systemctl restart zigbee2mqtt
User=zigbee
```

---

## Troubleshooting

### MCP Extension Not Loading

**Check logs:**
```bash
docker logs zigbee2mqtt | grep -i mcp
```

**Verify file exists:**
```bash
ls -la data/external_extensions/mcp-server.js
```

**Check file size (should be ~1.3 MB):**
```bash
du -h data/external_extensions/mcp-server.js
```

### Port 4747 Already in Use

```bash
# Find process using port
lsof -i :4747
# or
ss -tlnp | grep 4747

# Kill process (if safe)
kill -9 <PID>

# Or use different port
export ZIGBEE2MQTT_CONFIG_MCP_PORT=5000
docker restart zigbee2mqtt
```

### Connection Refused

```bash
# Test connectivity
curl -v http://localhost:4747/health

# Check firewall
sudo ufw status
sudo ufw allow 4747

# Check service binding
netstat -tlnp | grep 4747
```

### Permissions Error

```bash
# Fix file permissions
chmod +r data/external_extensions/mcp-server.js

# Fix directory permissions
chmod +rx data/external_extensions
```

### Memory Issues

```bash
# Check memory usage
docker stats zigbee2mqtt

# Increase Docker memory limit
docker update --memory=1g zigbee2mqtt

# Or in docker-compose.yml
services:
  zigbee2mqtt:
    mem_limit: 1g
    memswap_limit: 1g
```

---

**Built with ❤️ for home automation**
