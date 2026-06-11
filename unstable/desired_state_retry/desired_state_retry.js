const CONFIG = {
    // List friendly names or IEEE addresses. Use ['*'] only when every device
    // with a supported property should be retried.
    devices: [],
    // Retried properties. `state` covers on/off/open/close style actuators.
    properties: ['state'],
    maxRetries: 4,
    retryCooldownSeconds: 4,
    deadlineSeconds: 30,
};

const STATE_VALUES = ['on', 'off', 'open', 'close', 'lock', 'unlock'];

class DesiredStateRetry {
    constructor(zigbee, mqtt, state, _publishEntityState, eventBus, _enableDisableExtension, _restartCallback, _addExtension, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.eventBus = eventBus;
        this.settings = settings;
        this.logger = logger;
        this.targets = new Map();
        this.ownPublishes = new Map();
        this.running = false;
        this.runScheduled = false;
    }

    start() {
        if (!CONFIG.devices.length) {
            this.logger.warning('desired_state_retry has no configured devices; extension is loaded but will not retry commands');
        }

        this.eventBus.onMQTTMessage(this, this.onMQTTMessage.bind(this));
        this.eventBus.onStateChange(this, this.onStateChange.bind(this));
        this.logger.warning('desired_state_retry loaded; this is an opt-in workaround for lossy device commands');
    }

    stop() {
        for (const target of this.targets.values()) {
            this.clearTimer(target);
        }

        this.targets.clear();
        this.ownPublishes.clear();
        this.eventBus.removeListeners(this);
    }

    onMQTTMessage(data) {
        const parsed = this.parseMQTTMessage(data);

        if (!parsed) {
            return;
        }

        if (this.consumeOwnPublish(data.topic, data.message)) {
            return;
        }

        const target = this.buildTarget(parsed, data);

        if (!target) {
            return;
        }

        const key = this.key(target);
        const existing = this.targets.get(key);

        if (existing) {
            if (sameState(existing.targetState, target.targetState)) {
                existing.topic = target.topic;
                existing.message = target.message;
                this.logger.debug(`Coalesced desired state retry for '${key}'`);
                return;
            }

            this.supersede(key, existing);
        }

        this.targets.set(key, target);
        this.armTimer(target);
        this.scheduleRun();
    }

    parseMQTTMessage(data) {
        const baseTopic = this.settings.get().mqtt.base_topic;
        const prefix = `${baseTopic}/`;

        if (!data.topic.startsWith(prefix)) {
            return undefined;
        }

        const relativeTopic = data.topic.slice(prefix.length);

        if (relativeTopic.startsWith('bridge/')) {
            return undefined;
        }

        const parts = relativeTopic.split('/');
        const setIndex = parts.indexOf('set');

        if (setIndex < 1) {
            return undefined;
        }

        const deviceAndEndpoint = parts.slice(0, setIndex).join('/');
        const topicProperty = parts[setIndex + 1];

        return {deviceAndEndpoint, topicProperty};
    }

    buildTarget(parsed, data) {
        const resolved = this.zigbee.resolveEntityAndEndpoint(parsed.deviceAndEndpoint);
        const entity = this.zigbee.resolveEntity(resolved.ID);

        if (!entity || !entity.isDevice()) {
            return undefined;
        }

        if (!this.matchesConfiguredDevice(entity)) {
            return undefined;
        }

        const message = parsePayload(data.message, parsed.topicProperty);

        if (!message) {
            return undefined;
        }

        const endpointID = resolved.endpointID || 'default';
        const endpointNames = entity.getEndpointNames ? entity.getEndpointNames() : [];
        const propertyEndpointRegex = endpointNames.length ? new RegExp(`^(.*?)_(${endpointNames.map(escapeRegex).join('|')})$`) : undefined;
        const targetState = {};

        for (const [rawKey, value] of Object.entries(message)) {
            let property = rawKey;
            let stateKey = rawKey;

            if (propertyEndpointRegex) {
                const match = rawKey.match(propertyEndpointRegex);

                if (match) {
                    property = match[1];
                    stateKey = rawKey;
                }
            }

            if (!CONFIG.properties.includes(property)) {
                continue;
            }

            if (!isVerifiableValue(value)) {
                continue;
            }

            if (resolved.endpointID && !stateKey.endsWith(`_${resolved.endpointID}`)) {
                stateKey = `${stateKey}_${resolved.endpointID}`;
            }

            targetState[stateKey] = normalizeComparableValue(value);
        }

        if (!Object.keys(targetState).length) {
            return undefined;
        }

        const now = Date.now();

        return {
            entity,
            endpointID,
            targetState,
            topic: data.topic,
            message: data.message,
            retries: 0,
            createdAt: now,
            deadlineAt: now + CONFIG.deadlineSeconds * 1000,
            nextEligibleAt: now + CONFIG.retryCooldownSeconds * 1000,
            inFlight: false,
            timer: undefined,
        };
    }

    matchesConfiguredDevice(entity) {
        return CONFIG.devices.includes('*') || CONFIG.devices.includes(entity.name) || CONFIG.devices.includes(entity.ieeeAddr);
    }

    onStateChange(data) {
        if (!data.entity?.isDevice?.()) {
            return;
        }

        for (const [key, target] of this.targets) {
            if (target.entity.ieeeAddr === data.entity.ieeeAddr && isApplied(target.targetState, data.to)) {
                this.complete(key, target, 'applied');
            }
        }
    }

    scheduleRun() {
        if (this.runScheduled) {
            return;
        }

        this.runScheduled = true;
        queueMicrotask(() => {
            this.runScheduled = false;
            void this.run();
        });
    }

    async run() {
        if (this.running) {
            return;
        }

        this.running = true;

        try {
            while (true) {
                const target = this.nextEligible();

                if (!target) {
                    break;
                }

                await this.retry(target);
            }
        } finally {
            this.running = false;
        }
    }

    nextEligible() {
        const now = Date.now();
        const candidates = Array.from(this.targets.values()).filter((target) => !target.inFlight && target.nextEligibleAt <= now);

        candidates.sort((a, b) => a.createdAt - b.createdAt);

        return candidates[0];
    }

    async retry(target) {
        const key = this.key(target);

        if (Date.now() >= target.deadlineAt || target.retries >= CONFIG.maxRetries) {
            this.complete(key, target, 'failed');
            return;
        }

        target.inFlight = true;
        target.retries += 1;
        this.rememberOwnPublish(target.topic, target.message);

        try {
            this.logger.debug(`Retrying desired state '${key}' retry ${target.retries}/${CONFIG.maxRetries}`);
            await this.mqtt.publish(target.topic.slice(`${this.settings.get().mqtt.base_topic}/`.length), target.message, {skipReceive: false});
        } finally {
            target.inFlight = false;
        }

        if (this.targets.get(key) !== target) {
            return;
        }

        target.nextEligibleAt = Date.now() + CONFIG.retryCooldownSeconds * 1000;
        this.armTimer(target);
    }

    rememberOwnPublish(topic, message) {
        const key = `${topic}\n${message}`;
        this.ownPublishes.set(key, (this.ownPublishes.get(key) || 0) + 1);
    }

    consumeOwnPublish(topic, message) {
        const key = `${topic}\n${message}`;
        const count = this.ownPublishes.get(key) || 0;

        if (!count) {
            return false;
        }

        if (count === 1) {
            this.ownPublishes.delete(key);
        } else {
            this.ownPublishes.set(key, count - 1);
        }

        return true;
    }

    key(target) {
        return `${target.entity.ieeeAddr}/${target.endpointID}`;
    }

    supersede(key, target) {
        this.clearTimer(target);
        this.targets.delete(key);
        this.logger.debug(`Superseded desired state retry for '${key}'`);
    }

    complete(key, target, status) {
        this.clearTimer(target);
        this.targets.delete(key);
        this.logger.debug(`Desired state retry for '${key}' ${status} after ${target.retries} retr${target.retries === 1 ? 'y' : 'ies'}`);
    }

    armTimer(target) {
        this.clearTimer(target);
        target.timer = setTimeout(() => void this.run(), Math.max(0, target.nextEligibleAt - Date.now()));
    }

    clearTimer(target) {
        if (target.timer) {
            clearTimeout(target.timer);
            target.timer = undefined;
        }
    }
}

function parsePayload(payload, topicProperty) {
    if (topicProperty) {
        return {[topicProperty]: parseValue(payload)};
    }

    const parsed = parseValue(payload);

    if (typeof parsed === 'string' && STATE_VALUES.includes(parsed.toLowerCase())) {
        return {state: parsed};
    }

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
}

function parseValue(value) {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function isVerifiableValue(value) {
    return ['string', 'number', 'boolean'].includes(typeof value);
}

function normalizeComparableValue(value) {
    return typeof value === 'string' ? value.toUpperCase() : value;
}

function isApplied(targetState, currentState) {
    for (const [key, value] of Object.entries(targetState)) {
        if (normalizeComparableValue(currentState[key]) !== value) {
            return false;
        }
    }

    return true;
}

function sameState(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = DesiredStateRetry;
