import type Zigbee from 'zigbee2mqtt/dist/zigbee';
import type MQTT from 'zigbee2mqtt/dist/mqtt';
import type State from 'zigbee2mqtt/dist/state';
import type EventBus from 'zigbee2mqtt/dist/eventBus';
import type Settings from 'zigbee2mqtt/dist/util/settings';
import type Logger from 'zigbee2mqtt/dist/util/logger';

import * as prometheus from 'prom-client'

import * as http from "http"
import bind from 'bind-decorator';

async function createZ2MMetrics(
  zigbee: Zigbee,
  mqtt: MQTT,
  state: State
) {
  const coordinator = await zigbee.getCoordinatorVersion()
  const coordinatorLabel = `${coordinator?.type ?? 'unknown'}@${coordinator?.meta?.revision ?? 'unknown'}`

prometheus.register.setDefaultLabels({
    coordinator: coordinatorLabel
  })

  // Define zigbee2mqtt metrics
  new prometheus.Gauge({
    name: 'zigbee_device_joined_count',
    help: 'Number of devices joined to the network (excluding coordinator)',
    collect() {
      this.set(zigbee.devices(false).length)
    }
  })

  const device_last_seen_summary = new prometheus.Summary({
    name: 'zigbee_device_last_seen_summary',
    help: 'Seconds since device was last seen, percentile'
  })
  new prometheus.Gauge({
    name: 'zigbee_device_last_seen',
    help: 'Seconds since device was last seen, labeled by device ieee address',
    labelNames: ['ieeeAddr'],
    collect() {
      const now = Date.now();
      device_last_seen_summary.reset()
      this.reset()

      for (const device of zigbee.devices(false)) {
        const lastSeenElapsedSeconds = Math.round((now - device.zh.lastSeen) / 1000)
        this.set({ ieeeAddr: device.ieeeAddr }, lastSeenElapsedSeconds)
        device_last_seen_summary.observe(lastSeenElapsedSeconds)
      }
    }
  })

  const device_lqi_summary = new prometheus.Summary({
    name: 'zigbee_device_lqi_summary',
    help: 'Device link quality index (when available), percentile'
  })
  new prometheus.Gauge({
    name: 'zigbee_device_lqi',
    help: 'Device link quality index (when available), labeled by device ieee address',
    labelNames: ['ieeeAddr'],
    collect() {
      device_lqi_summary.reset()
      this.reset()
      for (const device of zigbee.devices(false)) {
        const lqi = device.zh.linkquality

        if (lqi !== undefined) {
          this.set({ ieeeAddr: device.ieeeAddr }, lqi)
          device_lqi_summary.observe(lqi)
        }
      }
    }
  })

  new prometheus.Gauge({
    name: 'zigbee_device_battery',
    help: 'Battery status for battery-powered devices, labeled by device ieee address',
    labelNames: ['ieeeAddr'],
    collect() {
      this.reset()
      for (const device of zigbee.devices(false)) {
        const battery = state.get(device)?.battery
        if (battery !== undefined) {
          this.set({ ieeeAddr: device.ieeeAddr }, battery)
        }
      }

    }
  })

  new prometheus.Gauge({
    name: 'zigbee_mqtt_connected',
    help: '1 if zigbee2mqtt is connected to downstream mqtt server, otherwise 0',
    collect() {
      this.set(mqtt.isConnected() ? 1 : 0)
    }
  })

  new prometheus.Gauge({
    name: 'zigbee_permit_join',
    help: '1 if network is in Permit Join mode, otherwise 0',
    collect() {
      this.set(zigbee.getPermitJoin() ? 1 : 0)
    }
  })

}

class MetricsServer {
  private server: http.Server;
  private host = '0.0.0.0';
  private port = 8081;
  private logger: typeof Logger;

  private constructor(logger: typeof Logger) {
    this.server = http.createServer(this.onRequest) as http.Server;
    this.logger = logger;
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.listen(this.port, this.host, resolve)
        .on('error', reject)
    })

    this.logger.info(`Started metrics on port ${this.host}:${this.port}/metrics`);
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) { return reject(err) }
        resolve()
      })
    })
    this.logger.info(`Stopped metrics on port ${this.host}:${this.port}/metrics`);
  }

  @bind private onRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    this.logger.info(`onRequest ${request.url}`);
    if (request.url !== '/metrics') {
      response.statusCode = 404
      response.end()
      return
    }

    this.onMetricsRequest(request, response);
  }

  private async onMetricsRequest(_, response: http.ServerResponse): Promise<void> {
    const metricsResponse = await prometheus.register.metrics()
    response.write(metricsResponse)
    response.end()
  }

  static async create(logger: typeof Logger): Promise<MetricsServer> {
    const server = new MetricsServer(logger)
    await server.start()
    return server
  }
}

class PrometheusMetrics {
    private readonly logger: typeof Logger
    private server: MetricsServer;

    constructor(
        protected zigbee: Zigbee,
        protected mqtt: MQTT,
        protected state: State,
        protected publishEntityState: unknown,
        protected eventBus: EventBus,
        protected settings: typeof Settings,
        baseLogger: typeof Logger,
    ) {
        this.logger = baseLogger;

        this.logger.info('Prometheus Metrics plugin loaded');
        this.logger.debug('Registered Extention PrometheusMetrics');

        createZ2MMetrics(this.zigbee, this.mqtt, this.state)
    }

    async start() {
        this.eventBus.onStateChange(this, (data: any) => {
            console.log('State changed', data);
        });

        this.server = await MetricsServer.create(this.logger)
    }

    async stop() {
        this.eventBus.removeListeners(this);

        prometheus.register.clear()

        if (this.server) {
            await this.server.stop()
        }
    }
}

export = PrometheusMetrics;