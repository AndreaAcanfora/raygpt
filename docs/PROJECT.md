# RayGPT — Documento tecnico di progetto

Versione 1.1 · 6 novembre 2026 · revisione della v1.0 (originale in `docs/archive/`)

> **Cosa cambia rispetto alla v1.0, in breve**
>
> - Le affermazioni su OpenAI e Meta sono state ricontrollate sulla documentazione e sul codice
>   ufficiali (novembre 2026). Gli errori trovati sono elencati in [`REVIEW.md`](REVIEW.md).
> - L’audio del toolkit Meta arriva **solo come estensione dello stream della fotocamera**
>   ed è sperimentale: non è la strada naturale per un assistente vocale.
> - Gli occhiali funzionano anche come **auricolare Bluetooth (HFP)**: questa diventa la strada
>   consigliata per l’MVP. Aggiunta una terza strada (telefonia, “Hey Meta, chiama RayGPT”).
> - Aggiunti CallKit per schermo bloccato e background, gestione dell’eco, criteri di
>   uscita misurabili per ogni milestone e un modello a stati più robusto.
> - La sezione OpenAI è stata riscritta: la v1.0 mescolava GPT-Live con gli eventi della
>   vecchia Realtime API.

---

## 1. Executive summary

RayGPT è un progetto sperimentale per parlare con un assistente AI attraverso gli occhiali
Ray-Ban Meta di prima generazione, con un’esperienza simile a ChatGPT Advanced Voice:
conversazione continua, bassa latenza, possibilità di interrompere l’assistente, senza
prendere in mano l’iPhone.

Esperienza desiderata:

1. L’utente indossa gli occhiali e dice “Hey Meta, avvia RayGPT” (o un’attivazione equivalente).
2. Parla normalmente: la voce viene presa dai microfoni degli occhiali.
3. L’iPhone inoltra l’audio a un modello vocale OpenAI.
4. La risposta viene riprodotta dagli altoparlanti degli occhiali.
5. La conversazione continua senza ripetere il comando, anche a schermo bloccato.

La parte AI è ben definita. **Il rischio vero è l’audio tra occhiali e iPhone** e
l’attivazione vocale. Per questo il progetto parte da test pratici sull’hardware
([`VERIFICATION.md`](VERIFICATION.md)) prima di scrivere l’app.

### 1.1 Architettura generale

```text
Ray-Ban Meta Gen 1  ── microfoni, altoparlanti, “Hey Meta”
        │  Bluetooth HFP (audio) · Bluetooth/Wi-Fi DAT (eventi, invocazioni, camera)
        ▼
iPhone — app RayGPT  ── Swift/SwiftUI · AVAudioSession · CallKit · WebRTC
        │  Internet (WebRTC: audio + data channel)
        ▼
OpenAI (GPT-Live)    ── comprensione, ragionamento, voce
        ▲
Backend minimale     ── chiave API, creazione sessioni, limiti di spesa
```

### 1.2 Cosa non stiamo costruendo

- **Non possiamo richiamare ChatGPT Advanced Voice** dall’esterno: è un’esperienza dell’app
  ChatGPT senza API pubblica. Costruiamo un’esperienza autonoma con le API vocali di OpenAI:
  sarà simile, non identica (modello, voci, memoria e funzioni dipendono dalle API).
- **Non è un’app da App Store** nella prima versione: è per uso personale. Le funzioni
  sperimentali del toolkit Meta (audio, Voice Invocations, Speech, Inputs) oggi non sono
  pubblicabili, ma si possono usare in sviluppo e beta test.

### 1.3 Premesse

| Premessa | Conseguenza |
|---|---|
| Uso personale, un solo utente | Backend minimo, autenticazione semplice, niente database |
| Utente in Italia | Verificare disponibilità del Developer Center Meta e lingua di “Hey Meta” |
| Hardware: Ray-Ban Meta Gen 1 | Supportato dal toolkit Meta; funzioni per modello da verificare |
| Accesso al Developer Center Meta non ancora disponibile | Le strade che non lo richiedono vengono prima |

---

## 2. Hardware e ambiente di sviluppo

### 2.1 Situazione attuale

| Componente | Situazione |
|---|---|
| Ray-Ban Meta Gen 1 | Disponibili |
| iPhone | Disponibile (serve iOS 17.2 o superiore per il toolkit Meta) |
| Mac con Xcode | Installato. **Il toolkit Meta 1.0.x richiede Xcode 26.4 o successivo**: verificare la versione |
| App Meta AI e firmware | Per l’SDK 1.0.1: app Meta AI V292, firmware occhiali V128 (tabella “version dependencies” di Meta) |
| Account Apple Developer | Da decidere: “Personal Team” gratuito per i test, programma a pagamento per l’uso continuativo |
| Meta Wearables Developer Center | Accesso non ancora disponibile |
| OpenAI API | Da configurare: progetto dedicato, chiave dedicata, limite di spesa |

### 2.2 Software previsto

| Tecnologia | Utilizzo |
|---|---|
| Swift 6, SwiftUI | App iOS |
| AVFoundation / AVAudioSession | Audio e routing Bluetooth |
| CallKit | Conversazione gestita come “chiamata”: background, schermo bloccato, priorità audio |
| WebRTC per iOS (framework di terze parti) | Collegamento audio con OpenAI. iOS non include WebRTC: serve un pacchetto binario (per esempio le build di Google WebRTC distribuite via Swift Package Manager) |
| Meta Wearables DAT 1.0.x | Registrazione dell’app, Voice Invocations, Inputs, eventuale audio/camera |
| OpenAI GPT-Live | Modello vocale speech-to-speech |
| Node.js + TypeScript | Backend minimale |
| Git / GitHub | Versionamento (questo repository) |

### 2.3 Versioni da registrare a ogni test

`sw_vers`, `xcodebuild -version`, `swift --version`, versione iOS, versione app Meta AI,
firmware degli occhiali, versione SDK Meta. Con un SDK giovane e funzioni sperimentali le
differenze di versione spiegano molti comportamenti.

---

## 3. OpenAI: GPT-Live

Verificato sulla documentazione OpenAI (developers.openai.com) il 6 novembre 2026.
Riferimenti puntuali nella sezione 18.

### 3.1 Speech-to-speech e full duplex

Una pipeline tradizionale (trascrizione → modello di testo → sintesi vocale) aggiunge passaggi,
latenza e perde l’intonazione. Un modello **speech-to-speech** riceve audio e produce audio.
GPT-Live fa un passo in più: è **full duplex**, cioè ascolta mentre parla e decide da solo
quando parlare e quando tacere. È questo che rende naturali pause e interruzioni, ed è la
tecnologia più vicina ad Advanced Voice disponibile per gli sviluppatori.

### 3.2 GPT-Live o Realtime API

OpenAI offre due API vocali, entrambe documentate e attive:

| | GPT-Live (`gpt-live-1`) | Realtime API (`gpt-realtime`, `gpt-realtime-mini`) |
|---|---|---|
| Conversazione | Full duplex: il modello gestisce i turni da solo | A turni, con rilevamento della voce configurabile (server VAD, semantic VAD) |
| Interruzioni | Gestite dal modello, nessun evento dedicato | Eventi di inizio voce e cancellazione della risposta |
| Collegamento da app mobile | WebRTC con SDP scambiato **dal backend** (niente token temporanei) | WebRTC con token temporaneo o tramite backend |
| WebSocket | Solo dal backend (chiave API) | Sì |
| Strumenti | Tramite “delegation” a un modello di backend o al nostro server | Function calling nella stessa sessione |
| Immagini in input | No | Sì |
| Telefonia SIP | Sì | Sì |
| Prezzo | 0,05 $ al minuto, conteggiato al secondo | A token (vedi §15) |

**Scelta: GPT-Live**, perché è full duplex (l’obiettivo è un’esperienza tipo Advanced Voice)
e ha un costo prevedibile. La Realtime API resta l’alternativa se in M4 servissero VAD
configurabile, immagini nella stessa sessione o costi diversi.

### 3.3 Collegamento WebRTC

Flusso documentato da OpenAI, adattato a RayGPT:

1. L’app crea la `RTCPeerConnection`, aggiunge la traccia del microfono e crea il data channel
   `oai-events` **prima** di generare l’SDP offer.
2. Invia l’offer al nostro backend (`POST /api/session`, JSON con il campo `sdp`), autenticandosi con il token personale.
3. Il backend chiama `POST https://api.openai.com/v1/live/sessions` con la chiave API:
   ```json
   {
     "session": { "model": "gpt-live-1", "instructions": "…", "audio": { "output": { "voice": "marin" } } },
     "transport": { "type": "webrtc", "sdp": "<SDP offer>" }
   }
   ```
4. OpenAI risponde `201` con `session.id` e `transport.sdp` (l’SDP answer); il backend li passa all’app.
5. L’app imposta l’answer come remote description. Sul data channel arriva `session.started`
   (con `expires_at`). Con WebRTC **non** si invia `session.start`: la sessione parte con la chiamata HTTP.
6. Chiusura: `session.close` sul data channel, attesa di `session.closed`, poi chiusura della connessione.

Note:

- GPT-Live non prevede token temporanei per il client: la chiave resta sul backend e l’app
  riceve solo l’SDP answer. L’impostazione della v1.0 era corretta.
- Il formato audio si negozia nell’SDP: non impostare `audio.format`.
- Il backend può collegarsi alla stessa sessione con un **WebSocket “sideband”**
  (`wss://api.openai.com/v1/live/sessions/{id}/attach`) per ricevere eventi, eseguire
  strumenti o aggiungere istruzioni, mentre l’audio resta tra iPhone e OpenAI.
- La documentazione mostra un esempio per browser; su iOS serve un framework WebRTC (§2.2).
  Lo schema esatto del corpo va ricontrollato sulla reference al momento di scrivere il backend.

### 3.4 WebSocket

Il WebSocket principale (`wss://api.openai.com/v1/live/sessions`) porta audio ed eventi JSON
nei due sensi, ma richiede la chiave API: **si usa solo dal backend**. Flusso: `session.start`
→ `session.started` → `session.input_audio.append` (audio base64). Formati: PCM16 mono a
24 kHz (predefinito) o 16 kHz, G.711 µ-law/A-law a 8 kHz. L’audio in uscita arriva come
`session.output_audio.delta`, senza un evento di fine: la coda di riproduzione la gestisce il client.

Per RayGPT conta solo nella Strada A: il PCM a 16 kHz del toolkit Meta è un formato accettato
così com’è, ma servirebbe un relay audio sul backend (un salto di rete in più). L’alternativa
è WebRTC con una sorgente audio personalizzata.

### 3.5 Turni, interruzioni e VAD

- GPT-Live **non ha parametri di VAD** (server VAD e semantic VAD sono della Realtime API) né
  eventi di inizio/fine voce: il modello decide i turni da solo.
- Il **barge-in è comportamento del modello**: se l’utente parla sopra, il modello smette e
  risponde. Non esiste un comando di cancellazione della risposta.
- Per uno “stop” manuale (tocco sugli occhiali, pulsante) il client può silenziare la traccia
  in uscita; un’istruzione aggiunta con `session.instructions.append` può interrompere il parlato in corso.
- `session.input_audio.mute`/`unmute` mette in pausa il microfono senza chiudere la sessione
  (utile come “pausa privacy”), ma non ferma l’audio in uscita né il lavoro delegato.
- Conseguenza: meno logica di barge-in da scrivere, ma **l’eco diventa ancora più critica**:
  un modello che ascolta mentre parla, se sente la propria voce dagli altoparlanti, può
  scambiarla per l’utente. Con HFP l’eco è cancellata dal percorso chiamata (§6.5).

### 3.6 Eventi principali

Con WebRTC l’audio viaggia sulle tracce; sul data channel passano solo eventi JSON.

| Evento | Da | Significato |
|---|---|---|
| `session.started` | server | Sessione attiva, con `id` ed `expires_at` |
| `session.update` / `session.updated` | client / server | Modifiche limitate dopo l’avvio |
| `session.input_transcript.delta` | server | Trascrizione progressiva dell’utente (`start_ms`, `end_ms`) |
| `session.output_transcript.delta` | server | Trascrizione progressiva dell’assistente |
| `session.input_audio.mute` / `unmute` | client | Microfono in pausa e ripresa (conferme `…muted` / `…unmuted`) |
| `session.instructions.append` | client | Istruzioni aggiuntive a sessione avviata (max 500 token) |
| `session.delegation.created`, `response.event` | server | Lavoro delegato a un backend (strumenti) |
| `session.usage.updated` | server | Secondi consumati e uso del contesto |
| `session.close` / `session.closed` | client / server | Chiusura, con motivo e secondi totali |
| `error`, `info` | server | Errori (anche non fatali) e avvisi |

Non esistono eventi di “turno completato” o “trascrizione finita”. Motivi di chiusura:
`close_requested`, `expired`, `content` (filtro di sicurezza), `remote_hangup`, `connection_lost`.
Gli eventi `session.created`, `input_audio_buffer.*`, `response.done`, `response.cancel`
citati nella v1.0 appartengono alla Realtime API.

### 3.7 Contesto, durata e dati

- **Contesto** di 128 000 token (istruzioni, testo e audio). Oltre il 90% la sessione avvia un
  motore sostitutivo con le istruzioni originali e fino a 8 192 token di storia: nelle
  conversazioni molto lunghe i dettagli più vecchi si perdono.
- **Durata**: nessun massimo generale documentato; ogni sessione ha `expires_at` e si chiude
  con motivo `expired`. Le chiamate SIP durano al massimo 2 ore.
- **Nessun timeout di inattività lato OpenAI**, e il prezzo è al minuto: il timeout va
  implementato da noi (§11).
- **Istruzioni** fino a 16 384 token, immutabili dopo l’avvio; si possono aggiungere pezzi con
  `session.instructions.append`. Voce scelta all’avvio e non modificabile.
- **Dati**: `store` è `false` per default, quindi nessuna registrazione salvata. Con
  `store: true` OpenAI conserva la registrazione per 30 giorni. Per RayGPT resta `false`.
- **Account**: GPT-Live non è disponibile sul piano gratuito dell’API; serve la fatturazione attiva.

### 3.8 Voce, lingua e istruzioni

- 31 voci predefinite (`audio.output.voice`, predefinita `marin`). Non esiste un campo lingua:
  la lingua si guida con le istruzioni.
- La documentazione indica lingua e accento per alcune voci (inglese, portoghese, tedesco,
  francese, hindi, giapponese, coreano): **l’italiano non è elencato**. La voce va scelta
  ascoltando come pronuncia l’italiano (test in M4).
- Istruzioni proposte (in inglese, che il modello segue in modo più affidabile; le risposte
  restano nella lingua dell’utente):

```text
You are RayGPT, a voice assistant the user hears through smart glasses while walking,
travelling or doing other things. The user cannot see a screen.

- Default to Italian. Answer in the language the user speaks and switch when they do.
- Keep answers short: one to three sentences, then stop. Offer more only when useful.
- Speak naturally. No lists, markdown, emojis, URLs or symbols. Say numbers, dates and
  units the way a person would say them aloud.
- If a request is ambiguous, ask one short question instead of guessing.
- The user may interrupt you at any time: stop and focus on what they just said.
- Use the conversation so far; never ask again for something the user already told you.
- If you are not sure about live facts (opening hours, prices, timetables, news), say so briefly.
- You cannot see what the user sees unless a tool gives you a description of an image.
```

### 3.9 Strumenti

In GPT-Live gli strumenti passano dalla **delegation**:

- delega a un **modello di backend** tramite Responses API, con function calling, strumenti
  ospitati (per esempio la ricerca web) e server MCP;
- delega al **nostro backend**, che esegue lo strumento e restituisce il risultato alla
  conversazione con `session.commentary.append` o `session.thinking.append`.

Il modello di backend ha un costo a parte. `gpt-live-1` non accetta immagini: anche la
“visione” (§16) passa da un modello di backend.

---

## 4. Meta Wearables Device Access Toolkit (DAT)

Verificato sul repository ufficiale `facebook/meta-wearables-dat-ios` (versione 1.0.1 del
9 ottobre 2026) e sulle relative guide.

### 4.1 Stato del toolkit

- Versione 1.0 rilasciata a fine settembre 2026 (1.0.1 il 9 ottobre). Le FAQ Meta dicono che
  non è più in developer preview, il README del repository lo dice ancora; in ogni caso la
  **pubblicazione su App Store non è ancora supportata**: si distribuisce ai tester tramite i
  “release channel” del Developer Center.
- Distribuito come Swift Package:
  `https://github.com/facebook/meta-wearables-dat-ios` (l’indirizzo `meta/…` porta allo stesso repository).
- Requisiti: iOS **17.2+**, **Xcode 26.4+**, app Meta AI e firmware allineati alla versione dell’SDK.
- Dispositivi supportati secondo la documentazione: **Ray-Ban Meta Gen 1 e Gen 2**, Ray-Ban Meta
  Optics, Meta Ray-Ban Display, Oakley Meta HSTN e Vanguard. “La disponibilità delle capability
  varia per dispositivo”: non esiste una tabella per modello, va verificato sul nostro.
- Le funzioni marcate **sperimentali** si possono sviluppare e testare, ma le app che le usano
  **non possono ancora essere pubblicate** sui canali di produzione.
- Il Developer Center e le capability complete sono disponibili solo nei **Paesi in cui
  gli occhiali con Meta AI sono supportati**: verificare che l’Italia sia nella lista Meta.
- Alcune capability sono abilitate **lato server per singolo utente**, indipendentemente da
  versioni di SDK, app e firmware: se negate, la sessione restituisce un errore di capability negata.
- Il repository include istruzioni per assistenti AI (plugin per Claude Code, `AGENTS.md`)
  e un server MCP pubblico di documentazione (`https://mcp.developer.meta.com/wearables`):
  utili durante lo sviluppo.

### 4.2 Moduli reali

| Modulo | Funzione | Stato |
|---|---|---|
| `MWDATCore` | Configurazione, registrazione, dispositivi, sessioni, **Voice Invocations** | Voice Invocations sperimentale |
| `MWDATCamera` | Streaming video, foto, **audio PCM dentro lo stream camera** | Audio e foto standalone sperimentali |
| `MWDATSpeech` | Trascrizione on-device con risultati parziali e finali | Sperimentale |
| `MWDATInputs` | Eventi di input dagli occhiali (pulsanti, tocchi, trascinamenti) | Sperimentale, richiede approvazione |
| `MWDATMotion` | Accelerometro, giroscopio, orientamento | Sperimentale |
| `MWDATDisplay` | Contenuti sui Meta Ray-Ban Display (non sui Gen 1) | — |
| `MWDATMockDevice`, `MWDATMockDeviceTestClient` | Simulazione degli occhiali per test | — |

### 4.3 Registrazione, Developer Mode e produzione

- L’app si **registra** presso l’app Meta AI (passaggio con ritorno via URL scheme), poi
  chiede i permessi del dispositivo (camera, microfono). Tutte le autorizzazioni passano da Meta AI.
- **Developer Mode** permette a un’app non pubblicata di registrarsi e usare i nostri occhiali
  senza revisione. Si attiva nell’app Meta AI: Impostazioni → Info app → toccare **5 volte**
  il numero di versione → attivare l’interruttore Developer Mode → Abilita. Con Developer Mode
  `MetaAppID` può restare vuoto o `0` (l’SDK salta l’attestazione) e basta un URL scheme personalizzato.
- Limiti noti: **una sola app di terze parti registrata alla volta** (registrarne una nuova
  cancella la precedente, per esempio il sample Meta e RayGPT); Developer Mode **si disattiva
  dopo gli aggiornamenti firmware** e va riattivato.
- In **produzione** servono `MetaAppID`, `ClientToken` (dal Wearables Developer Center) e
  `TeamID` Apple, e gli utenti devono essere nel canale di rilascio giusto.
- Alcune capability richiedono **approvazione nel Developer Center** (Audio Streaming,
  Inputs, Voice Invocations con il nome pronunciato dell’app).
- Privacy: l’SDK invia per default analytics e crash report a Meta. Per RayGPT conviene
  disattivarli in `Info.plist` (`MWDAT → Analytics → OptOut = YES`, `MWDAT → CrashReporting → OptOut = YES`).

### 4.4 Sessioni

Stati di una `DeviceSession`: `idle → starting → started ⇄ paused → stopping → stopped`.
Il dispositivo decide le transizioni: un gesto di sistema, un’altra app, “Hey Meta”
(che è una “transazione” di sistema), le stanghette chiuse o la perdita di connessione
possono mettere in pausa o chiudere la sessione. Chiudere le stanghette porta a `stopped`;
riaprirle non riavvia la sessione: ne serve una nuova. Non si riavvia mai durante `paused`.

### 4.5 Audio tramite DAT: cosa offre davvero

- L’audio è un’**estensione sperimentale dello stream della fotocamera**, non una capability
  a sé: per ricevere PCM bisogna avere uno stream camera attivo
  (`StreamConfiguration(videoCodec:audioCodec:.pcm(sampleRate: .rate16000, numberOfChannels: 1) …)`).
- Sample rate supportati: 16 000, 44 100, 48 000 Hz. Frame con timestamp.
- Servono i permessi **camera e microfono** e l’approvazione Audio Streaming nel Developer Center.
- Secondo la guida iOS lo streaming della camera passa da un **collegamento Wi-Fi diretto** con gli
  occhiali (permessi Rete locale e HotspotConfiguration); senza, l’integrazione resta su
  Bluetooth LE ma senza streaming.
- **Solo ingresso**: il toolkit non offre un canale per riprodurre audio negli occhiali.
  L’uscita passa comunque dal Bluetooth di iOS (A2DP o HFP).
- Conseguenze per un assistente vocale: fotocamera attiva per tutta la conversazione
  (LED di privacy acceso, da verificare), consumo di batteria e calore (`StreamError.thermalHot`,
  `.batteryLow`), nessuna cancellazione d’eco tra microfono DAT e altoparlanti A2DP.
- Vantaggio: il codice di esempio Meta (BirdSpotter) nota che il microfono degli occhiali via
  DAT “non è un registratore” per iOS, quindi può essere aperto anche quando iOS non
  permetterebbe di aprire il microfono del telefono (per esempio con il telefono bloccato in tasca).

### 4.6 Speech

Trascrizione on-device sperimentale (`MWDATSpeech`). Non sostituisce l’audio grezzo,
ma può servire per comandi locali (“stop”, “ricomincia”), debug e fallback.

### 4.7 Voice Invocations (“Hey Meta, start …”)

- Permette a Meta AI di **avviare o portare in primo piano** l’app quando l’utente dice
  “Hey Meta, start {nome app}”. Se l’app non è in esecuzione, il comando la avvia (cold launch).
- Si configura nel Developer Center: bundle identifier, **nome dell’app usato come parola chiave**
  dal riconoscimento vocale (Meta consiglia di non usare “AI” nel nome), poi una nuova versione
  dell’integrazione che include il permesso Voice Invocation. Non richiede permessi
  camera/microfono né una `DeviceSession`. Quindi **richiede l’accesso al Developer Center**.
- All’avvio l’app apre un `VoiceInvocationsStream` (dopo la registrazione) e risponde a
  **ogni** `LaunchApp` esattamente una volta con `sendSuccess`/`sendFailure`; altrimenti Meta AI
  mostra l’app come “non risponde”.
- Sperimentale: utilizzabile in sviluppo e beta, non in produzione.
- Da verificare: cosa succede **con iPhone bloccato** (“portare in primo piano” un’app non è
  possibile a schermo bloccato: forse l’app viene avviata in background, forse serve sbloccare),
  se un’app avviata così può aprire il microfono (vedi §6.4), lingua del comando
  (“start” in inglese o “avvia” in italiano).

### 4.8 Inputs

Eventi dai controlli degli occhiali (sperimentale, richiede approvazione). Possibile uso:
tocco sulla stanghetta per avviare/fermare la conversazione o fare push-to-talk,
alternativa a “Hey Meta” se le Voice Invocations non fossero disponibili.

---

## 5. Le tre strade per l’audio

La v1.0 considerava due strade (DAT e Bluetooth). La revisione ne aggiunge una terza.

### Strada A — Toolkit Meta (PCM dallo stream camera)

Ingresso dal toolkit, uscita via Bluetooth A2DP.
Pro: API ufficiale, microfono disponibile anche a telefono bloccato, possibile integrazione con la camera.
Contro: sperimentale, richiede approvazione Audio Streaming, fotocamera sempre accesa,
batteria e calore, niente eco cancellation, solo ingresso. Con WebRTC serve una sorgente audio
personalizzata (il modulo audio standard di WebRTC legge dal microfono di iOS, non da frame PCM).

### Strada B — Gli occhiali come auricolare Bluetooth (HFP) — **consigliata per l’MVP**

Gli occhiali si comportano come un auricolare: `AVAudioSession` con `.playAndRecord`,
modalità `.voiceChat` e opzione `.allowBluetoothHFP` usa microfono e altoparlanti degli
occhiali, esattamente come una chiamata WhatsApp. **È la stessa tecnica del sample ufficiale
CameraAccess di Meta**, che registra l’audio dei video dal microfono degli occhiali via HFP
(`.allowBluetoothHFP` + `setPreferredInput` sulla porta `bluetoothHFP`), anche con l’app in
background.

Pro: nessuna approvazione Meta, funziona con le API standard di iOS e con il modulo audio
standard di WebRTC, cancellazione d’eco del percorso chiamata, compatibile con CallKit
(background e schermo bloccato), bassa latenza Bluetooth.
Contro: qualità “telefonica” (HFP a 16 kHz, a volte 8 kHz) anche in uscita; non dà da sola
l’attivazione con “Hey Meta”.

### Strada C — Telefonia: “Hey Meta, chiama RayGPT”

Gli occhiali permettono di chiamare a voce (“Hey Meta, chiama {contatto}”). Se funziona anche
per una normale chiamata telefonica verso un contatto della rubrica dell’iPhone (da verificare
con il test T0.3) e “RayGPT” è un contatto con un numero collegato a un modello vocale OpenAI
tramite SIP, si ottengono subito attivazione vocale, schermo bloccato, background e
conversazione continua **senza app iOS e senza Developer Center Meta**.

Pro: tempo di realizzazione minimo, funziona a telefono bloccato, nessuna approvazione.
Contro: qualità audio telefonica, costo del numero e dei minuti, latenza un po’ più alta,
niente fotocamera. Il numero va protetto (accettare solo il proprio numero chiamante, PIN).

Come funzionerebbe (flusso documentato da OpenAI per GPT-Live):

1. Numero telefonico italiano presso un provider VoIP con SIP trunk compatibile
   (segnalazione TLS sulla porta 5061, media SRTP; codec da verificare con il provider).
2. Il trunk inoltra le chiamate a `sip:<id progetto>@sip-eu.api.openai.com;transport=tls`
   (endpoint europeo; quello globale è `sip.api.openai.com`).
3. OpenAI chiama il nostro backend con il webhook `live.transport.incoming`, che contiene
   l’id della sessione e gli header SIP (compreso il numero chiamante).
4. Il backend verifica la firma del webhook e il numero chiamante, poi accetta con
   `POST /v1/live/sessions/{session_id}/accept` (modello, istruzioni, voce) oppure rifiuta con `…/reject`.
5. Facoltativo: il backend si collega in sideband (`…/attach`) per strumenti e log.

Limiti: squillo massimo 3 minuti, chiamata massima 2 ore. GPT-Live SIP va abilitato nel
progetto OpenAI. La stessa cosa si può fare con la Realtime API (webhook `realtime.call.incoming`).
GPT-Live può anche **chiamare** un numero (SIP in uscita): in futuro RayGPT potrebbe richiamare
l’utente, per esempio con il risultato di un compito lungo.

### Confronto

| | A — DAT | B — HFP | C — Telefonia |
|---|---|---|---|
| Microfono occhiali | ✅ (con camera attiva) | ✅ | ✅ |
| Uscita negli occhiali | Via A2DP (fuori dal toolkit) | ✅ | ✅ |
| Eco cancellation | ❌ da gestire | ✅ | ✅ |
| Schermo bloccato | Probabile | ✅ con CallKit (da avviare prima del blocco o via Siri/invocazione) | ✅ |
| Attivazione “Hey Meta” | Con Voice Invocations (approvazione) | Con Voice Invocations (approvazione) | ✅ “chiama RayGPT” |
| Approvazioni Meta | Sì | No (solo per “Hey Meta”) | No |
| Qualità audio | Buona (16–48 kHz) | Telefonica wideband | Telefonica |
| Complessità | Alta | Media | Bassa |

**Raccomandazione.** MVP sulla **Strada B**; prototipo rapido della **Strada C** in parallelo se il
test T0.3 conferma che “Hey Meta, chiama …” funziona; Strada A solo se la B non funziona o
per funzioni future legate alla fotocamera. Il toolkit Meta resta utile per Voice Invocations e Inputs.

---

## 6. Audio su iOS

### 6.1 Configurazione di base (Strada B)

```swift
import AVFoundation

func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    // .voiceChat attiva l’elaborazione vocale di sistema (eco, guadagno, rumore).
    // .allowBluetoothHFP (iOS 26; prima .allowBluetooth) abilita microfono e uscita dell’auricolare.
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP])
    try session.setActive(true)
}
```

Con WebRTC la sessione audio va coordinata con `RTCAudioSession` (che altrimenti la
riconfigura da solo); con CallKit l’audio va attivato solo quando il sistema lo concede
(`provider(_:didActivate:)`), impostando WebRTC in modalità audio manuale.

### 6.2 HFP o A2DP

Con microfono e uscita sugli occhiali, iOS usa HFP in entrambe le direzioni: non si può avere
il microfono degli occhiali con l’uscita A2DP di alta qualità nello stesso momento. A2DP
(`.allowBluetoothA2DP`) porta solo l’uscita e lascia il microfono sul telefono: è la scelta
dell’esempio BirdSpotter di Meta, non la nostra.

### 6.3 Interruzioni e cambi di route

Ascoltare `AVAudioSession.interruptionNotification` e `routeChangeNotification`.
Una chiamata telefonica ferma il motore audio e non lo riavvia: va trattata come fine
o sospensione della conversazione. Se gli occhiali si scollegano l’audio passa al telefono:
meglio mettere in pausa che parlare dall’altoparlante dell’iPhone.

### 6.4 Background e schermo bloccato

- Con la modalità di background `audio` e una sessione audio **già attiva**, l’app continua
  a registrare e riprodurre a schermo bloccato.
- iOS **non permette di avviare la registrazione dal background** (errore `cannotStartRecording`),
  salvo per le chiamate gestite con CallKit.
- **Proposta**: ogni conversazione è una chiamata CallKit verso “RayGPT”. Il sistema la tratta
  come una telefonata VoIP: audio garantito in background, controlli nella schermata di blocco,
  instradamento automatico sull’auricolare, chiusura con il tocco sugli occhiali (gesto HFP
  di fine chiamata, da verificare).
- Nel sample CameraAccess l’anteprima della camera si chiude quando l’app va in background,
  mentre la registrazione (con audio HFP) continua. Per le Voice Invocations servirà verificare
  cosa succede a telefono bloccato.

### 6.5 Eco e auto-interruzione

Gli altoparlanti degli occhiali sono vicini ai microfoni. Se l’eco non viene cancellata,
il modello sente la propria voce e si interrompe da solo. Con HFP l’eco viene gestita dal
percorso chiamata; con DAT + A2DP (Strada A) no. Va misurata nel test M3.

---

## 7. Architettura di RayGPT

### 7.1 Componenti

| Componente | Responsabilità |
|---|---|
| `AudioRouteService` | `AVAudioSession`, route Bluetooth, interruzioni, cambi di route |
| `CallService` | CallKit: avvio/fine conversazione come chiamata, attivazione audio |
| `RealtimeService` | Sessione OpenAI: WebRTC, data channel, eventi, riconnessione |
| `ConversationService` | Logica applicativa e stato della conversazione; non conosce WebRTC né Meta |
| `MetaWearablesService` | Registrazione Meta AI, Voice Invocations, Inputs; audio DAT solo per la Strada A |
| `Telemetry` | Tempi, eventi e metriche (mai audio) |
| Backend | Chiave API, creazione sessioni, autenticazione, limiti di spesa |

`ConversationService` dipende da protocolli: si può testare con un finto `RealtimeService`
e sostituire la sorgente audio (HFP, DAT, microfono del telefono) senza toccare il resto.

```swift
protocol ConversationServiceProtocol {
    var state: AsyncStream<ConversationState> { get }
    func start(trigger: StartTrigger) async throws   // .ui, .voiceInvocation, .glassesInput, .siri
    func stop(reason: StopReason) async
    func interrupt()                                 // barge-in manuale (tocco, comando)
}
```

### 7.2 Struttura del repository

```text
raygpt/
├── ios/              # app SwiftUI (dopo M3)
│   └── RayGPT/{App,Views,Services,Models,Resources}
├── backend/          # Node.js + TypeScript (M4)
│   └── src/{routes,services,middleware,server.ts}
├── spikes/           # prototipi usa e getta (AudioRouteProbe, test SIP)
├── docs/             # PROJECT.md, VERIFICATION.md, REVIEW.md, DECISIONS.md
└── README.md
```

### 7.3 Backend minimale

| Endpoint | Scopo |
|---|---|
| `GET /health` | Stato del servizio |
| `POST /api/session` | Riceve l’SDP offer dall’app, chiama `POST /v1/live/sessions` con istruzioni e voce decise dal backend, restituisce SDP answer e id della sessione |
| `POST /sip/webhook` | Solo Strada C: riceve `live.transport.incoming`, verifica firma e numero chiamante, accetta o rifiuta |
| `GET /` | Pagina web di prova: conversazione con GPT-Live da Safari, senza app iOS |

Implementazione: `backend/` (Node.js, TypeScript, framework Hono), istruzioni in `backend/README.md`.

Le istruzioni e la voce stanno sul backend, non nell’app: si possono cambiare senza
reinstallare RayGPT. Il backend può anche collegarsi in sideband alla sessione per gli strumenti (§3.9).

- Autenticazione: un token lungo e casuale, salvato nel Portachiavi dell’iPhone e confrontato
  dal backend (sufficiente per un solo utente). Mai la chiave OpenAI nell’app.
- Limiti: durata massima per sessione, sessioni al giorno, limite di spesa sul progetto OpenAI.
- Hosting: il backend gira con Node.js (Mac, qualunque server) oppure su **Cloudflare Workers**,
  gratuito e sempre acceso, già configurato (`backend/wrangler.toml`).
  Non serve un database nell’MVP.

---

## 8. Flusso di una conversazione

### 8.1 Avvio

Trigger possibili, in ordine di disponibilità: pulsante nell’app, controllo nel Centro di
Controllo o tasto Azione (App Intent), Siri, tocco sugli occhiali (Inputs), “Hey Meta, start RayGPT”
(Voice Invocations). Poi:

1. `CallService` apre una chiamata CallKit “RayGPT”.
2. Il sistema attiva l’audio; `AudioRouteService` verifica che la route sia quella degli occhiali.
3. `RealtimeService` chiede al backend la sessione e apre WebRTC.
4. Un breve suono conferma che l’assistente ascolta (senza aspettare che parli il modello).

### 8.2 Conversazione e interruzione

L’audio viaggia sulle tracce WebRTC; eventi e trascrizioni sul data channel. Quando
l’utente parla sopra l’assistente è GPT-Live a smettere di parlare e rispondere (full duplex,
§3.5): l’app non deve rilevare la voce né cancellare risposte. Per lo stop manuale
(tocco, pulsante) l’app silenzia l’audio in uscita e invia un’istruzione di stop.

### 8.3 Chiusura

Comando vocale (“basta”, “stop”), tocco sugli occhiali o fine chiamata, timeout di
inattività, disconnessione degli occhiali, errore di rete. Alla chiusura: fermare l’audio,
chiudere la sessione OpenAI e WebRTC, chiudere la chiamata CallKit, rilasciare la sessione
audio, rimuovere i listener.

---

## 9. Stati ed errori

### 9.1 Modello a stati

La catena lineare della v1.0 mescolava cose indipendenti (occhiali, rete, turno di parola).
Meglio quattro stati separati, da cui si ricava lo stato mostrato all’utente:

| Dimensione | Valori |
|---|---|
| Dispositivo | `disconnected`, `connected` (route HFP presente), `unavailable` |
| Audio | `inactive`, `active`, `interrupted` |
| Collegamento OpenAI | `idle`, `connecting`, `connected`, `reconnecting`, `failed` |
| Turno (stimato) | `idle`, `listening`, `userSpeaking`, `assistantSpeaking` |

Esempio: “rete persa mentre l’assistente parlava” è `connected / active / reconnecting / idle`,
non uno stato in più nella catena. GPT-Live non ha eventi di turno: il turno si stima dalle
trascrizioni (che hanno `start_ms`/`end_ms`) e dall’attività della traccia audio in uscita.

### 9.2 Errori

| Problema | Comportamento |
|---|---|
| Occhiali non collegati | Avviso vocale e visivo; non partire dall’altoparlante del telefono |
| Permessi mancanti | Richiederli dall’interfaccia, con spiegazione |
| Route audio sbagliata | Riprovare la route; se fallisce, fermarsi |
| Rete persa | Riconnessione con backoff; avviso sonoro breve |
| Sessione OpenAI chiusa (`session.closed` con `expired` o `connection_lost`) | Nuova sessione; se serve, passare un breve riassunto della conversazione nelle istruzioni |
| Chiusura per filtro di sicurezza (`content`) | Avviso vocale breve, nessuna riapertura automatica |
| Chiamata telefonica / Siri | Sospendere; riprendere solo su richiesta |
| Errore API o limite di spesa | Messaggio comprensibile, anche vocale |

### 9.3 Metriche e log

Registrare solo metadati e tempi, mai l’audio:

- `t_start`: dal trigger a “assistente pronto”;
- `t_response`: dalla fine della frase dell’utente al primo audio riprodotto (la metrica più importante);
- `t_bargein`: da quando l’utente inizia a parlare a quando l’assistente tace;
- riconnessioni, cadute, cambi di route, durata e costo stimato per sessione.

Per `t_response` e `t_bargein` servono i tempi della voce dell’utente: si ricavano dalle
trascrizioni di GPT-Live o da un semplice rilevatore di energia sul microfono, solo per le misure.

---

## 10. Sicurezza e privacy

- **Chiave OpenAI** solo sul backend, in un progetto OpenAI dedicato con limite di spesa.
  Mai nel codice Swift, nel repository, in `Info.plist`, in `UserDefaults` o nel bundle.
- **Accesso al backend** con token personale nel Portachiavi; nella Strada C, accettare solo
  il proprio numero chiamante.
- **Audio e trascrizioni**: nell’MVP non si salva niente; la conversazione vive nella sessione
  e termina alla chiusura. Con `store: false` (il valore predefinito) OpenAI non conserva la
  registrazione della sessione; le altre politiche di conservazione dei dati dell’API vanno lette
  prima dell’uso quotidiano.
- **Telemetria Meta**: opt-out di analytics e crash report in `Info.plist`.
- **Persone intorno**: microfoni sempre in ascolto in luoghi pubblici; la funzione di
  traduzione (sezione 16) registra la voce di altri. Indicatore chiaro quando il microfono è attivo.

---

## 11. Esperienza utente

Interfaccia minima: stato occhiali, stato connessione, Start/Stop, indicatori Listening/Speaking,
trascrizione facoltativa, errori.

Poiché l’utente non guarda lo schermo, lo stato va comunicato **con l’audio**: un suono breve
per “ti ascolto”, uno per “chiuso”, uno per “problema di rete”. Le risposte devono essere
brevi, senza elenchi e senza formattazione, con numeri e unità detti per esteso. Prevedere
un timeout di inattività (per esempio 2 minuti di silenzio): OpenAI non chiude le sessioni
inattive e GPT-Live si paga al minuto. Le trascrizioni (`session.input_transcript.delta`,
`session.output_transcript.delta`) permettono di capire quando nessuno parla.

---

## 12. Roadmap

| Milestone | Obiettivo | Criterio di uscita |
|---|---|---|
| **T0** Test senza codice | Chiamate con gli occhiali, benchmark ChatGPT, “Hey Meta, chiama …” | Tabella di `VERIFICATION.md` compilata |
| **M0** Ambiente | Xcode, iPhone in modalità sviluppatore, sample Meta compilato | Sample installato sull’iPhone |
| **M1** Connessione Meta | Developer Mode, registrazione, sessione `started` | Sessione stabile per 10 minuti |
| **M3** Audio | Probe HFP (B), poi audio DAT (A) | Voce comprensibile in andata e ritorno, anche a schermo bloccato |
| **M4** OpenAI | Backend minimale + conversazione dall’iPhone con la pagina web di prova (Safari), poi con l’app | `t_response` mediano < 1,5 s; voce scelta per l’italiano |
| **M5** Integrazione | Conversazione completa negli occhiali, barge-in | 10 minuti senza auto-interruzioni; `t_bargein` < 0,5 s |
| **M6** Background | CallKit, schermo bloccato, interruzioni | 30 minuti a schermo bloccato senza cadute |
| **M7** Attivazione | Voice Invocations (se approvate) o alternative | Avvio senza toccare il telefono |
| **M8** Estensioni | Visione, strumenti, memoria | — |

Note:

- M2 (fotocamera) della v1.0 diventa facoltativa: serve solo come esercizio del toolkit
  o se si sceglie la Strada A.
- **M4 non dipende dagli occhiali** e può procedere in parallelo a M1–M3: i suoi risultati
  servono comunque. Resta valido il principio della v1.0: niente app completa prima di M3.
- La pagina web di prova anticipa una parte di M5: in Safari, con gli occhiali collegati come
  auricolare, si sentono già qualità della voce, latenza ed eco. Non copre lo schermo bloccato.
- La Strada C è un esperimento separato, di poche ore, da fare se il test T0.3 va bene.

---

## 13. Test plan

**Hardware**: occhiali collegati/scollegati, batteria bassa, stanghette chiuse, cambio
dispositivo Bluetooth, riconnessione.
**Conversazione**: italiano, inglese, cambio lingua, pause a metà frase, interruzioni,
domande consecutive, rumore (strada, mezzi pubblici, vento), voce bassa.
**Rete**: Wi-Fi, rete mobile, rete lenta, perdita temporanea, roaming, sessione scaduta.
**iOS**: primo piano, schermo bloccato, background, chiamata in arrivo, Siri, cambio route, riavvio app.

| Metrica | Obiettivo iniziale |
|---|---|
| `t_start` | < 3 s |
| `t_response` (mediana) | < 1,5 s, poi < 1 s |
| `t_bargein` | < 0,5 s |
| Sessione a schermo bloccato | 30 min senza cadute |
| Auto-interruzioni da eco | 0 in 10 minuti |
| Batteria occhiali | Misurare il consumo per ora di conversazione |

---

## 14. Rischi tecnici

| Rischio | Impatto | Strategia |
|---|---|---|
| Route HFP non usabile da app di terze parti | Alto | Test T0.1 e M3-B; poi Strada A o C |
| Audio DAT legato alla camera (batteria, LED, calore) | Alto | Usarlo solo se la Strada B fallisce |
| Accesso al Developer Center / approvazioni negate | Alto | Strade B e C non ne hanno bisogno; attivazione alternativa |
| “Hey Meta” per app terze solo in inglese o non disponibile in Italia | Medio | Verificare; fallback Strada C, Inputs, Siri, tasto Azione |
| Funzioni sperimentali Meta che cambiano tra release | Medio | Fissare la versione SDK; isolare il codice in `MetaWearablesService` |
| Background iOS | Alto | CallKit; test a schermo bloccato già in M3 |
| Eco e auto-interruzione | Medio | Percorso HFP con elaborazione vocale; misure in M5 |
| WebRTC su iOS (framework esterno, gestione sessione audio) | Medio | Partire da un esempio funzionante; `RTCAudioSession` manuale con CallKit |
| Costi API (al minuto, anche a sessione inattiva) | Medio | Limite di spesa, timeout di inattività, chiusura esplicita |
| Resa dell’italiano delle voci GPT-Live (italiano non elencato tra le lingue delle voci) | Medio | Ascolto comparativo delle voci in M4; in alternativa Realtime API |
| GPT-Live è recente (2026): API e comportamenti possono cambiare | Medio | Isolare il protocollo in `RealtimeService`; seguire il changelog OpenAI |
| Uso all’estero (vedi sotto) | Variabile | Verificare prima del viaggio |
| Provisioning gratuito Apple: app valida 7 giorni | Basso | Programma Apple Developer se l’app diventa d’uso quotidiano |

**Uso all’estero.** Gli esempi del documento parlano di un viaggio a Pechino. Nella Cina
continentale OpenAI e i servizi Meta non sono raggiungibili senza accorgimenti (per esempio
roaming dati di un operatore estero o VPN). Se il progetto deve funzionare durante un
viaggio, conviene verificarlo prima di partire e tenerne conto nelle scadenze.

---

## 15. Costi

Prezzi dalla pagina ufficiale OpenAI al 6 novembre 2026: da ricontrollare prima di fissare il budget.

| Voce | Prezzo |
|---|---|
| GPT-Live `gpt-live-1` | **0,05 $ al minuto**, conteggiato al secondo (3 $ l’ora). Modello di backend e strumenti a parte |
| Realtime `gpt-realtime` | Audio: 32 $ input / 64 $ output per milione di token |
| Realtime `gpt-realtime-mini` | Audio: 10 $ input / 20 $ output per milione di token |
| Traduzione `gpt-realtime-translate` | 0,034 $ al minuto (vedi §16) |

Stime per GPT-Live, solo modello vocale:

| Uso | Minuti al mese | Costo al mese |
|---|---|---|
| 10 minuti al giorno | 300 | circa 15 $ |
| 30 minuti al giorno | 900 | circa 45 $ |
| Viaggio: 2 ore al giorno per 10 giorni | 1 200 | circa 60 $ |

Altre voci: hosting del backend (per un solo utente bastano i piani gratuiti dei servizi citati),
numero telefonico e minuti in ingresso per la Strada C (dipende dal provider), programma
Apple Developer (circa 99 € l’anno) se si vuole evitare la reinstallazione settimanale.

Come tenere sotto controllo la spesa:

- **timeout di inattività** obbligatorio: OpenAI non chiude le sessioni inattive;
- limite di spesa mensile sul progetto OpenAI dedicato;
- chiusura esplicita con “basta” o con il tocco sugli occhiali, senza riaperture automatiche;
- in M4 verificare con `session.usage.updated` come vengono conteggiati i secondi (durata della
  sessione aperta o solo audio).

---

## 16. Sviluppi futuri

- **Visione**: “cosa sto guardando?”. Foto tramite DAT (`Camera.photo`, sperimentale), analizzata
  da un modello con input immagine tramite delegation (`gpt-live-1` non accetta immagini);
  la descrizione torna nella conversazione.
- **Traduzione**: su richiesta o frase per frase. OpenAI ha un modello dedicato alla traduzione
  vocale (`gpt-realtime-translate`, 0,034 $ al minuto). Attenzione alla privacy di chi parla.
- **Richiamata**: con il SIP in uscita di GPT-Live, RayGPT può telefonare all’utente
  (promemoria, risultato di un compito lungo).
- **Contesto**: posizione, viaggio, argomento della conversazione.
- **Strumenti** (tramite delegation, §3.9): meteo, promemoria, calendario, ricerca web, servizi personali.
- **Memoria persistente**: preferenze e fatti salvati esplicitamente, con controllo e cancellazione.

---

## 17. Decisioni

| Area | Decisione | Stato |
|---|---|---|
| Nome | RayGPT | Confermata |
| Hardware | Ray-Ban Meta Gen 1 + iPhone | Confermata |
| App | Swift 6 + SwiftUI | Confermata |
| Audio MVP | Strada B (HFP) | Proposta, da confermare dopo M3 |
| Background | CallKit | Proposta, da verificare in M6 |
| Modello | GPT-Live (`gpt-live-1`) | Proposta, da confermare in M4 (latenza, italiano, costi) |
| Trasporto | WebRTC con SDP tramite backend (l’unico modo per GPT-Live senza esporre la chiave) | Proposta; con la Strada A rivalutare |
| Backend | Node.js + TypeScript, senza database | Confermata |
| Chiave API | Solo backend | Confermata |
| Attivazione | Voice Invocations se approvate; alternative in parallelo | Da verificare |
| Toolkit Meta | Versione fissata (1.0.x), codice isolato | Proposta |

Le decisioni e le domande aperte sono tracciate in [`DECISIONS.md`](DECISIONS.md).

---

## 18. Risorse

**Meta**
- Repository iOS: https://github.com/facebook/meta-wearables-dat-ios
- Documentazione: https://wearables.developer.meta.com/docs/develop/
- Developer Center: https://wearables.developer.meta.com/
- Integrazione iOS: https://wearables.developer.meta.com/docs/develop/dat/build-integration-ios/
- Voice Invocations: https://wearables.developer.meta.com/docs/develop/dat/voice-invocations/
- Compatibilità versioni: https://wearables.developer.meta.com/docs/version-dependencies
- FAQ (dispositivi, Paesi, pubblicazione): https://developers.meta.com/wearables/faq
- Server MCP della documentazione: https://mcp.developer.meta.com/wearables

**OpenAI**
- Guida GPT-Live: https://developers.openai.com/api/docs/guides/live
- WebRTC: https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- WebSocket: https://developers.openai.com/api/docs/guides/voice-websockets?api=live
- Controlli lato server (sideband): https://developers.openai.com/api/docs/guides/voice-server-controls?api=live
- SIP: https://developers.openai.com/api/docs/guides/voice-sip?api=live
- Conversazioni (eventi, contesto, chiusura): https://developers.openai.com/api/docs/guides/live-conversations
- Delegation e strumenti: https://developers.openai.com/api/docs/guides/live-delegation
- Reference API Live: https://developers.openai.com/api/reference/resources/live
- Modello `gpt-live-1`: https://developers.openai.com/api/docs/models/gpt-live-1
- Prezzi: https://developers.openai.com/api/docs/pricing

**Apple**
- AVAudioSession: https://developer.apple.com/documentation/avfaudio/avaudiosession
- CallKit: https://developer.apple.com/documentation/callkit
- App Intents (Siri, tasto Azione, Centro di Controllo): https://developer.apple.com/documentation/appintents

---

## 19. Prossime attività

1. Test senza codice T0.1–T0.4 (`VERIFICATION.md`).
2. Richiedere l’accesso al Meta Wearables Developer Center (i tempi possono essere lunghi).
3. M0–M1 con il sample CameraAccess.
4. M3: probe HFP, poi audio DAT.
5. In parallelo: progetto OpenAI con limite di spesa, backend minimale, M4 con il microfono dell’iPhone.
6. Solo dopo M3: progetto SwiftUI di RayGPT.

---

## 20. Cosa sappiamo e cosa resta da dimostrare

**Documentato (verificato a novembre 2026)**
- OpenAI offre GPT-Live: speech-to-speech full duplex, WebRTC con SDP tramite backend,
  0,05 $ al minuto, telefonia SIP in ingresso e in uscita.
- Il toolkit Meta 1.0.1 supporta i Ray-Ban Meta Gen 1; pubblicazione su App Store non ancora possibile.
- L’audio DAT arriva solo con lo stream camera, è sperimentale e solo in ingresso.
- Le Voice Invocations esistono (“Hey Meta, start {app}”), avviano l’app anche se è chiusa,
  sono sperimentali e si configurano nel Developer Center.
- Con l’opzione HFP, iOS usa il microfono degli occhiali come input: è la tecnica del sample
  ufficiale CameraAccess.

**Da verificare con l’hardware**
- Qualità del microfono via HFP e funzionamento a schermo bloccato.
- “Hey Meta, chiama …” verso un numero arbitrario a telefono bloccato.
- Disponibilità e lingua delle Voice Invocations per il nostro account, in Italia.
- Comportamento di DAT e Voice Invocations con app in background.

**Da sviluppare**
- App iOS, backend, collegamento WebRTC, conversazione continua, barge-in, gestione errori,
  attivazione, strumenti e memoria.

---

> Documento di progettazione: API, requisiti e funzioni sperimentali vanno ricontrollati sulle
> versioni effettivamente usate. Funzionamento in background e avvio con “Hey Meta” non sono
> ancora garantiti.
