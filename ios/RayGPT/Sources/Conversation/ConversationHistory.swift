import Foundation
import Observation

/// One past conversation, as shown in "Conversazioni".
struct ConversationRecord: Codable, Identifiable {
    struct Line: Codable {
        /// "user" or "assistant".
        let speaker: String
        var text: String
    }

    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    /// Why it closed (ConversationController reasons); nil while it runs or if the app died.
    var reason: String?
    var billedSeconds: Double
    var lines: [Line]
}

/// Past conversations kept on the phone (the last `limit`), in Application Support. A running
/// conversation is saved as it goes, so a crash or a dropped call does not lose it.
@MainActor
@Observable
final class ConversationHistory {
    static let shared = ConversationHistory()
    private static let limit = 50

    private(set) var records: [ConversationRecord] = []
    private let url: URL

    private init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        url = folder.appendingPathComponent("conversations.json")
        if let data = try? Data(contentsOf: url) {
            records = (try? Self.decoder.decode([ConversationRecord].self, from: data)) ?? []
        }
    }

    /// Adds the record, or replaces the saved copy of the same conversation.
    func save(_ record: ConversationRecord) {
        records.removeAll { $0.id == record.id }
        records.insert(record, at: 0)
        if records.count > Self.limit { records.removeLast(records.count - Self.limit) }
        write()
    }

    func deleteAll() {
        records = []
        write()
    }

    private func write() {
        guard let data = try? Self.encoder.encode(records) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
