import AVFoundation
import WebRTC

/// Audio session setup for WebRTC under CallKit (docs/PROJECT.md §6).
///
/// WebRTC runs in manual-audio mode: its audio unit starts only when CallKit activates the
/// audio session, which is what keeps the conversation alive with the screen locked.
/// `.allowBluetoothHFP` lets the glasses act as headset (microphone and speakers).
enum AudioSessionManager {
    static func prepare() {
        let configuration = RTCAudioSessionConfiguration.webRTC()
        configuration.category = AVAudioSession.Category.playAndRecord.rawValue
        configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
        configuration.categoryOptions = [.allowBluetoothHFP]
        RTCAudioSessionConfiguration.setWebRTC(configuration)

        let session = RTCAudioSession.sharedInstance()
        session.useManualAudio = true
        session.isAudioEnabled = false
    }

    /// Applies category, mode and options before CallKit activates the session.
    static func applyConfiguration() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        try? session.setConfiguration(RTCAudioSessionConfiguration.webRTC())
    }

    static func didActivate(_ audioSession: AVAudioSession) {
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidActivate(audioSession)
        session.isAudioEnabled = true
    }

    static func didDeactivate(_ audioSession: AVAudioSession) {
        let session = RTCAudioSession.sharedInstance()
        session.audioSessionDidDeactivate(audioSession)
        session.isAudioEnabled = false
    }

    /// Human-readable current route, e.g. "Ray-Ban Meta [BluetoothHFP] → Ray-Ban Meta [BluetoothHFP]".
    static func routeDescription() -> String {
        let route = AVAudioSession.sharedInstance().currentRoute
        let describe: ([AVAudioSessionPortDescription]) -> String = { ports in
            ports.isEmpty ? "—" : ports.map { "\($0.portName) [\($0.portType.rawValue)]" }.joined(separator: ", ")
        }
        return "\(describe(route.inputs)) → \(describe(route.outputs))"
    }
}
