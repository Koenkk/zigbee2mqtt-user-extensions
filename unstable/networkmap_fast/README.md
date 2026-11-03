# networkmap_fast

Faster network map scan for Zigbee2MQTT: the built-in scan with a small worker pool and smarter handling of routers that do not answer.

## What this extension does

- scans routers two at a time instead of one after another (the number is configurable)
- scans routers that did not answer in the previous scan **last**, all at once, with a single attempt, so any number of dead or unpowered routers adds about 5 s instead of 15 s each
- by default takes over `bridge/request/networkmap` for `type: "raw"`, so the **Network page of the frontend** and any other client of the normal topic get the fast scan without changes; `graphviz` and `plantuml` requests still go to the built-in scan
- also listens on its own topic `bridge/request/networkmap_fast` and publishes a progress count on `bridge/networkmap_fast/progress` (not under `bridge/response/`, where the frontend would show a toast for every message)
- returns exactly the same data as the built-in scan, plus `duration` (seconds) and `concurrency` (peak routers in flight) in the response
- with `routes: true`, asks a router for its routing table only once if it never answers: Tuya-based routers do not implement that request, and each of them would otherwise cost a full ZDO timeout on every scan

## What it does not do

- it does not change the Zigbee traffic per router: each router still gets one `Mgmt_Lqi_req` (and one routing-table request when `routes: true`)
- it does not read end devices (they are not asked anything, same as the built-in scan)
- it does not know the non-answering routers on the first scan after loading: that scan still runs two routers at a time, but unknown non-answerers get the built-in handling (attempt, 5 s pause, second attempt). From the second scan on they are scanned last with a single attempt

## Measurements

24 routers, chain-shaped mesh with two weak bridges (LQI 40–50), EmberZNet coordinator, two routers unpowered:

| | built-in scan | this extension, concurrency 2 |
|---|---|---|
| duration | 74 s | 16–22 s |
| router→router links found | 131–135 | 131–140 |
| cost per unpowered router | ~15 s | ~5 s total for all of them |

Concurrency 4 and above lost the routers behind the weak links (requests on multi-hop paths collided, the ZDO requests timed out). The limit is the topology, not the number of devices, so 2 is the default.

## Routers without a routing table

`routes: true` adds one `Mgmt_Rtg_req` per router. Routers built on Tuya modules (TS0601, TS011F, TS0001 tested) answer the neighbour-table request but not the routing-table request, so every one of them costs a ZDO timeout, about 15 s, on every scan with routes. The extension remembers a router that answered its LQI request but not its routing-table request and does not ask it again; the node is reported with `failed: ["routingTable"]` as before and a warning names it once. A router that answered neither request is not remembered this way (that is the dead-router handling above). Measured on a mesh of 23 routers, 10 of them Tuya: 183 s for a routes scan before, about 90 s for the first scan after loading (the timeouts are paid once) and 15 s from the second scan on. Reloading the extension forgets the list.

## Configuration

Edit the `CONFIG` object at the top of `networkmap_fast.mjs`:

```js
const CONFIG = {
    concurrency: 2,        // routers asked at the same time when the request does not say
    maxConcurrency: 8,     // hard cap for the request field
    replaceBuiltin: true,  // also serve bridge/request/networkmap (type raw) so the frontend's map uses this scan
};
```

A request may override the concurrency: `{"type": "raw", "routes": false, "concurrency": 3}`.

## Installation

1. Make sure `advanced.enable_external_js: true` is set (see the Zigbee2MQTT docs on external extensions).
2. In the Zigbee2MQTT web UI go to **Settings → Dev console → External extensions**.
3. Create a new extension named `networkmap_fast.mjs`, paste the contents of the file, save.
4. Open the Network page and load the map. The log shows `networkmap_fast: listening on bridge/request/networkmap_fast and bridge/request/networkmap (raw)`.

## Trade-offs and risks

The takeover of the normal topic detaches the built-in NetworkMap extension's MQTT listener through the event bus's internal listener bookkeeping. That is not a public API. If a future Zigbee2MQTT release changes it, the extension logs a warning and only serves its own topic; nothing else breaks. Removing the extension gives the listener back.

Two requests in flight is safe on every network tested so far, but a mesh with a single very weak link may still prefer `concurrency: 1`, which is the built-in behaviour plus the dead-router handling.

Only one scan runs at a time. A request that arrives during a scan is answered with `status: "error"`.
