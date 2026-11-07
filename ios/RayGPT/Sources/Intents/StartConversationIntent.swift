import AppIntents

/// "Avvia Raggio" for Siri, Shortcuts and the Action button: the hands-free trigger available
/// until Meta Voice Invocations ("Hey Meta, start RayGPT") are approved (milestone M7).
struct StartConversationIntent: AppIntent {
    static let title: LocalizedStringResource = "Avvia Raggio"
    static let description = IntentDescription("Avvia una conversazione vocale con Raggio.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        await ConversationController.shared.start()
        return .result()
    }
}

struct StopConversationIntent: AppIntent {
    static let title: LocalizedStringResource = "Chiudi Raggio"
    static let description = IntentDescription("Chiude la conversazione in corso con Raggio.")

    @MainActor
    func perform() async throws -> some IntentResult {
        await ConversationController.shared.stop()
        return .result()
    }
}

struct RayGPTShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartConversationIntent(),
            phrases: ["Avvia \(.applicationName)", "Parla con \(.applicationName)"],
            shortTitle: "Avvia Raggio",
            systemImageName: "waveform"
        )
        AppShortcut(
            intent: StopConversationIntent(),
            phrases: ["Chiudi \(.applicationName)"],
            shortTitle: "Chiudi Raggio",
            systemImageName: "phone.down"
        )
    }
}
