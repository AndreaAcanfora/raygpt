package com.andreaacanfora.raygpt.conversation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.andreaacanfora.raygpt.history.ConversationRecord
import com.andreaacanfora.raygpt.history.HistoryStore
import com.andreaacanfora.raygpt.services.AudioRouter
import com.andreaacanfora.raygpt.services.BackendClient
import com.andreaacanfora.raygpt.services.ConversationService
import com.andreaacanfora.raygpt.services.GeoPoint
import com.andreaacanfora.raygpt.services.LocationService
import com.andreaacanfora.raygpt.services.RealtimeService
import com.andreaacanfora.raygpt.settings.AppSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.webrtc.PeerConnection
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * Application-level conversation logic (docs/PROJECT.md §7.1, §8, client spec): starts the
 * foreground service, connects GPT-Live, keeps transcript, limits, VPS announcements and history,
 * and tears everything down. It does not decide turns: GPT-Live is full duplex and handles
 * interruptions itself. Runs on the main thread; state is observable by Compose.
 */
class ConversationController(private val context: Context) {
    enum class Phase { IDLE, CONNECTING, ACTIVE, STOPPING }

    val settings = AppSettings(context)
    private val historyStore = HistoryStore(File(context.filesDir, "history.json"))

    var phase by mutableStateOf(Phase.IDLE)
        private set
    var status by mutableStateOf("Pronto")
        private set
    var lines by mutableStateOf(emptyList<Line>())
        private set
    var isMuted by mutableStateOf(false)
        private set
    var billedSeconds by mutableDoubleStateOf(0.0)
        private set
    var startLatencySeconds by mutableStateOf<Double?>(null)
        private set
    var route by mutableStateOf("Audio non attivo")
        private set
    var history by mutableStateOf(historyStore.load())
        private set

    val estimatedCostUSD: Double get() = billedSeconds / 60 * PRICE_PER_MINUTE_USD

    /** The history record of the conversation in progress, if any. */
    val activeRecordId: String? get() = record?.id?.takeIf { phase != Phase.IDLE }

    private val scope = MainScope()
    @OptIn(ExperimentalCoroutinesApi::class)
    private val historyDispatcher = Dispatchers.IO.limitedParallelism(1)
    private val audio = AudioRouter(context).also { router -> router.onRouteChange = { route = it } }
    private val location = LocationService(context).also { service -> service.onMove = ::sendPosition }

    private var backend: BackendClient? = null
    private var realtime: RealtimeService? = null
    private var transcript = Transcript()
    private var monitor: ConversationMonitor? = null
    private var record: ConversationRecord? = null
    private var recordDirty = false
    private var sessionId: String? = null
    private var requestedAt = 0L
    private var startPosition: Deferred<Location?>? = null
    private var lastSentPosition: Pair<Location, Long>? = null
    private var connectJob: Job? = null
    private var tickJob: Job? = null
    private var vpsJob: Job? = null
    private var sessionClosed = false
    private var closedSignal = CompletableDeferred<Unit>()

    // region Public actions

    fun start() {
        if (phase != Phase.IDLE) return
        val client = settings.backendClient() ?: run {
            status = "Imposta indirizzo del backend e token (icona ingranaggio)"
            return
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status = "Permesso microfono negato: Impostazioni → App → Raggio → Autorizzazioni"
            return
        }

        backend = client
        phase = Phase.CONNECTING
        status = "Connessione a GPT-Live…"
        transcript = Transcript()
        lines = emptyList()
        billedSeconds = 0.0
        startLatencySeconds = null
        isMuted = false
        sessionId = null
        record = null
        monitor = null
        sessionClosed = false
        closedSignal = CompletableDeferred()
        lastSentPosition = null
        requestedAt = System.currentTimeMillis()

        ConversationService.start(context, withLocation = location.hasPermission)
        audio.start()
        // In parallel with the audio setup: the position goes with the session request.
        startPosition = scope.async { location.current(START_POSITION_TIMEOUT_MS) }
        connectJob = scope.launch { connect(client) }
    }

    fun stop(reason: String = "close_requested") {
        scope.launch { stopNow(reason) }
    }

    fun toggleMute() {
        if (phase != Phase.ACTIVE) return
        isMuted = !isMuted
        realtime?.setMuted(isMuted)
        monitor?.let { refreshStatus(it) }
    }

    fun clearHistory() {
        val current = record.takeIf { phase == Phase.ACTIVE }
        history = emptyList()
        scope.launch {
            history = withContext(historyDispatcher) {
                historyStore.clear()
                current?.let { historyStore.save(it) } ?: emptyList()
            }
        }
    }

    // endregion

    // region Connection

    private suspend fun connect(client: BackendClient) {
        val service = RealtimeService(context)
        service.onEvent = ::handle
        service.onConnectionStateChange = { state ->
            if (state == PeerConnection.PeerConnectionState.FAILED) stop("connection_lost")
        }
        realtime = service

        try {
            val position = startPosition?.await()
            if (position != null) lastSentPosition = position to System.currentTimeMillis()
            val id = service.connect(client, settings.voice, position?.toGeoPoint())
            if (sessionId == null) sessionId = id
            if (phase == Phase.CONNECTING) status = "In attesa di GPT-Live…"
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            fail(error.message ?: error.toString())
        }
    }

    private fun handle(event: LiveEvent) {
        val now = System.currentTimeMillis()
        when (event) {
            is LiveEvent.Started -> onStarted(event, now)
            is LiveEvent.InputTranscript -> {
                if (!append(Speaker.USER, event.text, now)) return
                monitor?.onUserSpeech(now)
                val line = lines.lastOrNull()
                if (phase == Phase.ACTIVE && line?.speaker == Speaker.USER && VoiceCommands.isStop(line.text)) {
                    stop("voice_command")
                }
            }
            is LiveEvent.OutputTranscript -> {
                if (append(Speaker.ASSISTANT, event.text, now)) monitor?.onAssistantSpeech(now)
            }
            is LiveEvent.Usage -> billedSeconds = event.seconds
            is LiveEvent.Closed -> {
                event.seconds?.let { billedSeconds = it }
                sessionClosed = true
                closedSignal.complete(Unit)
                if (phase == Phase.CONNECTING || phase == Phase.ACTIVE) stop(event.reason ?: "closed")
            }
            is LiveEvent.Error -> status = "Errore GPT-Live: ${event.message}"
            LiveEvent.DelegationStarted -> monitor?.let {
                it.onDelegationStarted(now)
                refreshStatus(it)
            }
            LiveEvent.DelegationFinished -> monitor?.let {
                it.onDelegationFinished(now)
                refreshStatus(it)
            }
            is LiveEvent.Other -> Unit
        }
    }

    private fun onStarted(event: LiveEvent.Started, now: Long) {
        if (phase != Phase.CONNECTING) return
        phase = Phase.ACTIVE
        if (event.sessionId.isNotEmpty()) sessionId = event.sessionId
        startLatencySeconds = (now - requestedAt) / 1000.0
        val newMonitor = ConversationMonitor(settings.idleSeconds, settings.maxMinutes, now)
        monitor = newMonitor
        record = ConversationRecord(id = UUID.randomUUID().toString(), startedAt = Instant.ofEpochMilli(now).toString())
        recordDirty = true
        refreshStatus(newMonitor)
        tickJob = scope.launch {
            while (isActive) {
                delay(TICK_MS)
                tick(newMonitor)
            }
        }
        vpsJob = scope.launch { pollVps(newMonitor) }
        location.startUpdates()
    }

    private fun append(speaker: Speaker, text: String, now: Long): Boolean {
        if (!transcript.append(speaker, text, now)) return false
        lines = transcript.lines
        recordDirty = true
        return true
    }

    /** Tells GPT-Live where the user is now, after a move (LocationService.MIN_MOVE_METERS). */
    private fun sendPosition(newLocation: Location) {
        val client = backend ?: return
        if (phase != Phase.ACTIVE) return
        val now = System.currentTimeMillis()
        lastSentPosition?.let { (last, at) ->
            if (now - at < POSITION_UPDATE_INTERVAL_MS || last.distanceTo(newLocation) < LocationService.MIN_MOVE_METERS) return
        }
        lastSentPosition = newLocation to now
        scope.launch {
            val place = runCatching { client.place(newLocation.toGeoPoint()) }.getOrNull() ?: return@launch
            send(ClientEvent.Thinking(Prompts.position(place.address, place.lat, place.lon)))
        }
    }

    private fun send(event: ClientEvent) {
        val service = realtime ?: return
        if (phase == Phase.ACTIVE && service.isDataChannelOpen) service.send(event)
    }

    // endregion

    // region Limits, VPS tasks, history

    private fun tick(monitor: ConversationMonitor) {
        when (val action = monitor.tick(System.currentTimeMillis(), isMuted)) {
            is ConversationMonitor.Action.Say -> send(ClientEvent.Commentary(action.text))
            is ConversationMonitor.Action.Close -> stop(action.reason)
            null -> Unit
        }
        saveRecordIfDirty()
    }

    /** Polls the VPS tasks started in this conversation until the backend says it has no VPS. */
    private suspend fun pollVps(monitor: ConversationMonitor) {
        val client = backend ?: return
        val since = Instant.ofEpochMilli(requestedAt)
        while (true) {
            delay(VPS_POLL_MS)
            when (val poll = client.vpsTasks(since)) {
                BackendClient.VpsPoll.NotConfigured -> return
                BackendClient.VpsPoll.Failed -> Unit
                is BackendClient.VpsPoll.Tasks -> {
                    if (phase != Phase.ACTIVE) return
                    val wasBusy = monitor.vpsBusy
                    monitor.onVpsTasks(poll.tasks, System.currentTimeMillis())
                        .forEach { send(ClientEvent.Commentary(it)) }
                    if (monitor.vpsBusy != wasBusy) refreshStatus(monitor)
                }
            }
        }
    }

    private fun refreshStatus(monitor: ConversationMonitor) {
        if (phase != Phase.ACTIVE) return
        status = when {
            isMuted -> "Microfono silenziato"
            monitor.delegating -> "Sto cercando…"
            monitor.vpsBusy -> "Il VPS sta lavorando…"
            else -> "In ascolto: parla pure"
        }
    }

    private fun saveRecordIfDirty() {
        val current = record ?: return
        if (!recordDirty) return
        recordDirty = false
        saveRecord(current.copy(lines = lines, billedSeconds = billedSeconds))
    }

    private fun saveRecord(updated: ConversationRecord) {
        record = updated
        scope.launch { history = withContext(historyDispatcher) { historyStore.save(updated) } }
    }

    // endregion

    // region Closing

    private suspend fun stopNow(reason: String) {
        if (phase != Phase.CONNECTING && phase != Phase.ACTIVE) return
        phase = Phase.STOPPING
        status = "Chiusura…"
        tickJob?.cancel()
        vpsJob?.cancel()
        connectJob?.cancel()
        startPosition?.cancel()
        location.stopUpdates()

        realtime?.let { service ->
            if (service.isDataChannelOpen && !sessionClosed) {
                service.send(ClientEvent.Close)
                withTimeoutOrNull(CLOSE_TIMEOUT_MS) { closedSignal.await() }
            }
            service.disconnect()
        }
        realtime = null
        audio.stop()
        ConversationService.stop(context)

        record?.let {
            saveRecord(
                it.copy(
                    endedAt = Instant.now().toString(),
                    reason = reason,
                    billedSeconds = billedSeconds,
                    lines = lines,
                ),
            )
        }
        val client = backend
        val endedSessionId = sessionId
        val seconds = billedSeconds.takeIf { it > 0 }
        if (client != null) scope.launch { client.endSession(endedSessionId, reason, seconds) }

        phase = Phase.IDLE
        status = "Chiusa (${CloseReasons.describe(reason)})"
    }

    private fun fail(message: String) {
        scope.launch {
            stopNow("error")
            status = "Errore: $message"
        }
    }

    // endregion

    private fun Location.toGeoPoint() =
        GeoPoint(latitude, longitude, if (hasAccuracy()) accuracy.toDouble() else null)

    companion object {
        const val PRICE_PER_MINUTE_USD = 0.05
        private const val CLOSE_TIMEOUT_MS = 3_000L
        private const val TICK_MS = 1_000L
        private const val VPS_POLL_MS = 4_000L
        private const val POSITION_UPDATE_INTERVAL_MS = 60_000L
        private const val START_POSITION_TIMEOUT_MS = 5_000L
    }
}
