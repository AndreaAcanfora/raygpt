import CoreLocation
import Foundation
import WebRTC

/// WebRTC connection to GPT-Live (docs/PROJECT.md §3.3): microphone track plus the `oai-events`
/// data channel, SDP offer sent through the backend, SDP answer applied. Remote audio is played
/// by WebRTC's audio unit on the current route (the glasses, when connected over HFP).
///
/// WebRTC calls the delegates on its own threads: every callback is forwarded to the main queue.
final class RealtimeService: NSObject {
    enum RealtimeError: LocalizedError {
        case peerConnection
        case dataChannel
        case offer
        case missingLocalDescription

        var errorDescription: String? {
            switch self {
            case .peerConnection: return "Impossibile creare la connessione WebRTC"
            case .dataChannel: return "Impossibile creare il canale eventi"
            case .offer: return "Impossibile creare l’offerta SDP"
            case .missingLocalDescription: return "Offerta SDP mancante"
            }
        }
    }

    /// Called on the main queue for every GPT-Live event.
    var onEvent: ((LiveEvent) -> Void)?
    /// Called on the main queue when the peer connection state changes.
    var onConnectionStateChange: ((RTCPeerConnectionState) -> Void)?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()
    private static let noConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
    private static let iceGatheringTimeout: TimeInterval = 10

    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private var microphoneTrack: RTCAudioTrack?

    var isDataChannelOpen: Bool { dataChannel?.readyState == .open }

    /// Opens the session and returns its GPT-Live id. Events start arriving with `session.started`.
    func connect(backend: BackendClient, voice: String, location: CLLocation? = nil) async throws -> String {
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.iceServers = []

        guard let peerConnection = Self.factory.peerConnection(
            with: configuration, constraints: Self.noConstraints, delegate: self
        ) else { throw RealtimeError.peerConnection }
        self.peerConnection = peerConnection

        let source = Self.factory.audioSource(with: Self.noConstraints)
        let track = Self.factory.audioTrack(with: source, trackId: "raygpt-microphone")
        peerConnection.add(track, streamIds: ["raygpt"])
        microphoneTrack = track

        // The data channel must exist before the offer is created.
        guard let channel = peerConnection.dataChannel(forLabel: "oai-events", configuration: RTCDataChannelConfiguration())
        else { throw RealtimeError.dataChannel }
        channel.delegate = self
        dataChannel = channel

        let offer = try await createOffer(peerConnection)
        try await setLocalDescription(offer, on: peerConnection)
        await waitForIceGathering(peerConnection)
        guard let offerSdp = peerConnection.localDescription?.sdp else { throw RealtimeError.missingLocalDescription }

        let session = try await backend.createSession(offerSdp: offerSdp, voice: voice, location: location)
        try await setRemoteDescription(RTCSessionDescription(type: .answer, sdp: session.sdp), on: peerConnection)
        return session.sessionId
    }

    func send(_ event: ClientEvent) {
        _ = dataChannel?.sendData(RTCDataBuffer(data: event.data, isBinary: false))
    }

    /// Mutes the microphone locally and tells GPT-Live, which keeps the session open.
    func setMuted(_ muted: Bool) {
        microphoneTrack?.isEnabled = !muted
        send(muted ? .mute : .unmute)
    }

    func disconnect() {
        dataChannel?.delegate = nil
        dataChannel?.close()
        dataChannel = nil
        peerConnection?.close()
        peerConnection = nil
        microphoneTrack = nil
    }

    // MARK: - Async wrappers

    private func createOffer(_ peerConnection: RTCPeerConnection) async throws -> RTCSessionDescription {
        try await withCheckedThrowingContinuation { continuation in
            peerConnection.offer(for: Self.noConstraints) { description, error in
                if let description {
                    continuation.resume(returning: description)
                } else {
                    continuation.resume(throwing: error ?? RealtimeError.offer)
                }
            }
        }
    }

    private func setLocalDescription(_ description: RTCSessionDescription, on peerConnection: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setLocalDescription(description) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    private func setRemoteDescription(_ description: RTCSessionDescription, on peerConnection: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setRemoteDescription(description) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    /// As in OpenAI's WebRTC guide: send the offer once ICE gathering is complete, or after a timeout.
    private func waitForIceGathering(_ peerConnection: RTCPeerConnection) async {
        let deadline = Date().addingTimeInterval(Self.iceGatheringTimeout)
        while peerConnection.iceGatheringState != .complete, Date() < deadline {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    private func onMain(_ work: @escaping () -> Void) {
        DispatchQueue.main.async(execute: work)
    }
}

// MARK: - RTCPeerConnectionDelegate

extension RealtimeService: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        onMain { [weak self] in self?.onConnectionStateChange?(newState) }
    }
}

// MARK: - RTCDataChannelDelegate

extension RealtimeService: RTCDataChannelDelegate {
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {}

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard let event = LiveEvent(data: buffer.data) else { return }
        onMain { [weak self] in self?.onEvent?(event) }
    }
}
