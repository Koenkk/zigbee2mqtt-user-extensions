# ColorMode Reader

Some lights, such as the *Philips Hue with BT* series from Signify, support reporting for the color-related attributes of the `lightingColorCtrl` cluster. However, they do not support reporting for the `colorMode` or `enhancedColorMode` attributes.

If you have manually added reporting for the color-related attributes, for example, when using the Hue BT app or a Zigbee remote that can change the color, the `color_mode` property for the device can become out of sync. This also affects zigbee2mqtt's automatic color synchronization in its payload.

This extension will fix this issue by reading the `lightingColorCtrl.colorMode` attribute when zigbee2mqtt receives an **attributeReport** event for any of the color-related attributes. To avoid unnecessary traffic on the Zigbee mesh, this read operation is only performed when the device does *NOT* have reporting configured for `colorMode`.
