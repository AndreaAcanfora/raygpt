import AVFoundation
import Observation
import UIKit

@MainActor
@Observable
final class ProbeModel {
    enum Mode: String, CaseIterable, Identifiable {
        case voiceChat
        case standard
        case measurement

        var id: String { rawValue }

        var sessionMode: AVAudioSession.Mode {
            switch self {
            case .voiceChat: return .voiceChat
            case .standard: return .default
            case .measurement: return .measurement
            }
        }
    }

    var mode: Mode = .voiceChat
    var permission = "sconosciuto"
    var routeInputs = "—"
    var routeOutputs = "—"
    var availableInputs: [String] = []
    var details = ""
    var isRecording = false
    var isPlaying = false
    var hasRecording = false
    /// Input level from 0 (silence) to 1 (full scale), updated while recording.
    var level: Double = 0
    var log: [String] = []

    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var meterTimer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var recordingStartedAt: Date?
    private let recordingURL = FileManager.default.temporaryDirectory.appendingPathComponent("probe.caf")
    private let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()

    init() {
        observeSystemEvents()
        updatePermission()
        refresh()
        append("App avviata")
    }

    // MARK: - Session

    func requestPermission() async {
        let granted = await AVAudioApplication.requestRecordPermission()
        updatePermission()
        append("Permesso microfono: \(granted ? "concesso" : "negato")")
    }

    func configureSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: mode.sessionMode, options: [.allowBluetoothHFP])
            try session.setActive(true)
            append("Sessione attiva: playAndRecord, modo \(mode.rawValue), HFP consentito")
        } catch {
            append("Errore configurazione sessione: \(error.localizedDescription)")
        }
        refresh()
    }

    func preferGlassesInput() {
        let session = AVAudioSession.sharedInstance()
        guard let port = session.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) else {
            append("Nessun ingresso Bluetooth HFP disponibile: configurare la sessione con gli occhiali collegati")
            return
        }
        do {
            try session.setPreferredInput(port)
            append("Ingresso preferito: \(port.portName)")
        } catch {
            append("Errore setPreferredInput: \(error.localizedDescription)")
        }
        refresh()
    }

    func refresh() {
        let session = AVAudioSession.sharedInstance()
        routeInputs = describe(session.currentRoute.inputs)
        routeOutputs = describe(session.currentRoute.outputs)
        availableInputs = (session.availableInputs ?? []).map { "\($0.portName) [\($0.portType.rawValue)]" }
        details = [
            "sample rate \(Int(session.sampleRate)) Hz",
            "buffer \(milliseconds(session.ioBufferDuration))",
            "latenza ingresso \(milliseconds(session.inputLatency))",
            "latenza uscita \(milliseconds(session.outputLatency))",
            "canali ingresso \(session.inputNumberOfChannels)",
        ].joined(separator: " · ")
    }

    // MARK: - Recording and playback

    func startRecording() {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord { configureSession() }
        stopPlayback()

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: session.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        do {
            let recorder = try AVAudioRecorder(url: recordingURL, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else {
                append("La registrazione non è partita (record() = false)")
                return
            }
            self.recorder = recorder
            isRecording = true
            recordingStartedAt = Date()
            startMeter()
            append("Registrazione avviata. Ingresso: \(describe(session.currentRoute.inputs))")
        } catch {
            append("Errore registrazione: \(error.localizedDescription)")
        }
    }

    func stopRecording() {
        guard let recorder else { return }
        recorder.stop()
        self.recorder = nil
        isRecording = false
        hasRecording = true
        stopMeter()
        let seconds = recordingStartedAt.map { Date().timeIntervalSince($0) } ?? 0
        append(String(format: "Registrazione fermata: %.1f s", seconds))
    }

    func play() {
        guard hasRecording else { return }
        do {
            let player = try AVAudioPlayer(contentsOf: recordingURL)
            guard player.play() else {
                append("La riproduzione non è partita")
                return
            }
            self.player = player
            isPlaying = true
            append("Riproduzione su: \(describe(AVAudioSession.sharedInstance().currentRoute.outputs))")
            let duration = player.duration
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(duration))
                self?.isPlaying = false
            }
        } catch {
            append("Errore riproduzione: \(error.localizedDescription)")
        }
    }

    func stopPlayback() {
        player?.stop()
        player = nil
        isPlaying = false
    }

    // MARK: - Log

    func append(_ message: String) {
        log.insert("\(timeFormatter.string(from: Date())) \(message)", at: 0)
    }

    var logText: String {
        (["AudioRouteProbe — \(UIDevice.current.model) iOS \(UIDevice.current.systemVersion)"] + log.reversed())
            .joined(separator: "\n")
    }

    // MARK: - Private

    private func updatePermission() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: permission = "concesso"
        case .denied: permission = "negato (Impostazioni → Privacy → Microfono)"
        case .undetermined: permission = "da chiedere"
        @unknown default: permission = "sconosciuto"
        }
    }

    private func startMeter() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateMeter() }
        }
    }

    private func stopMeter() {
        meterTimer?.invalidate()
        meterTimer = nil
        level = 0
    }

    private func updateMeter() {
        guard let recorder else { return }
        recorder.updateMeters()
        let decibels = Double(recorder.averagePower(forChannel: 0))
        level = min(1, max(0, (decibels + 60) / 60))
    }

    private func observeSystemEvents() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] notification in
            let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            let reason = raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
            MainActor.assumeIsolated {
                self?.refresh()
                self?.append("Cambio route (\(Self.describe(reason))): in \(self?.routeInputs ?? "?"), out \(self?.routeOutputs ?? "?")")
            }
        })
        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let began = raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .began
            MainActor.assumeIsolated {
                self?.append(began ? "Interruzione iniziata (chiamata, Siri, altra app)" : "Interruzione terminata")
                if began { self?.stopRecording() }
            }
        })
        observers.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.append("Servizi audio di sistema riavviati") }
        })
        observers.append(center.addObserver(
            forName: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.append("iPhone bloccato") }
        })
        observers.append(center.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.append("iPhone sbloccato") }
        })
    }

    private func describe(_ ports: [AVAudioSessionPortDescription]) -> String {
        ports.isEmpty ? "—" : ports.map { "\($0.portName) [\($0.portType.rawValue)]" }.joined(separator: ", ")
    }

    private func milliseconds(_ seconds: TimeInterval) -> String {
        String(format: "%.1f ms", seconds * 1000)
    }

    private nonisolated static func describe(_ reason: AVAudioSession.RouteChangeReason?) -> String {
        switch reason {
        case .newDeviceAvailable: return "nuovo dispositivo"
        case .oldDeviceUnavailable: return "dispositivo scollegato"
        case .categoryChange: return "cambio categoria"
        case .override: return "override"
        case .wakeFromSleep: return "risveglio"
        case .noSuitableRouteForCategory: return "nessuna route adatta"
        case .routeConfigurationChange: return "configurazione route"
        default: return "altro"
        }
    }
}
