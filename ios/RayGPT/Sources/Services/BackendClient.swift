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

    private struct ErrorBody: Decodable {
        let error: String
        let message: String?
    }

    func createSession(offerSdp: String, voice: String) async throws -> Session {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/session"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["sdp": offerSdp, "voice": voice])

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw BackendError(status: status, code: body?.error, message: body?.message)
        }
        return try JSONDecoder().decode(Session.self, from: data)
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
        case "openai_error": return "Errore OpenAI: \(message ?? "HTTP \(status)")"
        default: return message ?? "Errore del backend (HTTP \(status))"
        }
    }
}
