import SwiftUI

struct ContentView: View {
    @Bindable var model: ProbeModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Form {
                Section("1. Permesso e sessione") {
                    LabeledContent("Microfono", value: model.permission)
                    Button("Chiedi permesso microfono") {
                        Task { await model.requestPermission() }
                    }
                    Picker("Modo", selection: $model.mode) {
                        ForEach(ProbeModel.Mode.allCases) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    Button("Configura sessione audio") { model.configureSession() }
                    Button("Usa microfono degli occhiali (HFP)") { model.preferGlassesInput() }
                }

                Section("2. Route attuale") {
                    LabeledContent("Ingresso", value: model.routeInputs)
                    LabeledContent("Uscita", value: model.routeOutputs)
                    Text(model.details).font(.footnote).foregroundStyle(.secondary)
                    if !model.availableInputs.isEmpty {
                        Text("Disponibili: " + model.availableInputs.joined(separator: ", "))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Button("Aggiorna") { model.refresh() }
                }

                Section("3. Registra e riascolta") {
                    if model.isRecording {
                        ProgressView(value: model.level)
                        Button("Ferma registrazione", role: .destructive) { model.stopRecording() }
                    } else {
                        Button("Registra") { model.startRecording() }
                    }
                    Button(model.isPlaying ? "In riproduzione…" : "Riproduci") { model.play() }
                        .disabled(!model.hasRecording || model.isRecording || model.isPlaying)
                }

                Section("Test a schermo bloccato") {
                    Text("Avvia la registrazione, blocca l’iPhone, parla per 20 secondi, sblocca, ferma e riascolta. Il log segna quando l’iPhone è stato bloccato e sbloccato.")
                        .font(.footnote)
                }

                Section("Log") {
                    ShareLink("Condividi log", item: model.logText)
                    ForEach(Array(model.log.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.caption.monospaced())
                    }
                }
            }
            .navigationTitle("AudioRouteProbe")
        }
        .onChange(of: scenePhase) { _, phase in
            model.append("App: \(String(describing: phase))")
        }
    }
}
