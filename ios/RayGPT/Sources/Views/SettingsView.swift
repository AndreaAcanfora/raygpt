import SwiftUI

struct SettingsView: View {
    @Bindable var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://raygpt-backend.…workers.dev", text: $settings.backendURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Token (APP_TOKEN)", text: $settings.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Backend")
                } footer: {
                    Text(settings.isConfigured
                         ? "Configurazione valida. Il token è salvato nel Portachiavi."
                         : "Serve l’indirizzo del backend (https://…) e il token di almeno 32 caratteri.")
                }

                MetaGlassesSection(invocations: MetaVoiceInvocations.shared)

                Section("Voce") {
                    Picker("Voce", selection: $settings.voice) {
                        ForEach(AppSettings.voices, id: \.self) { voice in
                            Text(voice).tag(voice)
                        }
                    }
                }

                Section {
                    Stepper("Chiudi dopo \(settings.idleSeconds) s di silenzio",
                            value: $settings.idleSeconds, in: 30...900, step: 30)
                    Stepper("Durata massima \(settings.maxMinutes) min",
                            value: $settings.maxMinutes, in: 5...120, step: 5)
                } header: {
                    Text("Limiti")
                } footer: {
                    Text("GPT-Live costa circa 0,05 $ al minuto e OpenAI non chiude da solo le sessioni inattive.")
                }
            }
            .navigationTitle("Impostazioni")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fine") { dismiss() }
                }
            }
        }
    }
}

/// Registration with Meta AI and status of "Hey Meta, start RayGPT".
private struct MetaGlassesSection: View {
    let invocations: MetaVoiceInvocations

    var body: some View {
        Section {
            Text(invocations.status.description)
            if invocations.status == .notRegistered || isFailure {
                Button("Registra Raggio in Meta AI") {
                    Task { await invocations.register() }
                }
            }
            if invocations.status == .listening || invocations.status == .waitingForGlasses {
                Button("Annulla registrazione", role: .destructive) {
                    Task { await invocations.unregister() }
                }
            }
            if let last = invocations.lastInvocation {
                Text("Ultimo “Ehi Meta”: \(last.formatted(date: .omitted, time: .standard))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Occhiali Meta")
        } footer: {
            Text("Serve il Developer Mode nell’app Meta AI e il nome “Raggio” configurato nel Wearables Developer Center. Poi di’ “Ehi Meta, avvia Raggio”.")
        }
    }

    private var isFailure: Bool {
        if case .failed = invocations.status { return true }
        return false
    }
}
