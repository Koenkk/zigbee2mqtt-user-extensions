/**
 * networkmap_fast — Zigbee2MQTT external extension: the built-in raw network scan with a small worker pool.
 *
 * The stock scan (lib/extension/networkMap.ts, mirrored here from 2.14.2) asks one router at a time for its
 * neighbour table (Mgmt_Lqi_req) and optionally its routing table, with a 1 s pause after each. A router that does
 * not answer costs a 5 s wait plus a retry, so a few dead routers add minutes. This extension runs the same per-router
 * work for N routers at once (default 2) and treats known non-answerers differently (see below).
 *
 * Two ways to use it:
 *  1. CONFIG.replaceBuiltin = true (default): the extension takes over `<base>/bridge/request/networkmap` for
 *     type "raw", so the Network page of the Zigbee2MQTT frontend and every other client of the normal topic get the
 *     fast scan without any change. "graphviz" and "plantuml" requests are passed on to the built-in scan.
 *     Unloading the extension hands the topic back. This hooks into the event bus's listener bookkeeping (not a public
 *     API); if a future Zigbee2MQTT changes it, the takeover is skipped with a warning and only option 2 remains.
 *  2. `<base>/bridge/request/networkmap_fast`  {"type":"raw","routes":false,"concurrency":2,"transaction":"…"}
 *     always available. Response on `<base>/bridge/response/networkmap_fast`, same shape as bridge/response/networkmap
 *     plus data.duration (seconds) and data.concurrency (peak workers used).
 *  Progress for both: `<base>/bridge/networkmap_fast/progress`  {"done":n,"total":m,"device":"name","failed":k}
 *  (deliberately not under bridge/response/: the frontend shows a toast for every message there)
 *  Only one scan runs at a time; a request during a scan is answered with status "error".
 *
 * Concurrency: request field "concurrency" (omitted/0 = CONFIG.concurrency, capped at CONFIG.maxConcurrency).
 *   Measured 2026-10-25 on a 24-router chain-shaped mesh with two weak bridges: 2 in flight = same links as the
 *   sequential scan in a quarter of the time (74 s -> 16-22 s); 4 and above lose the routers behind the weak links
 *   (contention on multi-hop paths -> MAC retries -> ZDO timeouts). The limit is topology, not network size.
 *   "adaptive": true (opt-in) grows the pool by one worker whenever no router has answered for 5 s while requests
 *   are in flight, up to "maxConcurrency" (default 4). It cannot tell a congested mesh from dead routers, so it is
 *   off by default.
 * Dead routers: routers that did not answer in the previous scan are scanned LAST, all at once, with a single attempt
 *   (no 5 s pause + retry). The live routers are read on a quiet mesh (requests to dead routers leave route-repair
 *   traffic behind), and any number of non-answerers adds one timeout round (~5 s) at the tail. The first scan after
 *   a (re)load knows no dead routers yet and is slower.
 *
 * Install: Settings -> Dev console -> External extensions -> new extension "networkmap_fast.mjs", paste, save; or put
 * the file in data/external_extensions/. Needs advanced.enable_external_js: true. Remove the extension to uninstall.
 */
const CONFIG = {
    concurrency: 2,        // routers asked at the same time when the request does not say
    maxConcurrency: 8,     // hard cap for the request field
    replaceBuiltin: true,  // also serve bridge/request/networkmap (type raw) so the frontend's map uses this scan
    requestTimeout: 30,    // s: backstop per neighbour-table / routing-table request (zigbee-herdsman normally times out long before)
    scanTimeout: 240,      // s: backstop for a whole scan; after it the request is answered with an error and the next scan may start
};
const withTimeout = (promise, seconds, what) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${seconds} s`)), seconds * 1000);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

export default class NetworkMapFast {
    constructor(zigbee, mqtt, state, publishEntityState, eventBus, enableDisableExtension, restartCallback, addExtension, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.eventBus = eventBus;
        this.settings = settings;
        this.logger = logger;
        this.baseTopic = settings.get().mqtt.base_topic;
        this.requestTopic = `${this.baseTopic}/bridge/request/networkmap_fast`;
        this.builtinTopic = `${this.baseTopic}/bridge/request/networkmap`;
        this.builtin = undefined;      // the built-in NetworkMap extension's mqttMessage listener while we hold it
        this.running = false;
        this.requestTimeout = CONFIG.requestTimeout;
        this.scanTimeout = CONFIG.scanTimeout;
        this.lastFailed = new Set();   // ieeeAddr of routers that did not answer in the previous scan
    }

    async start() {
        if (CONFIG.replaceBuiltin) this.takeOverBuiltin();
        this.eventBus.onMQTTMessage(this, (data) => {
            if (data.topic === this.requestTopic) {
                // never let a rejection escape into Z2M
                this.onRequest(data.message, "bridge/response/networkmap_fast").catch((e) => this.logger.error(`networkmap_fast: ${e?.message ?? e}`));
            } else if (this.builtin && data.topic === this.builtinTopic) {
                const type = this.requestType(data.message);
                if (type === "raw") {
                    this.onRequest(data.message, "bridge/response/networkmap").catch((e) => this.logger.error(`networkmap_fast: ${e?.message ?? e}`));
                } else {
                    this.builtin.callback(data); // graphviz / plantuml / errors: the built-in scan answers
                }
            }
        });
        this.logger.info(`networkmap_fast: listening on bridge/request/networkmap_fast${this.builtin ? " and bridge/request/networkmap (raw)" : ""}`);
    }

    async stop() {
        this.eventBus.removeListeners(this);
        this.giveBackBuiltin();
    }

    /** Detach the built-in NetworkMap extension's MQTT listener so that raw requests on bridge/request/networkmap reach only us. */
    takeOverBuiltin() {
        try {
            const entry = this.eventBus.callbacksByExtension?.get("NetworkMap")?.find((e) => e.event === "mqttMessage");
            const emitter = this.eventBus.emitter;
            if (!entry || typeof entry.callback !== "function" || typeof emitter?.removeListener !== "function") {
                this.logger.warning("networkmap_fast: built-in network map listener not found, serving only bridge/request/networkmap_fast");
                return;
            }
            emitter.removeListener("mqttMessage", entry.callback);
            this.builtin = entry;
        } catch (e) {
            this.logger.warning(`networkmap_fast: could not take over bridge/request/networkmap (${e?.message ?? e})`);
        }
    }

    giveBackBuiltin() {
        if (!this.builtin) return;
        try {
            this.eventBus.emitter.on("mqttMessage", this.builtin.callback);
        } catch (e) {
            this.logger.warning(`networkmap_fast: could not restore the built-in network map listener (${e?.message ?? e})`);
        }
        this.builtin = undefined;
    }

    parse(raw) {
        try { return JSON.parse(raw); } catch { return raw; }
    }

    requestType(raw) {
        const m = this.parse(raw);
        return typeof m === "object" && m !== null ? m.type : m;
    }

    response(request, data, error) {
        const r = error !== undefined ? {data: {}, status: "error", error} : {data, status: "ok"};
        if (request && typeof request === "object" && request.transaction !== undefined) r.transaction = request.transaction;
        return JSON.stringify(r);
    }

    async onRequest(raw, responseTopic) {
        const message = this.parse(raw);
        const obj = typeof message === "object" && message !== null ? message : {};
        const type = typeof message === "object" && message !== null ? message.type : message;
        const routes = !!obj.routes;
        const cap = Math.max(1, Math.floor(CONFIG.maxConcurrency));
        let concurrency = Number(obj.concurrency);
        if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = CONFIG.concurrency;
        concurrency = Math.min(Math.max(1, Math.floor(concurrency)), cap);
        const adaptive = obj.adaptive === true;
        let maxConcurrency = Number(obj.maxConcurrency);
        if (!Number.isFinite(maxConcurrency) || maxConcurrency < concurrency) maxConcurrency = Math.max(concurrency, 4);
        maxConcurrency = Math.min(Math.floor(maxConcurrency), cap);

        if (type !== "raw") {
            await this.mqtt.publish(responseTopic, this.response(message, {}, `Type '${type}' not supported, only 'raw'`));
            return;
        }
        if (this.running) {
            await this.mqtt.publish(responseTopic, this.response(message, {}, "a scan is already running"));
            return;
        }
        this.running = true;
        const t0 = Date.now();
        try {
            // a hung request must never leave the extension busy forever: give up on the whole scan after scanTimeout
            const {value, used} = await withTimeout(this.networkScan(routes, concurrency, adaptive, maxConcurrency), this.scanTimeout, "network scan");
            const duration = Math.round((Date.now() - t0) / 100) / 10;
            await this.mqtt.publish(responseTopic, this.response(message, {type, routes, concurrency: used, duration, value}));
        } catch (error) {
            this.logger.warning(`networkmap_fast: scan failed: ${error?.message ?? error}`);
            await this.mqtt.publish(responseTopic, this.response(message, {}, error?.message ?? String(error)));
        } finally {
            this.running = false;
        }
    }

    async networkScan(includeRoutes, concurrency, adaptive, maxConcurrency) {
        const logger = this.logger;
        const cap = Math.max(1, Math.floor(CONFIG.maxConcurrency));
        const lqis = new Map();
        const routingTables = new Map();
        const failed = new Map();

        const requestWithRetry = async (request, retry) => {
            try {
                return await request();
            } catch (e) {
                if (!retry) throw e;
                await sleep(5); // network possibly congested, let it settle (same as the stock scan)
                return await request();
            }
        };

        const routers = [];
        for (const device of this.zigbee.devicesIterator((d) => d.type !== "GreenPower" && d.type !== "EndDevice")) {
            if (!device.options.disabled) routers.push(device);
        }
        // known non-answerers last: their requests leave route-repair noise behind, so the live routers go first on a quiet mesh
        routers.sort((a, b) => Number(this.lastFailed.has(a.ieeeAddr)) - Number(this.lastFailed.has(b.ieeeAddr)));
        const total = routers.length;
        const knownDead = routers.filter((r) => this.lastFailed.has(r.ieeeAddr)).length;
        logger.info(`networkmap_fast: starting network scan (routes ${includeRoutes}, ${adaptive ? `adaptive ${concurrency}..${maxConcurrency}` : `concurrency ${concurrency}`}, ${total} routers, ${knownDead} known non-answerers last)`);
        let done = 0;
        let next = 0;

        const scanOne = async (device) => {
            const deviceFailures = [];
            failed.set(device, deviceFailures);
            const retry = !this.lastFailed.has(device.ieeeAddr);   // a router that did not answer last time gets one attempt, at the end
            try {
                lqis.set(device, await requestWithRetry(() => withTimeout(device.zh.lqi(), this.requestTimeout, `LQI request to '${device.name}'`), retry));
                logger.debug(`networkmap_fast: LQI succeeded for '${device.name}'`);
            } catch (error) {
                deviceFailures.push("lqi");
                logger.error(`networkmap_fast: failed to execute LQI for '${device.name}': ${error?.message ?? error}`);
                logger.debug(error?.stack ?? String(error));
            }
            if (includeRoutes) {
                try {
                    routingTables.set(device, await requestWithRetry(() => withTimeout(device.zh.routingTable(), this.requestTimeout, `routing table request to '${device.name}'`), retry));
                    logger.debug(`networkmap_fast: routing table succeeded for '${device.name}'`);
                } catch (error) {
                    deviceFailures.push("routingTable");
                    logger.error(`networkmap_fast: failed to execute routing table for '${device.name}'`);
                    logger.debug(error?.stack ?? String(error));
                }
            }
            done++;
            const failedCount = Array.from(failed.values()).filter((f) => f.length).length;
            this.mqtt
                .publish("bridge/networkmap_fast/progress", JSON.stringify({done, total, device: device.name, failed: failedCount}), {skipLog: true})
                .catch(() => {});
        };

        let lastAnswer = Date.now();
        let active = 0;
        let spawned = 0;
        let peak = 0;
        const worker = async (slot, stagger = true, limit = routers.length) => {
            active++;
            peak = Math.max(peak, active);
            try {
                if (stagger) await sleep(0.25 * slot); // stagger the start so the first requests do not leave together
                while (next < limit) {
                    const device = routers[next++];
                    await scanOne(device);
                    lastAnswer = Date.now();
                    await sleep(0.3); // breathing room between requests on this slot
                }
            } finally {
                active--;
            }
        };
        // phase 1: live routers with the configured pool; phase 2: known non-answerers, all at once (nothing after them to
        // disturb, and none of them will answer) so any number of dead routers costs one timeout round
        const liveCount = routers.length - knownDead;
        const pool = Array.from({length: Math.min(concurrency, liveCount || 1)}, (_, i) => worker(i, true, liveCount));
        spawned = pool.length;
        if (adaptive) {
            // grow while the pool is stalled: no answer for 5 s with requests in flight (opt-in: cannot tell congestion from timeouts)
            const monitor = (async () => {
                while (active > 0) {
                    await sleep(0.5);
                    if (next < routers.length && spawned < maxConcurrency && Date.now() - lastAnswer > 5000) {
                        spawned++;
                        lastAnswer = Date.now(); // one spawn per stall
                        logger.info(`networkmap_fast: pool stalled, starting worker ${spawned}`);
                        pool.push(worker(spawned - 1, false));
                    }
                }
            })();
            pool.push(monitor);
        }
        // the pool may grow while we wait, so wait until every promise in it has settled
        for (let i = 0; i < pool.length; i++) await pool[i].catch(() => {});
        if (knownDead > 0) {
            next = liveCount;
            await Promise.all(Array.from({length: Math.min(knownDead, cap)}, (_, i) => worker(i, false)));
        }
        concurrency = peak;

        this.lastFailed = new Set(Array.from(failed.entries()).filter(([, f]) => f.includes("lqi")).map(([d]) => d.ieeeAddr));
        logger.info(`networkmap_fast: network scan finished (${total} routers, ${this.lastFailed.size} not answering)`);

        // --- topology, identical to the stock scan ---
        const topology = {nodes: [], links: []};
        for (const device of this.zigbee.devicesIterator((d) => d.type !== "GreenPower")) {
            if (device.options.disabled) continue;
            let definition;
            if (device.definition) {
                let supports = "";
                try {
                    supports = Array.from(new Set(device.exposes().map((e) => e.name ?? `${e.type} (${e.features?.map((f) => f.name).join(", ")})`))).join(", ");
                } catch { /* exposes may throw before the definition is resolved */ }
                definition = {model: device.definition.model, vendor: device.definition.vendor, description: device.definition.description, supports};
            }
            topology.nodes.push({
                ieeeAddr: device.ieeeAddr,
                friendlyName: device.name,
                type: device.zh.type,
                networkAddress: device.zh.networkAddress,
                manufacturerName: device.zh.manufacturerName,
                modelID: device.zh.modelID,
                failed: failed.get(device),
                lastSeen: device.zh.lastSeen,
                definition,
            });
        }
        for (const [device, table] of lqis) {
            for (const neighbor of table) {
                if (neighbor.relationship > 3) continue; // not an active relationship
                let neighborEui64 = neighbor.eui64;
                if (neighborEui64 === "0x0000000000000000") {
                    // some Xiaomi devices report 0x00 as the neighbour's ieeeAddr: resolve via the network address
                    const neighborDevice = this.zigbee.deviceByNetworkAddress(neighbor.nwkAddress);
                    if (neighborDevice) neighborEui64 = neighborDevice.ieeeAddr;
                }
                const link = {
                    source: {ieeeAddr: neighborEui64, networkAddress: neighbor.nwkAddress},
                    target: {ieeeAddr: device.ieeeAddr, networkAddress: device.zh.networkAddress},
                    deviceType: neighbor.deviceType,
                    rxOnWhenIdle: neighbor.rxOnWhenIdle,
                    relationship: neighbor.relationship,
                    permitJoining: neighbor.permitJoining,
                    depth: neighbor.depth,
                    lqi: neighbor.lqi,
                    routes: [],
                    sourceIeeeAddr: neighborEui64,
                    targetIeeeAddr: device.ieeeAddr,
                    sourceNwkAddr: neighbor.nwkAddress,
                    linkquality: neighbor.lqi,
                };
                const routingTable = routingTables.get(device);
                if (routingTable) {
                    for (const entry of routingTable) if (entry.nextHopAddress === neighbor.nwkAddress) link.routes.push(entry);
                }
                topology.links.push(link);
            }
        }
        return {value: topology, used: concurrency};
    }
}
