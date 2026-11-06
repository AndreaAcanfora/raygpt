# Piano di verifica hardware (M0–M3)

Obiettivo: capire **con test pratici**, prima di scrivere RayGPT, quale strada audio funziona
davvero con i nostri Ray-Ban Meta Gen 1 e il nostro iPhone.

Per ogni test annotare il risultato nella tabella in fondo (✅ / ❌ / ⚠️ + note).
Le versioni di software e firmware vanno sempre registrate: con SDK in developer preview
il comportamento cambia da una release all’altra.

---

## Fase 0 — Test senza codice (circa 1 ora)

Questi test non richiedono Xcode e danno già metà delle risposte del progetto.

### T0.1 Gli occhiali come auricolare Bluetooth (Strada B)

1. iPhone → Impostazioni → Bluetooth: gli occhiali compaiono come dispositivo audio collegato?
2. Fare una normale telefonata e una chiamata WhatsApp con gli occhiali indossati.
   - Il microfono degli occhiali viene usato? (chiedere all’altra persona come si sente)
   - L’audio esce dagli altoparlanti degli occhiali?
3. Durante la chiamata aprire il Centro di Controllo → icona AirPlay/audio: quale uscita è selezionata?

Se le chiamate funzionano, gli occhiali espongono il profilo **HFP** (microfono + altoparlanti):
è la base della Strada B.

### T0.2 Benchmark: ChatGPT Advanced Voice con gli occhiali

1. Con gli occhiali collegati, aprire l’app ChatGPT e avviare la modalità vocale.
2. Verificare: la voce viene presa dagli occhiali? La risposta esce dagli occhiali?
3. Attivare in ChatGPT l’opzione per continuare la conversazione in background (se presente),
   bloccare l’iPhone e continuare a parlare.
4. Provare ad avviare la modalità vocale senza sbloccare il telefono (Siri, tasto Azione,
   controllo nel Centro di Controllo o widget della schermata di blocco, se disponibili).
5. Stimare la latenza e provare a interrompere l’assistente mentre parla.

Questo è il **riferimento da eguagliare**: se l’esperienza è già quasi quella desiderata,
RayGPT deve aggiungere valore soprattutto su attivazione con “Hey Meta”, personalità e strumenti.

### T0.3 “Hey Meta, chiama …” (Strada C, telefonia)

1. Creare un contatto di prova in rubrica (per esempio il proprio fisso o il numero di un amico).
2. Con l’iPhone bloccato in tasca dire: “Hey Meta, chiama <nome contatto>”.
3. Annotare: la chiamata parte? Serve sbloccare il telefono? Funziona il comando in italiano?

Se funziona, un numero di telefono collegato a un modello vocale OpenAI darebbe subito
attivazione vocale, schermo bloccato e conversazione continua senza nessuna app iOS
(vedi `PROJECT.md`, Strada C).

### T0.4 Inventario versioni

- [ ] Modello esatto degli occhiali (Impostazioni del dispositivo nell’app Meta AI)
- [ ] Versione firmware degli occhiali (app Meta AI → Dispositivi → ingranaggio → Impostazioni
      dispositivo → Generali → Info → Versione). Per l’SDK 1.0.1 serve **V128**
- [ ] Versione app Meta AI. Per l’SDK 1.0.1 serve **V292**
- [ ] Modello iPhone e versione iOS (il toolkit Meta richiede almeno iOS 17.2)
- [ ] Lingua impostata per Meta AI sugli occhiali
- [ ] L’Italia è nella lista Meta dei Paesi in cui gli occhiali con Meta AI sono supportati
      (condizione per il Developer Center e le capability complete)

---

## Fase 1 — M0: ambiente di sviluppo (Mac)

```bash
sw_vers
xcodebuild -version
swift --version
git clone https://github.com/facebook/meta-wearables-dat-ios.git
```

- [ ] **Xcode 26.4 o successivo** (requisito del toolkit Meta 1.0.x; aggiornare dal Mac App Store se serve)
- [ ] Apple ID aggiunto in Xcode (Settings → Accounts). Per i primi test basta il “Personal Team” gratuito
- [ ] iPhone: Impostazioni → Privacy e sicurezza → Modalità sviluppatore attiva
- [ ] Il sample `samples/CameraAccess` compila per il simulatore
- [ ] Il sample si installa ed esegue sull’iPhone reale (cambiare bundle identifier e team)

Risultato atteso: sample ufficiale installato sull’iPhone.

## Fase 2 — M1: connessione agli occhiali

- [ ] **Developer Mode** attivo: app Meta AI → Impostazioni → Info app → toccare 5 volte il
      numero di versione → interruttore Developer Mode → Abilita
      (si disattiva dopo ogni aggiornamento firmware: riattivarlo)
- [ ] Ricordare che in Developer Mode resta registrata **una sola app di terze parti**:
      registrare RayGPT cancella la registrazione del sample, e viceversa
- [ ] CameraAccess: registrazione dell’app tramite Meta AI completata (ritorno via URL scheme)
- [ ] Gli occhiali compaiono nell’elenco dei dispositivi, con stato di compatibilità OK
- [ ] Una `DeviceSession` arriva allo stato `started`
- [ ] Chiudere le stanghette: la sessione va in `stopped`; riaprirle: serve una nuova sessione

Risultato atteso: un’app iOS nostra parla con i Ray-Ban Gen 1.

## Fase 3 — M2: fotocamera (facoltativa, 30 minuti)

- [ ] Anteprima video avviata e fermata dal sample
- [ ] Foto scattata
- [ ] Annotare se il LED di privacy degli occhiali resta acceso durante lo streaming

## Fase 4 — M3: audio (milestone critica)

### M3-B: route Bluetooth HFP (via iOS, senza toolkit)

Primo controllo rapido: il sample **CameraAccess** registra l’audio dei video dal microfono
degli occhiali proprio via HFP. Registrare un video con audio e riascoltarlo: se la voce c’è,
la route HFP funziona per un’app di terze parti.

Poi l’app di prova [`spikes/AudioRouteProbe`](../spikes/AudioRouteProbe/README.md), che:

1. configura `AVAudioSession` con `.playAndRecord`, modalità `.voiceChat`, opzione `.allowBluetoothHFP`;
2. elenca `availableInputs` e `currentRoute` (input e output);
3. registra 10 secondi dal microfono degli occhiali e li riproduce negli occhiali;
4. ripete il test **dopo aver bloccato l’iPhone** con la sessione già attiva;
5. stampa sample rate effettivo e latenza di I/O (`inputLatency`, `outputLatency`, `ioBufferDuration`).

Criteri:

- [ ] Gli occhiali compaiono come input `bluetoothHFP`
- [ ] Voce registrata comprensibile (sample rate atteso: 16 kHz o 8 kHz)
- [ ] Riproduzione negli altoparlanti degli occhiali
- [ ] Funziona con schermo bloccato se avviata prima del blocco
- [ ] Nessun eco evidente quando si parla mentre l’app riproduce audio

### M3-A: audio tramite toolkit Meta (Camera Stream)

L’audio del toolkit è un’estensione **sperimentale** dello stream della fotocamera:
richiede permessi camera + microfono, l’approvazione “Audio Streaming” nel Wearables
Developer Center (da verificare se serve anche in Developer Mode) e uno stream video attivo.

- [ ] Usare il sample **BirdSpotter** (funzione di ascolto con il microfono degli occhiali), che
      riceve il PCM dallo stream camera del toolkit. Attenzione: CameraAccess **non** usa questa
      strada, il suo audio passa da HFP
- [ ] Se compare un errore di permesso o di capability negata: annotare il messaggio
      (indica che serve l’approvazione nel Developer Center)
- [ ] Qualità della voce a 16 kHz
- [ ] Il LED della fotocamera resta acceso? (impatto su privacy e batteria)
- [ ] Temperatura e batteria dopo 10 minuti di stream
- [ ] Funziona con iPhone bloccato?

### Decisione dopo M3

| Esito | Decisione |
|---|---|
| M3-B funziona | MVP su route HFP + WebRTC standard. Il toolkit Meta serve solo per Voice Invocations |
| Solo M3-A funziona | MVP con PCM del toolkit verso OpenAI (WebSocket o sorgente audio WebRTC personalizzata); valutare batteria e LED |
| Nessuno dei due | Ripiegare sulla Strada C (telefonia) o sul benchmark T0.2 |

---

## Registro risultati

| Test | Data | Versioni (iOS / Meta AI / firmware / SDK) | Esito | Note |
|---|---|---|---|---|
| T0.1 |  |  |  |  |
| T0.2 |  |  |  |  |
| T0.3 |  |  |  |  |
| M0 |  |  |  |  |
| M1 |  |  |  |  |
| M2 |  |  |  |  |
| M3-B |  |  |  |  |
| M3-A |  |  |  |  |
