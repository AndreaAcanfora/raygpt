import SwiftUI

@main
struct RayGPTApp: App {
    @State private var conversation = ConversationController.shared

    init() {
        // "Hey Meta, start RayGPT" starts a conversation (Meta Voice Invocations).
        let invocations = MetaVoiceInvocations.shared
        invocations.onLaunch = {
            Task { @MainActor in await ConversationController.shared.start() }
        }
        invocations.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(conversation: conversation)
                .onOpenURL { url in MetaVoiceInvocations.shared.handle(url: url) }
        }
    }
}
