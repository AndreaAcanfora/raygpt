# Decisioni e domande aperte

Registro leggero delle decisioni di progetto. Ogni decisione ha uno stato:
**proposta** (in attesa di conferma o di un test), **confermata**, **superata**.

## Decisioni

### D-001 — Strada audio per l’MVP: Bluetooth HFP

- **Stato**: proposta, da confermare dopo il test M3-B.
- **Contesto**: l’audio del toolkit Meta arriva solo con lo stream della fotocamera, è
  sperimentale, richiede approvazione e non gestisce l’uscita. Gli occhiali funzionano già
  come auricolare per le chiamate.
- **Decisione**: usare gli occhiali come auricolare HFP tramite `AVAudioSession`
  (`.playAndRecord`, `.voiceChat`, `.allowBluetoothHFP`).
- **Alternative**: Strada A (DAT), Strada C (telefonia). Vedi `PROJECT.md` §5.
- **Da rivedere se**: la route HFP non è disponibile per app di terze parti o la qualità
  della voce non basta al modello.

### D-002 — Conversazione come chiamata CallKit

- **Stato**: proposta, da verificare in M6.
- **Motivazione**: iOS non permette di avviare il microfono dal background; una chiamata
  CallKit ha audio garantito a schermo bloccato e si integra con l’auricolare.

### D-003 — Modello e trasporto OpenAI

- **Stato**: confermata da Andrea il 6 novembre 2026 (GPT-Live). Restano da misurare in M4
  latenza, resa dell’italiano e costo reale.
- **Decisione**: GPT-Live (`gpt-live-1`) via WebRTC. GPT-Live non prevede token temporanei per
  il client, quindi lo scambio SDP passa obbligatoriamente dal backend.
- **Conseguenze**: costo di 0,05 $ al minuto e nessun timeout lato OpenAI, quindi timeout di
  inattività obbligatorio nell’app; niente logica di VAD o barge-in da scrivere (full duplex).
- **Alternativa**: Realtime API (`gpt-realtime`, `gpt-realtime-mini`), a token, con VAD configurabile.
- **Da rivedere se**: si sceglie la Strada A (audio PCM dal toolkit), le voci non rendono bene
  l’italiano, o i costi misurati sono troppo alti.

### D-004 — Versione del toolkit Meta fissata

- **Stato**: proposta.
- **Motivazione**: le funzioni sperimentali possono cambiare tra release minori.
  Aggiornare solo di proposito, leggendo il changelog.

### D-005 — Repository e lingua

- **Stato**: confermata.
- Repository privato. Documentazione in italiano; codice, commenti, commit e pull request in inglese.
- Nessun segreto nel repository (`.env` e file di configurazione locali sono ignorati da Git).

### D-006 — Backend con Hono e pagina web di prova

- **Stato**: confermata.
- **Decisione**: backend Node.js + TypeScript con il framework Hono (API standard `fetch`,
  testabile senza server, trasferibile su altri hosting). Il backend serve anche una pagina web
  che usa lo stesso flusso WebRTC dell’app.
- **Motivazione**: la pagina permette di provare GPT-Live dall’iPhone, anche con gli occhiali come
  auricolare, senza Xcode e prima di M3. L’app iOS userà lo stesso endpoint `POST /api/session`.

### D-007 — Hosting del backend su Cloudflare Workers

- **Stato**: proposta, da confermare al primo deploy.
- **Decisione**: il backend gira anche su Cloudflare Workers (`backend/wrangler.toml`), gratuito
  per un uso personale, sempre acceso e in HTTPS; resta eseguibile con Node.js.
- **Conseguenze**: limite di sessioni e de-duplicazione dei webhook valgono per singola istanza;
  il tetto di spesa vero è il credito del progetto OpenAI.

### D-008 — Ricerca web tramite delegation, facoltativa

- **Stato**: proposta, da provare in M4.
- **Decisione**: con `OPENAI_WEB_SEARCH_MODEL` impostato, GPT-Live delega le domande che
  richiedono informazioni aggiornate a un modello di backend con lo strumento `web_search`
  (Responses delegation, `PROJECT.md` §3.9). Disattivata per default.
- **Motivazione**: in viaggio molte domande riguardano orari, eventi e posti; il modello vocale
  da solo non ha dati aggiornati.
- **Da rivedere se**: latenza o costi della ricerca sono troppo alti per l’uso vocale.

## Domande aperte per Andrea

| # | Domanda | Perché conta |
|---|---|---|
| Q1 | C’è una scadenza, per esempio un viaggio (gli esempi parlano di Pechino)? | Cambia priorità e richiede di verificare l’accesso a OpenAI e Meta dal Paese di destinazione |
| Q2 | Qual è il budget mensile per l’API OpenAI? | Limite di spesa del progetto, scelta del modello, timeout |
| Q3 | Iscrizione al programma Apple Developer (a pagamento)? | Con l’account gratuito l’app va reinstallata ogni 7 giorni |
| Q4 | La qualità audio “da telefonata” (HFP) è accettabile? | Determina se la Strada B basta |
| Q5 | Va bene comprare un numero telefonico per la Strada C? | Costo mensile del numero e dei minuti |
| Q6 | Lingue principali: italiano e inglese? | Istruzioni del modello, test, comando “Hey Meta” |
