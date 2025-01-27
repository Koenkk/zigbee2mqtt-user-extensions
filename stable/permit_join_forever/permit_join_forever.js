/**
 * This extension is NOT recommended but unfortunately necessary
 * for some devices to work properly (like Livolo). Use with caution
 * as this will make it very easy for someone to hack your Zigbee network!
 * https://github.com/Koenkk/zigbee2mqtt/issues/25626
 */
const NS = 'ext:permit-join-forever';

class PermitJoinForeverExtension {
    constructor(zigbee, mqtt, state, publishEntityState, eventBus, enableDisableExtension, restartCallback, addExtension, settings, logger) {
        this.logger = logger;
        this.zigbee = zigbee;
    }

    start() {
        this.logger.warning('Permitting joining forever, only use this extension when strictly necessary!', NS);
        this.zigbee.permitJoin(254);
        this.interval = setInterval(() => {
            this.zigbee.permitJoin(254);
        }, 240 * 1000);
    }

    stop() {
        clearInterval(this.interval);
    }
}

module.exports = PermitJoinForeverExtension;
