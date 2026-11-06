import AVFoundation
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

    let settings = AppSettings()
    private(set) var phase: Phase = .idle
    private(set) var status = "Pronto"
    private(set) var lines: [Line] = []
    private(set) var isMuted = false
    private(set) var billedSeconds: Double = 0
    private(set) var startLatency: TimeInterval?
    private(set) var route = AudioSessionManager.routeDescription()

    private let call = CallService()
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

    private init() {
        AudioSessionManager.prepare()
        call.onCallStarted = { [weak self] in
            Task { @MainActor in await self?.connect() }
        }
        call.onCallEnded = { [weak self] in
            Task { @MainActor in await self?.stop(reason: "call_ended") }
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
            status = "Permesso microfono negato: Impostazioni → RayGPT → Microfono"
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

        if let realtime, realtime.isDataChannelOpen, !sessionClosed {
            realtime.send(.close)
            await waitForSessionClosed()
        }
        realtime?.disconnect()
        realtime = nil
        await call.endCall()
        phase = .idle
        status = "Chiusa (\(Self.describe(reason)))"
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
            _ = try await service.connect(backend: backend, voice: settings.voice)
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
        case .inputTranscript(let text):
            append(text, from: .user)
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
        case .other:
            break
        }
    }

    private func append(_ text: String, from speaker: Speaker) {
        guard !text.isEmpty else { return }
        let now = Date()
        lastActivity = now
        if lastSpeaker == speaker, now.timeIntervalSince(lastDeltaAt) < Self.newLineGapSeconds, !lines.isEmpty {
            lines[lines.count - 1].text += text
        } else {
            lines.append(Line(speaker: speaker, text: text))
        }
        lastSpeaker = speaker
        lastDeltaAt = now
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
        if !isMuted, now.timeIntervalSince(lastActivity) > Double(settings.idleSeconds) {
            Task { await stop(reason: "idle") }
        } else if now.timeIntervalSince(startedAt) > Double(settings.maxMinutes) * 60 {
            Task { await stop(reason: "max_duration") }
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

    private static func describe(_ reason: String) -> String {
        switch reason {
        case "close_requested": return "chiusa da te"
        case "call_ended": return "chiamata terminata"
        case "idle": return "silenzio prolungato"
        case "max_duration": return "durata massima raggiunta"
        case "expired": return "sessione scaduta"
        case "content": return "filtro di sicurezza"
        case "remote_hangup": return "chiusa da OpenAI"
        case "connection_lost": return "connessione persa"
        case "error": return "errore"
        default: return reason
        }
    }
}
