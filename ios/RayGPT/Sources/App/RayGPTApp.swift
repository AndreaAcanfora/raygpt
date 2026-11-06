import SwiftUI

@main
struct RayGPTApp: App {
    @State private var conversation = ConversationController.shared

    var body: some Scene {
        WindowGroup {
            ContentView(conversation: conversation)
        }
    }
}
