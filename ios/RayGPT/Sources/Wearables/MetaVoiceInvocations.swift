import Foundation
import MWDATCore
import Observation

/// "Hey Meta, start RayGPT" through Meta's Device Access Toolkit (Voice Invocations, experimental).
///
/// Flow (docs/PROJECT.md §4.7): the app registers with Meta AI once; afterwards it keeps a
/// VoiceInvocationsStream open on the connected glasses. When the wearer says the spoken app name
/// configured in the Wearables Developer Center, Meta AI launches or foregrounds RayGPT and sends a
/// LaunchApp invocation, which must be acknowledged exactly once.
@MainActor
@Observable
final class MetaVoiceInvocations {
    static let shared = MetaVoiceInvocations()

    enum Status: Equatable {
        case notConfigured(String)
        case notRegistered
        case registering
        case waitingForGlasses
        case listening
        case failed(String)

        var description: String {
            switch self {
            case .notConfigured(let reason): return "Toolkit Meta non configurato: \(reason)"
            case .notRegistered: return "RayGPT non è registrato in Meta AI"
            case .registering: return "Registrazione in corso…"
            case .waitingForGlasses: return "In attesa degli occhiali"
            case .listening: return "In ascolto di “Ehi Meta, avvia Raggio”"
            case .failed(let reason): return "Errore: \(reason)"
            }
        }
    }

    private(set) var status: Status = .notRegistered
    private(set) var lastInvocation: Date?

    /// Called for every acknowledged "Hey Meta, start RayGPT".
    var onLaunch: (() -> Void)?

    private var configured = false
    private var stream: VoiceInvocationsStream?
    private var listeningOn: DeviceIdentifier?
    private let tokens = ListenerTokenBag()
    private var retryTask: Task<Void, Never>?

    private init() {}

    /// Call once at app launch.
    func configure() {
        guard !configured else { return }
        do {
            try Wearables.configure()
            configured = true
        } catch {
            status = .notConfigured(error.localizedDescription)
            return
        }
        Task { [weak self] in
            for await state in Wearables.shared.registrationStateStream() {
                self?.registrationChanged(state)
            }
        }
        Task { [weak self] in
            for await _ in Wearables.shared.devicesStream() {
                self?.startListeningIfPossible()
            }
        }
        registrationChanged(Wearables.shared.registrationState)
    }

    /// Opens Meta AI so the user can approve RayGPT. Meta AI calls back through `raygpt://`.
    func register() async {
        guard configured else { return }
        status = .registering
        do {
            try await Wearables.shared.startRegistration()
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    /// Opens Meta AI to remove RayGPT's registration, e.g. after a new Developer Center version.
    func unregister() async {
        guard configured else { return }
        do {
            try await Wearables.shared.startUnregistration()
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    /// Forwards Meta AI callbacks (registration) to the SDK.
    func handle(url: URL) {
        guard configured,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.contains(where: { $0.name == "metaWearablesAction" }) == true
        else { return }
        Task { [weak self] in
            do {
                _ = try await Wearables.shared.handleUrl(url)
            } catch {
                self?.status = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: - Private

    private func registrationChanged(_ state: RegistrationState) {
        if case .registered = state {
            startListeningIfPossible()
        } else if case .registering = state {
            status = .registering
        } else {
            stopListening()
            status = .notRegistered
        }
    }

    private func startListeningIfPossible() {
        guard configured, case .registered = Wearables.shared.registrationState else { return }
        guard let device = Wearables.shared.devices.first else {
            stopListening()
            status = .waitingForGlasses
            return
        }
        guard device != listeningOn else { return }

        do {
            let stream = try self.stream ?? makeStream()
            self.stream = stream
            if listeningOn != nil { stream.stop() }
            try stream.start(deviceIdentifier: device)
            listeningOn = device
            status = .listening
        } catch {
            listeningOn = nil
            status = .failed(error.localizedDescription)
            scheduleRetry()
        }
    }

    private func makeStream() throws -> VoiceInvocationsStream {
        let stream = try VoiceInvocationsStream(wearables: Wearables.shared)
        stream.invocationsPublisher.listen { [weak self] invocation in
            Task { @MainActor in await self?.answer(invocation) }
        }.store(in: tokens)
        stream.errorPublisher.listen { [weak self] error in
            Task { @MainActor in
                self?.status = .failed(error.localizedDescription)
                self?.listeningOn = nil
                self?.scheduleRetry()
            }
        }.store(in: tokens)
        return stream
    }

    private func answer(_ invocation: any VoiceInvocation) async {
        guard let launch = invocation as? LaunchApp else { return }
        // Meta AI waits for this answer and reports the app as not responding without it.
        _ = await launch.responseHandle.sendSuccess(actionOutput: nil)
        lastInvocation = Date()
        onLaunch?()
    }

    private func stopListening() {
        retryTask?.cancel()
        if listeningOn != nil { stream?.stop() }
        listeningOn = nil
    }

    /// Reopens the channel after a drop, a few seconds later.
    private func scheduleRetry() {
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            self?.startListeningIfPossible()
        }
    }
}
