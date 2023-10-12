/*
 * The MiBoxer FUT089Z remote sends events for its controls only to specific Zigbee groups
 *
 * This extension registers and exposes the remote's controls, making them available on the appropriate MQTT topics.
 */
const DISCOVERY_PREFIX = 'homeassistant';
const VERSION = "1.0.0-unstable";
const NAME = "miboxer-fut089z/controls-exposer";

class MiboxerFut089zControlsExposer {
    constructor(zigbee, mqtt, state, publishEntityState, eventBus, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.settings = settings;
        this.logger = logger;
        
        this.previousBrightnessSliderLevelByIeeeAddr = {};

        logger.info('Loaded  MiBoxerFUT089Z');
    }
    
    _setupDeviceDiscovery(device) {
        const ieeeAddr = device.zh._ieeeAddr;
        const { vendor, model, description } = device._definition;
    
        // Set up discovery for the buttons:
        for (const buttonType of ['on', 'off']) {
            for (let zone=1; zone<=8; zone++) {
                const discoveryTopic = `device_automation/${ieeeAddr}_zone_${zone}_button_${buttonType}/config`;
                const discoveryPayloadObject = {
                    "automation_type": "trigger",
                    "topic": `zigbee2mqtt/${ieeeAddr}/action`,
                    "type": "button_short_press",
                    "subtype": `button_group_${zone}_${buttonType}`,
                    "payload": `button_group_${zone}_${buttonType}`,
                    "device": {
                        "identifiers": [
                            `zigbee2mqtt_${ieeeAddr}`
                        ]
                    },
                    "unique_id": `${ieeeAddr}_button_group_${zone}_${buttonType}_zigbee2mqtt`,
                    "origin": {
                      "name": `Zigbee2MQTT user extension (${NAME})`,
                      "sw_version": VERSION,
                      "support_url": "https://github.com/Koenkk/zigbee-herdsman-converters/pull/4153"
                    },
                    "platform": "mqtt",
                }
                const discoveryPayload = JSON.stringify(discoveryPayloadObject);
                this.mqtt.publish(discoveryTopic, discoveryPayload, {}, DISCOVERY_PREFIX); // Register the controls of the device in Home Assistant
            }
        }
        
        // Set up discovery for the brightness slider:
        const brightnessDiscoveryTopic = `sensor/${ieeeAddr}_brightness/config`;
        const brightnessDiscoveryPayloadObject = {
            "name": "Brightness",
            "state_topic": `zigbee2mqtt/${ieeeAddr}/brightness`,
            "unit_of_measurement": "%",
            "value_template": "{{ (value_json.brightness-2)/252*100 }}",
            "device": {
                "identifiers": [
                    `zigbee2mqtt_${ieeeAddr}`
                ]
            },
            "unique_id": `${ieeeAddr}_brightness_zigbee2mqtt`,
            "origin": {
              "name": "Zigbee2MQTT extension (MiBoxerFUT089Z)",
              "sw_version": VERSION,
              "support_url": "https://github.com/Koenkk/zigbee-herdsman-converters/pull/4153"
            },
            "platform": "mqtt",
        }
        const brightnessDiscoveryPayload = JSON.stringify(brightnessDiscoveryPayloadObject);
        this.mqtt.publish(brightnessDiscoveryTopic, brightnessDiscoveryPayload, {}, DISCOVERY_PREFIX); // Register the brightness control of the device in Home Assistant
        
        // Set up discovery for the color temperature slider:
        const colorTempDiscoveryTopic = `sensor/${ieeeAddr}_color_temp/config`;
        const colorTempDiscoveryPayloadObject = {
            "name": "Color Temperature",
            "state_topic": `zigbee2mqtt/${ieeeAddr}/color_temp`,
            "unit_of_measurement": "mireds",
            "value_template": "{{ value_json.colortemp }}",
            "device": {
                "identifiers": [
                    `zigbee2mqtt_${ieeeAddr}`
                ]
            },
            "unique_id": `${ieeeAddr}_color_temp_zigbee2mqtt`,
            "origin": {
              "name": "Zigbee2MQTT extension (MiBoxerFUT089Z)",
              "sw_version": VERSION,
              "support_url": "https://github.com/Koenkk/zigbee-herdsman-converters/pull/4153"
            },
            "platform": "mqtt",
        }
        const colorTempDiscoveryPayload = JSON.stringify(colorTempDiscoveryPayloadObject);
        this.mqtt.publish(colorTempDiscoveryTopic, colorTempDiscoveryPayload, {}, DISCOVERY_PREFIX); // Register the color temperature control of the device in Home Assistant
        
        // Set up discovery for the brightness color wheel and R, G, B, W controls:
        const colorDiscoveryTopic = `sensor/${ieeeAddr}_rgb/config`;
        const colorDiscoveryPayloadObject = {
            "name": "Color",
            "state_topic": `zigbee2mqtt/${ieeeAddr}/rgb`,
            "unit_of_measurement": "rgb",
            "value_template": "{{ value_json.rgb }}",
            "device": {
                "identifiers": [
                    `zigbee2mqtt_${ieeeAddr}`
                ]
            },
            "unique_id": `${ieeeAddr}_rgb_zigbee2mqtt`,
            "origin": {
              "name": "Zigbee2MQTT extension (MiBoxerFUT089Z)",
              "sw_version": VERSION,
              "support_url": "https://github.com/Koenkk/zigbee-herdsman-converters/pull/4153"
            },
            "platform": "mqtt",
        }
        const colorDiscoveryPayload = JSON.stringify(colorDiscoveryPayloadObject);
        this.mqtt.publish(colorDiscoveryTopic, colorDiscoveryPayload, {}, DISCOVERY_PREFIX); // Register the color temperature control of the device in Home Assistant
    }
    
    _deviceIsSupportedRemote(device) {
        return device?._definition?.vendor === 'MiBoxer' && device?._definition?.model === 'FUT089Z'
    }
    
    _getAvailableMiBoxerRemotes() {
        return this.zigbee.devices().filter(device=>this._deviceIsSupportedRemote(device));
    }
    
    start() {
        const miBoxerRemotes = this._getAvailableMiBoxerRemotes() || [];
        
        // Setup discovery for remotes that have been added before the extension was started
        miBoxerRemotes.forEach(device => this._setupDeviceDiscovery(device));
        
        // Setup discovery for remotes that are added while the extension is running
        this.eventBus.onDeviceJoined(this, (data) => {
            const device = data.device;
            if (this._deviceIsSupportedRemote(device)) {
                this._setupDeviceDiscovery(device);
            }
        });
        
        // Listen for events fired by the remote(s)
        this.eventBus.onDeviceMessage(this, (data) => {
            const { vendor, model } = data.device._definition;
            if (vendor === 'MiBoxer' && model === 'FUT089Z') {
                const ieeeAddr = data.device.zh._ieeeAddr;
                const { type, groupID, cluster } = data;
                let zone
                if (groupID <= 108) {
                    zone = groupID-100;
                } else { //In case https://github.com/Koenkk/zigbee-herdsman-converters/pull/6275 gets merged
                    zone = groupID-parseInt(ieeeAddr, 16);
                }
                if (cluster === 'genOnOff') { // Button was pressed
                    if (type === 'commandOn') {
                        this.mqtt.publish(`${ieeeAddr}/action`, `button_group_${zone}_on`);
                    } else if (type === 'commandOff') {
                        this.mqtt.publish(`${ieeeAddr}/action`, `button_group_${zone}_off`);
                    }
                } else if (cluster === 'genLevelCtrl' && type === 'commandMoveToLevel') { // Brightness slider
                    const newBrightnessSliderLevel = data?.data?.level;
                    if (newBrightnessSliderLevel !== this.previousBrightnessSliderLevelByIeeeAddr[ieeeAddr] && newBrightnessSliderLevel !== null) { // workaround for color temp slider and color controls sending the previous brightness slider command again
                        const triggerPayloadObject = {brightness: newBrightnessSliderLevel, zone: groupID};
                        const triggerPayload = JSON.stringify(triggerPayloadObject);
                        this.mqtt.publish(`${ieeeAddr}/brightness`, triggerPayload);
                        this.previousBrightnessSliderLevelByIeeeAddr[ieeeAddr] = newBrightnessSliderLevel;
                    }
                } else if (cluster === 'lightingColorCtrl' && type === 'commandMoveToColorTemp') { // Color temperature slider
                    const newColorTemperatureSliderLevel = data?.data?.colortemp;
                    const triggerPayloadObject = {colortemp: newColorTemperatureSliderLevel, zone: groupID};
                    const triggerPayload = JSON.stringify(triggerPayloadObject);
                    this.mqtt.publish(`${ieeeAddr}/color_temp`, triggerPayload);
                } /*else if (cluster === ? && type === ?) { // Color wheel and 'R', 'G', 'B', 'W' buttons // TODO
                    const newRgbColor = data?.data?.rgbcolor;
                    const triggerPayload = {rgb: newRgbColor, zone: groupID};
                    this.mqtt.publish(`${ieeeAddr}/rgb`, triggerPayload);
                }*/
            }
        });
    }
    
    stop() {
        this.eventBus.removeListeners(this);
    }
}

module.exports = MiboxerFut089zControlsExposer;
