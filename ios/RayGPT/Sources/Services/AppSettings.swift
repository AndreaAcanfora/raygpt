import Foundation
import Observation
import Security

/// User settings. The backend token lives in the Keychain, the rest in UserDefaults.
@MainActor
@Observable
final class AppSettings {
    /// GPT-Live voices, kept in sync with backend/src/voices.ts.
    static let voices = [
        "alloy", "ash", "ballad", "beacon", "bossa", "brise", "cedar", "cinder",
        "coral", "delta", "echo", "flitz", "gleam", "harema", "juni", "marin",
        "meridian", "nira", "noeul", "nuri", "quartz", "ripple", "sage", "shida",
        "shimmer", "sillage", "stone", "tempo", "verse", "vesper", "willow",
    ]

    private enum Key {
        static let backendURL = "backendURL"
        static let voice = "voice"
        static let idleSeconds = "idleSeconds"
        static let maxMinutes = "maxMinutes"
        static let tokenAccount = "appToken"
    }

    private let defaults = UserDefaults.standard

    var backendURL: String { didSet { defaults.set(backendURL, forKey: Key.backendURL) } }
    var token: String { didSet { Keychain.save(token, account: Key.tokenAccount) } }
    var voice: String { didSet { defaults.set(voice, forKey: Key.voice) } }
    /// Close the conversation after this many seconds without anyone speaking.
    var idleSeconds: Int { didSet { defaults.set(idleSeconds, forKey: Key.idleSeconds) } }
    /// Hard limit on a single conversation.
    var maxMinutes: Int { didSet { defaults.set(maxMinutes, forKey: Key.maxMinutes) } }

    init() {
        backendURL = defaults.string(forKey: Key.backendURL) ?? ""
        token = Keychain.load(account: Key.tokenAccount) ?? ""
        voice = defaults.string(forKey: Key.voice) ?? "marin"
        idleSeconds = defaults.object(forKey: Key.idleSeconds) as? Int ?? 120
        maxMinutes = defaults.object(forKey: Key.maxMinutes) as? Int ?? 20
    }

    var isConfigured: Bool { backendClient() != nil }

    func backendClient() -> BackendClient? {
        let trimmed = backendURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let scheme = url.scheme, ["https", "http"].contains(scheme),
              url.host != nil, token.count >= 32
        else { return nil }
        return BackendClient(baseURL: url, token: token)
    }
}

enum Keychain {
    private static let service = "RayGPT"

    static func save(_ value: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard !value.isEmpty else { return }
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
