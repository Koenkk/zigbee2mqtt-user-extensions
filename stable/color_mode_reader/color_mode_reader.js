/*
 * The newer Philips Hue with BT bulbs (by signify) support reporting, except for color_mode
 *
 * This extension will read the colorMode attribute if any of the known color attributes get reported.
 */
class ColorModeReader {

    constructor(zigbee, mqtt, state, publishEntityState, eventBus, enableDisableExtension, restartCallback, addExtension, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.logger = logger;
        this.colorAttributes = [
            'colorTemperature', 'currentX', 'currentY',
            'currentHue', 'enhancedCurrentHue',
            'currentSaturation',
        ];
    }

    start() {
        this.logger.info('Starting color_mode helper');

        // attach to events
        this.eventBus.onDeviceMessage(this, this.onDeviceMessage.bind(this));
    }

    stop() {
        this.logger.info('Stopping color_mode helper');
        this.eventBus.removeListeners(this);
    }

    onDeviceMessage(data) {
        // skip non interviewed devices
        if (!data.device.zh.interviewCompleted) return;

        // filter reporting of lightingColorCtrl
        if (
            (data.type == 'attributeReport') &&
            (data.cluster == 'lightingColorCtrl')
        ) {
            // filter on color related attributes
            for (const attrib of Object.keys(data.data)) {
                if (this.colorAttributes.includes(attrib)) {
                    // check if device has colorMode reporting
                    if (!this.hasColorModeReporting(data.device)) {
                        this.readColorMode(data.device, data.endpoint, Object.keys(data.data))
                    }
                    return;
                }
            }
        }
    }

    /**
     * Look for colorMode or enhancedColorMode reporting
     */
    hasColorModeReporting(device) {
        let ret = false;
        device.zh.endpoints.forEach(ep => {
            ep.configuredReportings.forEach(report => {
                // skip reports on non lightingColorCtrl cluster
                if (report.cluster.name != "lightingColorCtrl") return;

                // skip reports on non colorMode attributes
                if (!['colorMode', 'enhancedColorMode'].includes(report.attribute.name)) return;

                ret = true;
            });
        });
        return ret;
    }

    /**
     * Read colorMode and original attributes from report
     */
    readColorMode(device, endpoint, attributes=[]) {
        attributes.push('colorMode');
        this.logger.debug(`Reading '${attributes.join(', ')}' from '${device.name}' (${device.ieeeAddr})`);
        endpoint.read('lightingColorCtrl', attributes);
    }
}

module.exports = ColorModeReader;
