import Foundation

/// GPT-Live server events received on the `oai-events` data channel (docs/PROJECT.md §3.6).
enum LiveEvent {
    case started(sessionId: String)
    case inputTranscript(String)
    case outputTranscript(String)
    case usage(seconds: Double)
    case closed(reason: String?, seconds: Double?)
    case error(String)
    /// GPT-Live handed a request to the backend model (web search).
    case delegationStarted
    /// The delegated backend work finished.
    case delegationFinished
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
        case "session.delegation.created":
            self = .delegationStarted
        case "response.event":
            let nested = (object["event"] as? [String: Any])?["type"] as? String ?? ""
            let finished = ["response.completed", "response.failed", "response.incomplete"].contains(nested)
            self = finished ? .delegationFinished : .other(type: "response.event")
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
    /// Context for later replies, not spoken and not interrupting (e.g. the user's new position).
    case thinking(String)

    var data: Data {
        let object: [String: Any]
        switch self {
        case .close: object = ["type": "session.close"]
        case .mute: object = ["type": "session.input_audio.mute"]
        case .unmute: object = ["type": "session.input_audio.unmute"]
        case .thinking(let content):
            object = ["type": "session.thinking.append", "event_id": "ctx_\(UUID().uuidString)",
                      "delegation_id": NSNull(), "content": content]
        }
        return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }
}
