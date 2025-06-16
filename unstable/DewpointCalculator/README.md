# DewpointCalculator

Thermometer/Hygrometer-Device report temperature and relative humidity. In order to decide weather the humidity may raise or fall compared to the values of a different sensor the dewpoint needs to be compared. This value is mostly not reported, but can be calculated using the reported values temperature and humidity.

This extensions addes a calculated dewpoint to every device-message containing temperature and humidity, but misses a value for dewpoint.

Please be aware that the calculated value is added to the mqtt-message, but Zigbee2MQTT and depending systems (f.e. Home Assistant) are *NOT* aware of this newly added value. If you have any hints on making the device itself aware of this valu, so it is reported as a sensor to Home Assistant, please let me know!
