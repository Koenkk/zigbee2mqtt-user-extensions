# MiBoxer FUT089Z Controls Exposer

The MiBoxer FUT089Z remote is a very special device that only sends its controls as group commands. This makes it impossible to add support via `zigbee-herdsman-converters`.

As a workaround this user extension will serve as a helper that:

- automatically registers the remote's controls via MQTT auto discovery topics
- and automatically translates and publishes all group messages sent from he control to the appropriate MQTT topics.

Effectively, this extension makes it possible to use the buttons, brightness slider and color temperature slider in Home Assistant. 

The controls will automatically show up in Home Assistant as triggers and sensors and you can use them in Automations etc.

Any MQTT capable platform is supported btw (but auto discovery has only be implemented for Home Assistant for now).
