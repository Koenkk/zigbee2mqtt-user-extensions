/*
 * This extension adds a calculated value "dewpoint" to each message reported by a device containing "temperature" and "humidity" but missing "dewpoint".
 * If you are not aware of what use the value of "dewpoint" may be in your setup... just skip this extension. 
 * All others may use this to minimize computing of dewpoint-values in any software based on values reported by zigbee2mqtt.
 */

class DewpointCalculator {
    constructor(
        zigbee,
        mqtt,
        state,
        publishEntityState,
        eventBus,
        enableDisableExtension,
        restartCallback,
        addExtension,
        settings,
        logger,
    ) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.enableDisableExtension = enableDisableExtension;
        this.restartCallback = restartCallback;
        this.addExtension = addExtension;
        this.settings = settings;
        this.logger = logger;

        this.logger.info('Loaded DewpointCalculator');
//        this.mqttBaseTopic = this.settings.get().mqtt.base_topic;
    }

    /**
     * Called when the extension starts (on Zigbee2MQTT startup, or when the extension is saved at runtime)
     */
    start() {
        this.logger.info('DewpointCalculator - start');

        // all possible events can be seen here: https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/eventBus.ts
        this.eventBus.onStateChange(this, this.onStateChange.bind(this));

        // this.mqtt.publish('DewpointCalculator/state', 'start');
        // this.logger.info('DewpointCalculator - started');
    }

    /**
     * Called when the extension stops (on Zigbee2MQTT shutdown, or when the extension is saved/removed at runtime)
     */
    stop() {
        this.logger.info('DewpointCalculator - stop');

        // unload listener
        this.eventBus.removeListeners(this);

        // this.mqtt.publish('DewpointCalculator/state', 'stop');
        // this.logger.info('DewpointCalculator - stopped');
    }
    
    async onStateChange(data) {
        // see typing (properties) here: https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/types/types.d.ts => namespace eventdata
        const { entity, update } = data;

        if ((data.to.hasOwnProperty('temperature')) & (data.to.hasOwnProperty('humidity'))) {
            if (!data.to.hasOwnProperty('dewpoint')) {
                // add custom property called "dewpoint" beeing calculated by method calculateDewpoint()
                data.to['dewpoint'] = +this.calculateDewpoint(data.to['temperature'], data.to['humidity']);
            }
        }
    }

    calculateDewpoint(tempC, humidRel) {
        var molecularWeight = 18.016; // of water vapor in kg/kmol
        var gasConstant = 8214.3; // in J/(kmol*K)
        var tempK = tempC + 273.15;

        var a, b;
        if (tempC >= 0) {
            a = 7.5;
            b = 237.3;
        } else {
            a = 7.6;
            b = 240.7;
        }
         
        // saturation vapor pressure (hPa)
        var saturationVaporPressure=6.1078*Math.pow(10,(a*tempC)/(b+tempC));
        // vapor pressure (hPa)
        var vaporPressure = saturationVaporPressure*(humidRel/100);
        // Wasserdampfdichte bzw. absolute Feuchte (g/m3)
        var humidAbs = Math.pow(10,5)*molecularWeight/gasConstant*vaporPressure/tempK;
        // v-Parameter
        var v = Math.log10(vaporPressure/6.1078);
        // Taupunkttemperatur (°C)
        var dewpointC = (b*v)/(a-v);

        return(+dewpointC.toFixed(2));
    }

    async onMQTTMessage(topic, message) {
        // console.log({topic, message});
    }

}

// eslint-disable-next-line no-undef
module.exports = DewpointCalculator;
