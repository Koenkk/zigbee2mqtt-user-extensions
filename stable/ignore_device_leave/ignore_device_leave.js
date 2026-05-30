const IGNORE_MODELS  = ['TS0505B'];
const IGNORE_DEVICES = [];

export default class IgnoreLeave {
  constructor(zigbee, _1, _2, _3, _4, _5, _6, _7, _8, logger) {
    const ctrl      = zigbee.zhController;
    this._adapter   = ctrl.adapter;
    this._getDevice = ctrl.getDeviceByIeeeAddr.bind(ctrl);
    this._logger    = logger;
    this._orig      = [];
  }

  async start() {
    this._orig = this._adapter.rawListeners('deviceLeave').slice();
    this._adapter.removeAllListeners('deviceLeave');
    this._adapter.on('deviceLeave', (p) => {
      const d = this._getDevice(p.ieeeAddr);
      if (d && (IGNORE_MODELS.includes(d.modelID) || IGNORE_DEVICES.includes(d.ieeeAddr))) {
        this._logger.warning(`Ignoring leave from ${d.ieeeAddr} (${d.modelID})`);
        return;
      }
      this._orig.forEach(fn => fn(p));
    });
    this._logger.warning(`patching deviceLeave handler to ignore models=${IGNORE_MODELS} devices=${IGNORE_DEVICES}`);
  }

  async stop() {
    this._adapter.removeAllListeners('deviceLeave');
    this._orig.forEach(fn => this._adapter.on('deviceLeave', fn));
    this._orig = [];
  }
}
