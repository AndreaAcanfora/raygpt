import CoreLocation
import Foundation

/// Talks to the RayGPT backend (backend/README.md). The OpenAI key never reaches the app:
/// the backend forwards the SDP offer to GPT-Live and returns the answer.
struct BackendClient {
    let baseURL: URL
    let token: String

    struct Session: Decodable {
        let sessionId: String
        let sdp: String
    }

    struct Place: Decodable {
        let address: String?
        let lat: Double
        let lon: Double
    }

    /// A task of the VPS agent (GET /api/vps/tasks).
    struct VpsTask: Decodable {
        let id: String
        let status: String
        let instruction: String
        let result: String?
        let createdAt: String
        let finishedAt: String?

        var isFinished: Bool { status == "done" || status == "failed" }
        /// The gateway's timestamps carry milliseconds ("2026-11-08T08:40:28.079Z").
        var finishedDate: Date? {
            finishedAt.flatMap { try? Date($0, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) }
        }
        var isPending: Bool { status == "queued" || status == "running" }
    }

    private struct VpsTasks: Decodable {
        let tasks: [VpsTask]
    }

    private struct ErrorBody: Decodable {
        let error: String
        let message: String?
    }

    func createSession(offerSdp: String, voice: String, location: CLLocation? = nil) async throws -> Session {
        var body: [String: Any] = ["sdp": offerSdp, "voice": voice]
        if let location { body["location"] = Self.json(location) }
        return try await post("api/session", body: body, timeout: 20)
    }

    /// Street address of a new position, to tell GPT-Live where the user is now.
    func place(_ location: CLLocation) async throws -> Place {
        try await post("api/place", body: ["location": Self.json(location)], timeout: 8)
    }

    /// Tasks the VPS agent got since `since`, newest first. Nil when the backend has no VPS.
    func vpsTasks(since: Date) async throws -> [VpsTask]? {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/vps/tasks"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "since", value: since.ISO8601Format())]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 8
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { return nil }
        guard status == 200 else { throw BackendError(status: status, code: nil, message: nil) }
        return try JSONDecoder().decode(VpsTasks.self, from: data).tasks
    }

    /// Tells the backend why a conversation ended, for its logs. Failures are ignored.
    func endSession(sessionId: String?, reason: String, seconds: Double) async {
        var body: [String: Any] = ["reason": reason, "seconds": seconds]
        if let sessionId { body["sessionId"] = sessionId }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/session/end"))
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: request)
    }

    private static func json(_ location: CLLocation) -> [String: Double] {
        ["lat": location.coordinate.latitude, "lon": location.coordinate.longitude, "accuracy": location.horizontalAccuracy]
    }

    private func post<Response: Decodable>(_ path: String, body: [String: Any], timeout: TimeInterval) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw BackendError(status: status, code: body?.error, message: body?.message)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

struct BackendError: LocalizedError {
    let status: Int
    let code: String?
    let message: String?

    var errorDescription: String? {
        switch code {
        case "unauthorized": return "Token del backend non valido"
        case "daily_session_limit": return "Limite giornaliero di sessioni raggiunto"
        case "invalid_voice": return "Voce non valida"
        case "invalid_location": return "Posizione non valida"
        case "openai_error": return "Errore OpenAI: \(message ?? "HTTP \(status)")"
        default: return message ?? "Errore del backend (HTTP \(status))"
        }
    }
}
