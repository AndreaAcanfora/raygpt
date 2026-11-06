import Foundation

/// Local voice commands recognized in the user's transcript, without involving the model.
enum VoiceCommands {
    /// "Stop RayGPT" / "Chiudi RayGPT" (also "ferma", "termina", "spegni", in either order).
    /// Transcripts spell the name in many ways ("Ray GPT", "rei gpt", "Ray gipiti"), so the text
    /// is folded to lowercase letters and digits first. Kept in sync with backend/public/client.js.
    private static let stopPattern = try! NSRegularExpression(
        pattern: "(stop+|chiudi|ferma|termina|spegni)r[aeiy]+(g|j)[ie]?(p|b)[ie]?t"
            + "|r[aeiy]+(g|j)[ie]?(p|b)[ie]?t(stop+|chiudi|ferma|termina|spegni)"
    )

    static func isStop(_ text: String) -> Bool {
        let folded = text
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "it_IT"))
            .lowercased()
            .filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
        let range = NSRange(folded.startIndex..., in: folded)
        return stopPattern.firstMatch(in: folded, range: range) != nil
    }
}
