import SwiftUI

/// Past conversations saved on the phone (ConversationHistory), newest first.
struct HistoryView: View {
    let history: ConversationHistory
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            List(history.records) { record in
                NavigationLink {
                    RecordView(record: record)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Self.summary(of: record))
                            .font(.subheadline.bold())
                        if let first = record.lines.first(where: { $0.speaker == "user" })?.text {
                            Text(first.trimmingCharacters(in: .whitespacesAndNewlines))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            }
            .overlay {
                if history.records.isEmpty {
                    ContentUnavailableView("Nessuna conversazione", systemImage: "text.bubble",
                                           description: Text("Le conversazioni compaiono qui quando finiscono."))
                }
            }
            .navigationTitle("Conversazioni")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Chiudi") { dismiss() }
                }
                ToolbarItem(placement: .destructiveAction) {
                    Button("Elimina tutto", role: .destructive) { confirmingDelete = true }
                        .disabled(history.records.isEmpty)
                }
            }
            .confirmationDialog("Eliminare tutte le conversazioni salvate?", isPresented: $confirmingDelete,
                                titleVisibility: .visible) {
                Button("Elimina tutto", role: .destructive) { history.deleteAll() }
            }
        }
    }

    /// "8 nov, 09:31 · 9 min · silenzio"
    static func summary(of record: ConversationRecord) -> String {
        var parts = [record.startedAt.formatted(.dateTime.day().month(.abbreviated).hour().minute())]
        if let endedAt = record.endedAt {
            parts.append("\(max(1, Int(endedAt.timeIntervalSince(record.startedAt) / 60))) min")
        }
        parts.append(record.reason.map(ConversationController.describe) ?? "interrotta")
        return parts.joined(separator: " · ")
    }
}

private struct RecordView: View {
    let record: ConversationRecord

    var body: some View {
        List(Array(record.lines.enumerated()), id: \.offset) { _, line in
            VStack(alignment: .leading, spacing: 2) {
                Text(line.speaker == "user" ? "Tu" : "Raggio")
                    .font(.caption.bold())
                    .foregroundStyle(line.speaker == "user" ? Color.secondary : Color.accentColor)
                Text(line.text)
                    .textSelection(.enabled)
            }
        }
        .navigationTitle(HistoryView.summary(of: record))
        .navigationBarTitleDisplayMode(.inline)
    }
}
