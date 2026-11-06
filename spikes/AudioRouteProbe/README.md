# AudioRouteProbe

App di prova usa e getta per la milestone **M3-B** (`docs/VERIFICATION.md`): verifica se un’app
di terze parti può usare i Ray-Ban Meta come **auricolare Bluetooth HFP** (microfono e
altoparlanti), anche a schermo bloccato.

Cosa fa:

- configura `AVAudioSession` con `.playAndRecord` e `.allowBluetoothHFP` (modo `voiceChat`,
  `default` o `measurement`);
- forza come ingresso il microfono HFP degli occhiali;
- mostra route attuale, ingressi disponibili, sample rate, buffer e latenze;
- registra e riproduce, con indicatore di livello;
- registra nel log cambi di route, interruzioni, blocco e sblocco dell’iPhone; il log si condivide.

> Il codice è stato scritto senza poterlo compilare (non c’era Xcode a disposizione).
> Se Xcode segnala errori, mandami il messaggio e lo correggo.

## Creare il progetto Xcode

Serve Xcode 26 o successivo. Il progetto si genera con [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
brew install xcodegen
cd spikes/AudioRouteProbe
xcodegen generate
open AudioRouteProbe.xcodeproj
```

In Xcode:

1. target **AudioRouteProbe** → **Signing & Capabilities** → **Team**: il tuo Apple ID
   (va bene il “Personal Team” gratuito). Se il bundle identifier è già usato, cambiarlo.
2. Collegare l’iPhone, selezionarlo come destinazione e premere **Run**.
3. Al primo avvio iOS chiede di autorizzare lo sviluppatore: Impostazioni → Generali →
   VPN e gestione dispositivi.

Senza XcodeGen: creare in Xcode un nuovo progetto *iOS App* (SwiftUI) chiamato
AudioRouteProbe, sostituire i file Swift con quelli di `Sources/`, aggiungere la capability
**Background Modes → Audio** e la voce `NSMicrophoneUsageDescription` nelle Info del target.

## Procedura di test

Con gli occhiali indossati e collegati all’iPhone:

1. **Chiedi permesso microfono** → **Configura sessione audio** (modo `voiceChat`).
2. **Usa microfono degli occhiali (HFP)**. In “Route attuale” l’ingresso deve essere il nome
   degli occhiali con tipo `BluetoothHFP`; annotare sample rate e latenze.
3. **Registra** per 10 secondi parlando normalmente, poi **Ferma** e **Riproduci**:
   la voce si capisce? L’audio esce dagli occhiali?
4. Schermo bloccato: **Registra**, bloccare l’iPhone, parlare per 20 secondi, sbloccare,
   **Ferma** e **Riproduci**. La parte detta a schermo bloccato c’è?
5. Ripetere i punti 1–3 con il modo `measurement` per confrontare la qualità senza
   l’elaborazione vocale di iOS.
6. **Condividi log** e incollare il risultato nel registro di `docs/VERIFICATION.md`.
