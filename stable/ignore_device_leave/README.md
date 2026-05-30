# ignore_device_leave

Prevents Zigbee2MQTT from removing specific devices from its database when they send `deviceLeave` events caused by accidental factory resets.

## Background

Tuya Zigbee devices (e.g. TS0505B-based ceiling spots like Moes ZB-TDD6-RCW-4 and ZB-TD5-RCW-GU10) enter pairing mode after only 3 power cycles. Other brands typically require 5 or more. This low threshold makes accidental resets easy to trigger in real-world installations:

- **Bouncy relay contacts** — a relay switching under load can produce multiple contact bounces that the device counts as separate power cycles
- **Noisy mains lines** — voltage dips or transients during power-on
- **Wall switches** — rapid toggling, or a child playing with a switch

When the device enters pairing mode it does what it is supposed to do: sends a `Leave_Indication` and waits for a new coordinator to pair with. From the device's perspective this is correct behaviour. The problem is that after the pairing timeout expires the device gives up and resumes normal operation — still on the network, still holding its network key — but zigbee-herdsman has already processed the leave event and removed the device from its database. All subsequent messages from the device are silently dropped.

The device is physically present and immediately controllable again once the database entry is restored (manually or by re-pairing), without any reconfiguration of attributes, groups, or bindings.

See upstream discussion: [zigbee-herdsman #1648](https://github.com/Koenkk/zigbee-herdsman/issues/1648)

## What this extension does

It intercepts the adapter-level `deviceLeave` event before herdsman processes it. For any device whose model ID or IEEE address is in the ignore list, the leave event is suppressed and a warning is logged. All other devices continue through the normal leave handler unchanged.

The original listeners are saved on `start()` and fully restored on `stop()`, so the extension is reversible without a Z2M restart.

## Configuration

Edit the two arrays at the top of `ignore_device_leave.js`:

```js
const IGNORE_MODELS = ['TS0505B'];   // match by modelID — affects all units of that model
const IGNORE_DEVICES = [];            // match by IEEE address — targets specific units
```

Use model-based matching when most or all units of a model exhibit accidental resets:

```js
const IGNORE_MODELS = ['TS0505B'];
```

Use address-based matching when only specific individual units are problematic:

```js
const IGNORE_MODELS = [];
const IGNORE_DEVICES = ['0xa4c138xxxxxxxx', '0xa4c138yyyyyyyy'];
```

Both lists can be combined. A device matching either is ignored.

## Installation

1. In the Z2M web UI go to **Settings → Dev Console → External Extensions**.
2. Create a new extension. The filename **must** end in `.mjs`, e.g. `ignore_leave.mjs`.
3. Paste the contents of `ignore_device_leave.js` into the Code form.
4. Save. The extension loads immediately — no Z2M restart needed.

On load you will see:

```
patching deviceLeave handler to ignore models=["TS0505B"] devices=[]
```

When a leave event is suppressed:

```
Ignoring leave from 0xa4c138xxxxxxxx (TS0505B)
```

## Trade-offs and risks

This extension is an opt-in workaround, not a fix. Understand the implications before using it.

**If a device is intentionally decommissioned** (factory reset for re-pairing to a different coordinator), the leave event will be suppressed. The device will appear in Z2M but be unreachable. Remove it manually from the Z2M device list in that case.

**This does not prevent the accidental reset** — the device still enters pairing mode, blinks, and waits for a coordinator. It just prevents Z2M from losing its database entry while that happens. After the pairing timeout the device resumes normal operation automatically.

**Monkey-patching fragility** — the extension hooks into zigbee-herdsman's internal adapter event emitter. A Z2M or herdsman update that changes this internal interface could break it silently. Verify after upgrades.
