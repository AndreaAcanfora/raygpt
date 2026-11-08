package com.andreaacanfora.raygpt.services

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import com.andreaacanfora.raygpt.conversation.ClientEvent
import com.andreaacanfora.raygpt.conversation.LiveEvent
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * WebRTC connection to GPT-Live (docs/PROJECT.md §3.3): microphone track plus the `oai-events`
 * data channel, SDP offer sent through the backend, SDP answer applied. Remote audio is played
 * on the communication route chosen by [AudioRouter] (the glasses, when connected over Bluetooth).
 *
 * WebRTC calls the observers on its own threads: every callback is forwarded to the main thread.
 */
class RealtimeService(context: Context) {
    class RealtimeError(message: String) : Exception(message)

    /** Called on the main thread for every GPT-Live event. */
    var onEvent: ((LiveEvent) -> Unit)? = null
    /** Called on the main thread when the peer connection state changes. */
    var onConnectionStateChange: ((PeerConnection.PeerConnectionState) -> Unit)? = null

    private val factory = factory(context.applicationContext)
    private val main = Handler(Looper.getMainLooper())
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private var audioSource: AudioSource? = null
    private var microphoneTrack: AudioTrack? = null

    val isDataChannelOpen: Boolean get() = dataChannel?.state() == DataChannel.State.OPEN

    /** Opens the session and returns its GPT-Live id. Events start arriving with `session.started`. */
    suspend fun connect(backend: BackendClient, voice: String, location: GeoPoint?): String {
        val configuration = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val peerConnection = factory.createPeerConnection(configuration, peerObserver)
            ?: throw RealtimeError("Impossibile creare la connessione WebRTC")
        this.peerConnection = peerConnection

        val source = factory.createAudioSource(audioConstraints)
        val track = factory.createAudioTrack("raygpt-microphone", source)
        peerConnection.addTrack(track, listOf("raygpt"))
        audioSource = source
        microphoneTrack = track

        // The data channel must exist before the offer is created.
        val channel = peerConnection.createDataChannel("oai-events", DataChannel.Init())
            ?: throw RealtimeError("Impossibile creare il canale eventi")
        channel.registerObserver(channelObserver)
        dataChannel = channel

        val offer = sdp<SessionDescription> { peerConnection.createOffer(it, MediaConstraints()) }
        sdp<Unit> { peerConnection.setLocalDescription(it, offer) }
        waitForIceGathering(peerConnection)
        val offerSdp = peerConnection.localDescription?.description
            ?: throw RealtimeError("Offerta SDP mancante")

        val session = backend.createSession(offerSdp, voice, location)
        sdp<Unit> {
            peerConnection.setRemoteDescription(it, SessionDescription(SessionDescription.Type.ANSWER, session.sdp))
        }
        return session.sessionId
    }

    fun send(event: ClientEvent) {
        val bytes = event.toJson().toByteArray(Charsets.UTF_8)
        dataChannel?.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
    }

    /** Mutes the microphone locally and tells GPT-Live, which keeps the session open. */
    fun setMuted(muted: Boolean) {
        microphoneTrack?.setEnabled(!muted)
        send(if (muted) ClientEvent.Mute else ClientEvent.Unmute)
    }

    fun disconnect() {
        dataChannel?.let {
            it.unregisterObserver()
            it.close()
            it.dispose()
        }
        dataChannel = null
        // Disposing the peer connection also disposes the track it owns through its sender.
        peerConnection?.dispose()
        peerConnection = null
        microphoneTrack = null
        audioSource?.dispose()
        audioSource = null
    }

    /** As in OpenAI's WebRTC guide: send the offer once ICE gathering is complete, or after a timeout. */
    private suspend fun waitForIceGathering(peerConnection: PeerConnection) {
        val deadline = System.currentTimeMillis() + ICE_GATHERING_TIMEOUT_MS
        while (peerConnection.iceGatheringState() != PeerConnection.IceGatheringState.COMPLETE &&
            System.currentTimeMillis() < deadline
        ) {
            delay(100)
        }
    }

    /** Wraps one SDP operation: create* resumes with the description, set* with Unit. */
    @Suppress("UNCHECKED_CAST")
    private suspend fun <T> sdp(start: (SdpObserver) -> Unit): T = suspendCancellableCoroutine { continuation ->
        start(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) = continuation.resume(description as T)
            override fun onSetSuccess() = continuation.resume(Unit as T)
            override fun onCreateFailure(error: String?) =
                continuation.resumeWithException(RealtimeError("Impossibile creare l'offerta SDP: $error"))
            override fun onSetFailure(error: String?) =
                continuation.resumeWithException(RealtimeError("SDP rifiutato: $error"))
        })
    }

    private val peerObserver = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
        override fun onIceCandidate(candidate: IceCandidate) {}
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
        override fun onAddStream(stream: MediaStream) {}
        override fun onRemoveStream(stream: MediaStream) {}
        override fun onDataChannel(channel: DataChannel) {}
        override fun onRenegotiationNeeded() {}

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
            main.post { onConnectionStateChange?.invoke(state) }
        }
    }

    private val channelObserver = object : DataChannel.Observer {
        override fun onBufferedAmountChange(previousAmount: Long) {}
        override fun onStateChange() {}

        override fun onMessage(buffer: DataChannel.Buffer) {
            val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
            val event = LiveEvent.parse(String(bytes, Charsets.UTF_8)) ?: return
            main.post { onEvent?.invoke(event) }
        }
    }

    private companion object {
        const val ICE_GATHERING_TIMEOUT_MS = 10_000L

        /** WebRTC's software echo cancellation and noise suppression, on top of the hardware ones. */
        val audioConstraints = MediaConstraints().apply {
            listOf("googEchoCancellation", "googNoiseSuppression", "googAutoGainControl", "googHighpassFilter")
                .forEach { mandatory.add(MediaConstraints.KeyValuePair(it, "true")) }
        }

        @Volatile
        private var sharedFactory: PeerConnectionFactory? = null

        /** One factory per process: the audio device module records and plays in communication mode. */
        @Synchronized
        fun factory(context: Context): PeerConnectionFactory = sharedFactory ?: run {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
            val audioDeviceModule = JavaAudioDeviceModule.builder(context)
                .setUseHardwareAcousticEchoCanceler(true)
                .setUseHardwareNoiseSuppressor(true)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .createAudioDeviceModule()
            PeerConnectionFactory.builder().setAudioDeviceModule(audioDeviceModule).createPeerConnectionFactory()
                .also { sharedFactory = it }
        }
    }
}
