import AVFoundation
import CoreLocation
import Observation
import WebRTC

/// Application-level conversation logic (docs/PROJECT.md §7.1, §8): starts a CallKit call,
/// connects GPT-Live, keeps transcripts and limits, and tears everything down.
/// It does not decide turns: GPT-Live is full duplex and handles interruptions itself.
@MainActor
@Observable
final class ConversationController {
    static let shared = ConversationController()

    enum Phase {
        case idle, connecting, active, stopping
    }

    enum Speaker {
        case user, assistant
    }

    struct Line: Identifiable {
        let id = UUID()
        let speaker: Speaker
        var text: String
    }

    static let pricePerMinuteUSD = 0.05
    private static let closeTimeoutSeconds = 3.0
    private static let newLineGapSeconds = 1.5
    private static let vpsPollSeconds = 4.0
    /// Seconds before the idle limit when the assistant says it is about to close, and the grace after.
    private static let idleWarningSeconds = 15.0
    private static let idleGraceSeconds = 20.0

    let settings = AppSettings()
    private(set) var phase: Phase = .idle
    private(set) var status = "Pronto"
    private(set) var lines: [Line] = []
    private(set) var isMuted = false
    private(set) var billedSeconds: Double = 0
    private(set) var startLatency: TimeInterval?
    private(set) var route = AudioSessionManager.routeDescription()

    private let call = CallService()
    private let location = LocationService()
    private var startLocation: Task<CLLocation?, Never>?
    private var lastSentLocation: (location: CLLocation, at: Date)?
    private static let positionUpdateInterval: TimeInterval = 60
    private var realtime: RealtimeService?
    private var requestedAt: Date?
    private var startedAt: Date?
    private var lastActivity = Date()
    private var lastSpeaker: Speaker?
    private var lastDeltaAt = Date.distantPast
    private var limitsTimer: Timer?
    private var sessionClosed = false
    private var closedContinuation: CheckedContinuation<Void, Never>?
    private var routeObserver: NSObjectProtocol?
    private let history = ConversationHistory.shared
    private var record: ConversationRecord?
    private var lastSavedAt = Date.distantPast
    private var sessionId: String?
    private var idleWarnedAt: Date?
    // VPS tasks of this conversation: a task can outlast the 25 s the VPS tool waits, and GPT-Live
    // then only hears "still running". Polling keeps the conversation open and has the outcome said.
    private var vpsPoll: Task<Void, Never>?
    private var vpsBusy = false
    private var delegating = false
    private var lastDelegationEnd: Date?
    private var handledTasks: Set<String> = []

    private init() {
        AudioSessionManager.prepare()
        call.onCallStarted = { [weak self] in
            Task { @MainActor in await self?.connect() }
        }
        call.onCallEnded = { [weak self] in
            Task { @MainActor in await self?.stop(reason: "call_ended") }
        }
        location.onMove = { [weak self] newLocation in
            MainActor.assumeIsolated { self?.sendPosition(newLocation) }
        }
        call.onMuteChanged = { [weak self] muted in
            Task { @MainActor in self?.applyMute(muted) }
        }
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.route = AudioSessionManager.routeDescription() }
        }
    }

    var estimatedCostUSD: Double { billedSeconds / 60 * Self.pricePerMinuteUSD }

    // MARK: - Public actions

    func start() async {
        guard phase == .idle else { return }
        guard settings.isConfigured else {
            status = "Imposta indirizzo del backend e token (icona ingranaggio)"
            return
        }
        guard await AVAudioApplication.requestRecordPermission() else {
            status = "Permesso microfono negato: Impostazioni → Raggio → Microfono"
            return
        }

        phase = .connecting
        status = "Avvio della chiamata…"
        lines = []
        billedSeconds = 0
        startLatency = nil
        sessionClosed = false
        isMuted = false
        lastSpeaker = nil
        requestedAt = Date()
        lastSentLocation = nil
        sessionId = nil
        startedAt = nil
        idleWarnedAt = nil
        vpsBusy = false
        delegating = false
        lastDelegationEnd = nil
        handledTasks = []
        record = ConversationRecord(id: UUID(), startedAt: Date(), billedSeconds: 0, lines: [])
        // In parallel with the call setup: the position goes with the session request.
        startLocation = Task { await location.current() }
        do {
            try await call.startCall()
        } catch {
            fail("CallKit: \(error.localizedDescription)")
        }
    }

    func stop(reason: String = "close_requested") async {
        guard phase == .connecting || phase == .active else { return }
        phase = .stopping
        status = "Chiusura…"
        limitsTimer?.invalidate()
        limitsTimer = nil
        vpsPoll?.cancel()
        vpsPoll = nil
        location.stopUpdates()

        if let realtime, realtime.isDataChannelOpen, !sessionClosed {
            realtime.send(.close)
            await waitForSessionClosed()
        }
        realtime?.disconnect()
        realtime = nil
        await call.endCall()
        phase = .idle
        status = "Chiusa (\(Self.describe(reason)))"
        finishRecord(reason: reason)
    }

    func toggleMute() async {
        guard phase == .active else { return }
        await call.setMuted(!isMuted)
    }

    // MARK: - Connection

    private func connect() async {
        guard phase == .connecting, let backend = settings.backendClient() else { return }
        status = "Connessione a GPT-Live…"

        let service = RealtimeService()
        service.onEvent = { [weak self] event in
            MainActor.assumeIsolated { self?.handle(event) }
        }
        service.onConnectionStateChange = { [weak self] state in
            MainActor.assumeIsolated {
                if state == .failed { Task { await self?.stop(reason: "connection_lost") } }
            }
        }
        realtime = service

        do {
            let position = await startLocation?.value
            if let position { lastSentLocation = (position, Date()) }
            sessionId = try await service.connect(backend: backend, voice: settings.voice, location: position)
            if phase == .connecting { status = "In attesa di GPT-Live…" }
        } catch {
            fail(error.localizedDescription)
        }
    }

    private func handle(_ event: LiveEvent) {
        switch event {
        case .started:
            phase = .active
            startedAt = Date()
            lastActivity = Date()
            startLatency = requestedAt.map { Date().timeIntervalSince($0) }
            status = "In ascolto: parla pure"
            call.reportConnected()
            startLimitsTimer()
            location.startUpdates()
            startVpsPolling()
        case .inputTranscript(let text):
            idleWarnedAt = nil
            append(text, from: .user)
            if phase == .active, let line = lines.last, line.speaker == .user, VoiceCommands.isStop(line.text) {
                Task { await stop(reason: "voice_command") }
            }
        case .outputTranscript(let text):
            append(text, from: .assistant)
        case .usage(let seconds):
            billedSeconds = seconds
        case .closed(let reason, let seconds):
            if let seconds { billedSeconds = seconds }
            sessionClosed = true
            resumeClosedWaiter()
            if phase == .connecting || phase == .active {
                Task { await stop(reason: reason ?? "closed") }
            }
        case .error(let message):
            status = "Errore GPT-Live: \(message)"
        case .delegationStarted:
            lastActivity = Date()
            idleWarnedAt = nil
            delegating = true
            status = "Sto cercando…"
        case .delegationFinished:
            lastActivity = Date()
            delegating = false
            lastDelegationEnd = Date()
            if phase == .active { status = listeningStatus }
        case .other:
            break
        }
    }

    private func append(_ text: String, from speaker: Speaker) {
        guard !text.isEmpty else { return }
        let now = Date()
        // After the idle warning the assistant's own words must not keep the conversation open.
        if speaker == .user || idleWarnedAt == nil { lastActivity = now }
        if lastSpeaker == speaker, now.timeIntervalSince(lastDeltaAt) < Self.newLineGapSeconds, !lines.isEmpty {
            lines[lines.count - 1].text += text
            if let last = record?.lines.indices.last { record?.lines[last].text += text }
        } else {
            lines.append(Line(speaker: speaker, text: text))
            record?.lines.append(.init(speaker: speaker == .user ? "user" : "assistant", text: text))
        }
        lastSpeaker = speaker
        lastDeltaAt = now
        // Saved as it goes (at most every few seconds), so a crash or a dropped call keeps it.
        if let record, now.timeIntervalSince(lastSavedAt) > 3 {
            history.save(record)
            lastSavedAt = now
        }
    }

    /// Tells GPT-Live where the user is now, after a move (LocationService.distanceFilter).
    private func sendPosition(_ newLocation: CLLocation) {
        guard phase == .active, let backend = settings.backendClient() else { return }
        if let last = lastSentLocation, Date().timeIntervalSince(last.at) < Self.positionUpdateInterval { return }
        lastSentLocation = (newLocation, Date())
        Task {
            guard let place = try? await backend.place(newLocation), phase == .active,
                  let realtime, realtime.isDataChannelOpen else { return }
            let address = place.address.map { "\($0) " } ?? ""
            realtime.send(.thinking("The user's position is now \(address)(lat \(place.lat), lon \(place.lon))."))
        }
    }

    private func applyMute(_ muted: Bool) {
        isMuted = muted
        realtime?.setMuted(muted)
        if phase == .active { status = muted ? "Microfono silenziato" : "In ascolto: parla pure" }
    }

    // MARK: - Limits

    private func startLimitsTimer() {
        limitsTimer?.invalidate()
        limitsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkLimits() }
        }
    }

    private func checkLimits() {
        guard phase == .active, let startedAt else { return }
        let now = Date()
        // Nobody speaks while the VPS works, a delegation runs or the microphone is muted: not silence.
        if vpsBusy || delegating || isMuted {
            lastActivity = now
            idleWarnedAt = nil
        }
        if let idleWarnedAt, now.timeIntervalSince(idleWarnedAt) >= Self.idleGraceSeconds {
            Task { await stop(reason: "idle") }
        } else if now.timeIntervalSince(startedAt) > Double(settings.maxMinutes) * 60 {
            Task { await stop(reason: "max_duration") }
        } else if idleWarnedAt == nil,
                  now.timeIntervalSince(lastActivity) >= Double(settings.idleSeconds) - Self.idleWarningSeconds {
            idleWarnedAt = now
            realtime?.send(.say("Tell the user, in one short Italian sentence, that you will close the conversation in a few seconds because nobody is speaking, unless they say something."))
        }
    }

    // MARK: - VPS tasks

    private var listeningStatus: String {
        if vpsBusy { return "Il VPS sta lavorando…" }
        return isMuted ? "Microfono silenziato" : "In ascolto: parla pure"
    }

    private func startVpsPolling() {
        guard let backend = settings.backendClient(), let since = requestedAt else { return }
        vpsPoll?.cancel()
        vpsPoll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.vpsPollSeconds))
                guard !Task.isCancelled else { return }
                do {
                    guard let tasks = try await backend.vpsTasks(since: since) else { return } // no VPS
                    self?.vpsTasksUpdated(tasks)
                } catch {
                    // Try again at the next poll.
                }
            }
        }
    }

    private func vpsTasksUpdated(_ tasks: [BackendClient.VpsTask]) {
        guard phase == .active else { return }
        let busy = tasks.contains { $0.isPending }
        if busy != vpsBusy {
            vpsBusy = busy
            if !delegating { status = listeningStatus }
        }
        for task in tasks where task.isFinished && !handledTasks.contains(task.id) {
            if delegating { continue } // the running delegation may still pick it up
            handledTasks.insert(task.id)
            // Finished after the last delegation ended: the model only heard "still running".
            guard let lastDelegationEnd, let finished = task.finishedDate, finished > lastDelegationEnd else { continue }
            realtime?.send(.say(Self.announcement(task)))
            lastActivity = Date()
            idleWarnedAt = nil
        }
    }

    private static func announcement(_ task: BackendClient.VpsTask) -> String {
        let result = task.result ?? ""
        let outcome = task.status == "failed" ? "it failed: \(result.isEmpty ? "unknown error" : result)" : result
        return "The VPS task the user asked for earlier has finished. Request: \"\(task.instruction.prefix(200))\". "
            + "Outcome: \(String(outcome.prefix(1200)).trimmingCharacters(in: CharacterSet(charactersIn: ". \n"))). Tell the user the outcome now, briefly, in Italian."
    }

    // MARK: - History

    /// Saves the conversation with its closing reason and reports the reason to the backend.
    private func finishRecord(reason: String) {
        if var record, startedAt != nil || !record.lines.isEmpty {
            record.endedAt = Date()
            record.reason = reason
            record.billedSeconds = billedSeconds
            history.save(record)
        }
        record = nil
        if let backend = settings.backendClient(), startedAt != nil || sessionId != nil {
            let id = sessionId, seconds = billedSeconds
            Task { await backend.endSession(sessionId: id, reason: reason, seconds: seconds) }
        }
    }

    // MARK: - Helpers

    private func waitForSessionClosed() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            closedContinuation = continuation
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(Self.closeTimeoutSeconds * 1_000_000_000))
                self?.resumeClosedWaiter()
            }
        }
    }

    private func resumeClosedWaiter() {
        closedContinuation?.resume()
        closedContinuation = nil
    }

    private func fail(_ message: String) {
        Task {
            await stop(reason: "error")
            status = "Errore: \(message)"
        }
        if phase == .idle { status = "Errore: \(message)" }
    }

    /// Closing reason in Italian, for the status line and the history.
    static func describe(_ reason: String) -> String {
        switch reason {
        case "close_requested": return "chiusa da te"
        case "call_ended": return "chiamata terminata"
        case "voice_command": return "comando vocale"
        case "idle": return "silenzio"
        case "max_duration": return "durata massima raggiunta"
        case "expired": return "sessione scaduta"
        case "content": return "filtro di sicurezza"
        case "remote_hangup": return "chiusa da OpenAI"
        case "connection_lost": return "connessione persa"
        case "error": return "errore"
        case "closed": return "chiusa da GPT-Live"
        default: return reason
        }
    }
}
