package com.andreaacanfora.raygpt.services

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Audio setup for a conversation (the Android counterpart of iOS's voiceChat session, docs/PROJECT.md §6):
 * communication mode, so the platform echo canceller is on, and a route that prefers a Bluetooth
 * headset such as the glasses (HFP/SCO or LE Audio), then a wired headset, then the loudspeaker.
 * Routes are re-evaluated when a device connects or disconnects during the conversation.
 */
class AudioRouter(context: Context) {
    /** Called on the main thread with the new route description. */
    var onRouteChange: ((String) -> Unit)? = null

    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var focusRequest: AudioFocusRequest? = null
    private var active = false

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = reroute()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = reroute()
    }

    fun start() {
        if (active) return
        active = true
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .build()
            .also { audioManager.requestAudioFocus(it) }
        audioManager.registerAudioDeviceCallback(deviceCallback, main)
        reroute()
    }

    fun stop() {
        if (!active) return
        active = false
        audioManager.unregisterAudioDeviceCallback(deviceCallback)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audioManager.stopBluetoothSco()
            @Suppress("DEPRECATION")
            audioManager.isBluetoothScoOn = false
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
        audioManager.mode = AudioManager.MODE_NORMAL
        onRouteChange?.invoke(describe())
    }

    /** Human-readable current route, e.g. "Ray-Ban Meta [Bluetooth]". */
    fun describe(): String {
        if (!active) return "Audio non attivo"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val device = audioManager.communicationDevice ?: return "Audio predefinito"
            return "${device.productName} [${typeName(device.type)}]"
        }
        @Suppress("DEPRECATION")
        return when {
            audioManager.isBluetoothScoOn -> "Bluetooth"
            audioManager.isSpeakerphoneOn -> "Altoparlante"
            else -> "Cuffie"
        }
    }

    private fun reroute() {
        if (!active) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = audioManager.availableCommunicationDevices
            val preferred = PREFERRED_TYPES.firstNotNullOfOrNull { type -> devices.firstOrNull { it.type == type } }
            if (preferred != null && preferred != audioManager.communicationDevice) {
                audioManager.setCommunicationDevice(preferred)
            }
        } else {
            rerouteLegacy()
        }
        onRouteChange?.invoke(describe())
    }

    /** Before Android 12: SCO for a Bluetooth headset, speakerphone when nothing is plugged in. */
    @Suppress("DEPRECATION")
    private fun rerouteLegacy() {
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
        when {
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO in outputs -> {
                audioManager.isSpeakerphoneOn = false
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
            }
            outputs.any { it in WIRED_TYPES } -> {
                audioManager.stopBluetoothSco()
                audioManager.isSpeakerphoneOn = false
            }
            else -> {
                audioManager.stopBluetoothSco()
                audioManager.isSpeakerphoneOn = true
            }
        }
    }

    @SuppressLint("InlinedApi") // LE Audio devices only appear on Android 12+.
    private companion object {
        val WIRED_TYPES = listOf(
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET,
        )
        val PREFERRED_TYPES = listOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
        ) + WIRED_TYPES + AudioDeviceInfo.TYPE_BUILTIN_SPEAKER

        fun typeName(type: Int) = when (type) {
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth"
            AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth LE"
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "altoparlante"
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "auricolare del telefono"
            in WIRED_TYPES -> "cuffie"
            else -> "tipo $type"
        }
    }
}
