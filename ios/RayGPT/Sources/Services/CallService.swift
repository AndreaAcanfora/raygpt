import AVFoundation
import CallKit

/// Each conversation is an outgoing CallKit call to "RayGPT" (decision D-002): iOS keeps the
/// audio running with the screen locked, shows the call on the lock screen and routes audio to
/// the Bluetooth headset. Ending the call from the system UI (or the headset) ends the conversation.
final class CallService: NSObject {
    /// CallKit accepted the outgoing call: the conversation can connect.
    var onCallStarted: (() -> Void)?
    /// The call was ended outside the app (lock screen, headset, system reset).
    var onCallEnded: (() -> Void)?
    var onMuteChanged: ((Bool) -> Void)?

    private let provider: CXProvider
    private let callController = CXCallController()
    private(set) var currentCall: UUID?

    override init() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = false
        provider = CXProvider(configuration: configuration)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func startCall() async throws {
        let uuid = UUID()
        currentCall = uuid
        let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: "Raggio"))
        action.isVideo = false
        do {
            try await callController.request(CXTransaction(action: action))
        } catch {
            currentCall = nil
            throw error
        }
    }

    func reportConnected() {
        guard let currentCall else { return }
        provider.reportOutgoingCall(with: currentCall, connectedAt: nil)
    }

    func setMuted(_ muted: Bool) async {
        guard let currentCall else { return }
        try? await callController.request(CXTransaction(action: CXSetMutedCallAction(call: currentCall, muted: muted)))
    }

    /// Ends the call from the app side.
    func endCall() async {
        guard let call = currentCall else { return }
        currentCall = nil
        do {
            try await callController.request(CXTransaction(action: CXEndCallAction(call: call)))
        } catch {
            provider.reportCall(with: call, endedAt: nil, reason: .remoteEnded)
        }
    }
}

extension CallService: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        currentCall = nil
        onCallEnded?()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        AudioSessionManager.applyConfiguration()
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
        action.fulfill()
        onCallStarted?()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        action.fulfill()
        // currentCall is nil when the app itself asked to end the call.
        if currentCall == action.callUUID {
            currentCall = nil
            onCallEnded?()
        }
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        action.fulfill()
        onMuteChanged?(action.isMuted)
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        AudioSessionManager.didActivate(audioSession)
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        AudioSessionManager.didDeactivate(audioSession)
    }
}
