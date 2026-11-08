import SwiftUI

struct ContentView: View {
    let conversation: ConversationController
    @State private var showingSettings = false
    @State private var showingHistory = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    Text(conversation.status)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                    Text(conversation.route)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    if let stats = statsText {
                        Text(stats)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)

                HStack(spacing: 12) {
                    if conversation.phase == .idle {
                        Button {
                            Task { await conversation.start() }
                        } label: {
                            Label("Avvia", systemImage: "waveform")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        Button {
                            Task { await conversation.toggleMute() }
                        } label: {
                            Label(conversation.isMuted ? "Riattiva" : "Silenzia",
                                  systemImage: conversation.isMuted ? "mic.slash" : "mic")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(conversation.phase != .active)

                        Button(role: .destructive) {
                            Task { await conversation.stop() }
                        } label: {
                            Label("Chiudi", systemImage: "phone.down")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(conversation.phase == .stopping)
                    }
                }
                .controlSize(.large)
                .padding(.horizontal)

                TranscriptView(lines: conversation.lines)
            }
            .padding(.top)
            .navigationTitle("Raggio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingHistory = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                    .accessibilityLabel("Conversazioni")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Impostazioni")
                    .disabled(conversation.phase != .idle)
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView(settings: conversation.settings)
            }
            .sheet(isPresented: $showingHistory) {
                HistoryView(history: ConversationHistory.shared)
            }
        }
    }

    private var statsText: String? {
        var parts: [String] = []
        if let latency = conversation.startLatency {
            parts.append(String(format: "avvio %.1f s", latency))
        }
        if conversation.billedSeconds > 0 {
            parts.append(String(format: "%.0f s ≈ %.3f $", conversation.billedSeconds, conversation.estimatedCostUSD))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

private struct TranscriptView: View {
    let lines: [ConversationController.Line]

    var body: some View {
        ScrollViewReader { proxy in
            List(lines) { line in
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.speaker == .user ? "Tu" : "Raggio")
                        .font(.caption.bold())
                        .foregroundStyle(line.speaker == .user ? Color.secondary : Color.accentColor)
                    Text(line.text)
                }
                .id(line.id)
            }
            .listStyle(.plain)
            .onChange(of: lines.last?.text) {
                if let last = lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
    }
}
