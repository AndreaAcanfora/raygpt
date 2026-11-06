import Foundation

/// GPT-Live server events received on the `oai-events` data channel (docs/PROJECT.md §3.6).
enum LiveEvent {
    case started(sessionId: String)
    case inputTranscript(String)
    case outputTranscript(String)
    case usage(seconds: Double)
    case closed(reason: String?, seconds: Double?)
    case error(String)
    case other(type: String)

    init?(data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String
        else { return nil }

        switch type {
        case "session.started":
            let session = object["session"] as? [String: Any]
            self = .started(sessionId: session?["id"] as? String ?? "")
        case "session.input_transcript.delta":
            self = .inputTranscript(object["delta"] as? String ?? "")
        case "session.output_transcript.delta":
            self = .outputTranscript(object["delta"] as? String ?? "")
        case "session.usage.updated":
            let usage = object["usage"] as? [String: Any]
            self = .usage(seconds: (usage?["seconds"] as? NSNumber)?.doubleValue ?? 0)
        case "session.closed":
            let usage = object["usage"] as? [String: Any]
            self = .closed(reason: object["reason"] as? String, seconds: (usage?["seconds"] as? NSNumber)?.doubleValue)
        case "error":
            let error = object["error"] as? [String: Any]
            self = .error(error?["message"] as? String ?? "errore sconosciuto")
        default:
            self = .other(type: type)
        }
    }
}

/// Client events sent on the data channel.
enum ClientEvent {
    case close
    case mute
    case unmute

    var data: Data {
        let type: String
        switch self {
        case .close: type = "session.close"
        case .mute: type = "session.input_audio.mute"
        case .unmute: type = "session.input_audio.unmute"
        }
        return Data("{\"type\":\"\(type)\"}".utf8)
    }
}
