const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class ModesPanel extends AlarmDevice {
    async init() {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'alarm_control_panel'
        
        // Build required MQTT topics for device
        this.deviceTopic = this.ringTopic+'/'+this.locationId+'/mode/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/mode_state'
        this.commandTopic = this.deviceTopic+'/mode_command'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Device specific properties
        this.currentMode =  this.currentMode ? this.currentMode : 'unknown'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery()
        await utils.sleep(2)

        // This is a polled device so don't use common publish/subscribe function
        if (this.subscribed) {
            const priorMode = this.currentMode
            this.currentMode = 'republish'
            this.publishData(priorMode)
        } else {
            this.device.location.onLocationMode.subscribe((mode) => {
                this.publishData(mode)
            })
            this.subscribed = true
        }
        this.online()
    }

    publishDiscovery() {
        // Build the MQTT discovery message
        const message = {
            name: this.device.location.name + ' Mode',
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            command_topic: this.commandTopic
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(this.configTopic, JSON.stringify(message))
        this.mqttClient.subscribe(this.commandTopic)
    }

    async publishData(mode) {
        let mqttMode
        switch(mode) {
            case 'disarmed':
                mqttMode = 'disarmed'
                break;
            case 'home':
                mqttMode = 'armed_home'
                break;
            case 'away':
                mqttMode = 'armed_away'
                break;
            default:
                mqttMode = 'disarmed'
        }

        // Publish device state if it's changed from prior state
        if (this.currentMode !== mode) {
            this.currentMode = mode
            this.publishMqtt(this.stateTopic, mqttMode, true)
        }
    }
    
    // Process messages from MQTT command topic
    processCommand(message) {
        this.setLocationMode(message)
    }

    // Set Alarm Mode on received MQTT command message
    async setLocationMode(message) {
        debug('Received set mode command '+message+' for location: '+this.device.location.name)

        // Try to set alarm mode and retry after delay if mode set fails
        // Initial attempt with no delay
        let delay = 0
        let retries = 6
        let setModeSuccess = false
        while (retries-- > 0 && !(setModeSuccess)) {
            setModeSuccess = await this.trySetMode(message, delay)
            // On failure delay 10 seconds before next set attempt
            delay = 10
        }
        // Check the return status and print some debugging for failed states
        if (setModeSuccess == false ) {
            debug('Could not enter proper mode state after all retries...Giving up!')
        } else if (setModeSuccess == 'unknown') {
            debug('Ignoring unknown command.')
        }
    }

    async trySetMode(message, delay) {
        await utils.sleep(delay)
        let targetMode
        switch(message) {
            case 'DISARM':
                targetMode = 'disarmed'
                break
            case 'ARM_HOME':
                targetMode = 'home'
                break
            case 'ARM_AWAY':
                targetMode = 'away'
                break
            default:
                debug('Cannot set alarm mode: Unknown')
                return 'unknown'
        }
        debug('Set location mode: '+targetMode)
        await this.device.location.setLocationMode(targetMode)

        // Sleep a 1 second and check if location entered the requested mode
        await utils.sleep(1);
        if (targetMode == (await this.device.location.getLocationMode()).mode) {
            debug('Location '+this.device.location.name+' successfully entered mode: '+message)
            return true
        } else {
            debug('Location failed to enter requested mode!')
            return false
        }
    }
}

module.exports = ModesPanel
