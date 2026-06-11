# Desired state retry

Retries verifiable device `/set` commands when Zigbee2MQTT does not observe the requested state after the normal publish.

This extension is intended for lossy actuator networks where the first command may be dropped, for example covers or switches that usually work one by one but sometimes miss a command during a burst.

## What this extension does

- watches incoming device MQTT `/set` commands
- records simple, verifiable target state values such as `state: "OPEN"` or `state: "OFF"`
- retries the same MQTT command after a cooldown until the target state is observed, superseded, exhausted, or expired
- coalesces duplicate unresolved commands for the same device endpoint
- supersedes an older pending target when a newer target is sent to the same device endpoint

The first command is still handled by Zigbee2MQTT normally. This extension only adds retries after the requested state has not been observed.

## What this extension does not do

- it does not handle groups
- it does not retry bridge request topics
- it does not infer complex converter-specific target states
- it does not retry commands such as `toggle` or `stop`, where repeating the command can change behavior or has no stable target state
- it does not reorder the initial command burst before Zigbee2MQTT sends it

## Configuration

Edit the `CONFIG` object at the top of `desired_state_retry.js`:

```js
const CONFIG = {
    devices: [],
    properties: ['state'],
    maxRetries: 4,
    retryCooldownSeconds: 4,
    deadlineSeconds: 30,
};
```

Set `devices` to specific friendly names or IEEE addresses:

```js
devices: ['Living room cover', '0xa4c1380011223344'],
```

Leaving `devices` empty disables retries. Use `['*']` only when every device command with a supported property should be retried.

## Installation

1. In the Zigbee2MQTT web UI go to **Settings -> Dev Console -> External Extensions**.
2. Create a new extension named `desired_state_retry.js`.
3. Paste the contents of `desired_state_retry.js` into the code form.
4. Save. The extension loads immediately.

## Trade-offs and risks

This is an opt-in workaround, not a Zigbee delivery guarantee.

Commands are retried by publishing the same MQTT `/set` command again. That works well for idempotent actuator targets such as `OPEN`, `CLOSE`, `ON`, and `OFF`, but it is not suitable for semantic actions where repeating the command changes the meaning.

The extension uses Zigbee2MQTT's external extension API and normal MQTT command path. It intentionally avoids monkey-patching the built-in publish extension, so it cannot delay or reorder the first command in a burst.

The retry budget is counted after the original Zigbee2MQTT command. For example, `maxRetries: 4` means one normal command plus up to four retry publishes.
