import SwiftUI

/// Throwaway probe for milestone M3-B (docs/VERIFICATION.md): can a third-party app use the
/// Ray-Ban Meta glasses as a Bluetooth HFP headset, also with the screen locked?
@main
struct AudioRouteProbeApp: App {
    @State private var model = ProbeModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
    }
}
