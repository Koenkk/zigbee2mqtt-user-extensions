# Zigbee2MQTT user extensions
This repository contains user extensions to be used with Zigbee2MQTT. For more information see the [Zigbee2MQTT docs](https://www.zigbee2mqtt.io/advanced/more/external_extensions.html).

## Stable
The extensions listed here are considered **stable** and are not expected to get breaking changes or a lot of active development.

- [color_mode_reader](stable/color_mode_reader/README.md): reads `lightingColorCtrl.colorMode` for devices (e.g. Philips Hue BT) that do not support reporting it.
- [ignore_device_leave](stable/ignore_device_leave/README.md): prevents Z2M from removing specific devices from its database when they send spurious leave events caused by accidental factory resets (common with Tuya TS0505B bulbs behind wall switches or relays).
- [permit_join_forever](stable/permit_join_forever/README.md): keeps permit-join open indefinitely. Required for some devices (e.g. Livolo) that need extended pairing windows. **Use only when necessary.**

## Unstable
The extensions listed here are considered **unstable** and are under active development; breaking changes and frequent updates are expected.

- [DewpointCalculator](unstable/DewpointCalculator/README.md): calculates and injects dewpoint into every device message that contains both temperature and humidity.
- [miboxer-fut089z/controls-exposer](unstable/miboxer-fut089z/README.md): exposes the controls of MiBoxer FUT089Z remotes, which only emit group commands not supported by zigbee-herdsman-converters.
- [mcp-server](unstable/mcp-server/README.md): a Model Context Protocol server that lets AI tools (Claude, Cursor, etc.) interact with your Zigbee network programmatically.
