# Analisi della versione 1.0

Revisione del documento “RayGPT — Documento tecnico di progetto” v1.0 (6 novembre 2026,
in `archive/`). Ogni affermazione tecnica è stata confrontata con il codice e la documentazione
ufficiali disponibili il 6 novembre 2026: repository `facebook/meta-wearables-dat-ios` (SDK 1.0.1),
documentazione del Wearables Developer Center, documentazione API OpenAI.

## Giudizio complessivo

Il documento è **solido nell’impostazione**: individua correttamente che il problema non è
l’AI ma l’audio degli occhiali, vuole verificare l’hardware prima di costruire, separa bene
le responsabilità, tiene la chiave API sul backend e distingue tra documentato, da verificare
e da sviluppare. Sono scelte da mantenere.

I punti deboli sono tre:

1. **Alcuni dettagli tecnici sono imprecisi o superati**, soprattutto su OpenAI (eventi e
   concetti della vecchia Realtime API attribuiti a GPT-Live) e sull’audio del toolkit Meta.
2. **Manca la strada più semplice**: gli occhiali sono già un auricolare Bluetooth, e le
   chiamate “Hey Meta, chiama …” offrono un’attivazione vocale senza approvazioni.
3. **Manca il “come”** per background e schermo bloccato (CallKit), per l’eco e per i
   criteri con cui dire che una milestone è superata.

## Cosa era corretto (confermato)

- Advanced Voice di ChatGPT non è richiamabile da un’app esterna.
- OpenAI offre un modello vocale speech-to-speech con WebRTC; la chiave deve restare sul backend.
- Il flusso con l’SDP inviato al backend, che chiama `POST /v1/live/sessions`, è proprio quello
  documentato per GPT-Live (che non prevede token temporanei per il client).
- Il repository Meta esiste e va usato come punto di partenza; si integra con Swift Package Manager.
- Il toolkit supporta i Ray-Ban Meta Gen 1 (confermato dalla documentazione: “Gen 1 and Gen 2”).
- Audio streaming e Voice Invocations esistono e sono sperimentali; i dettagli citati
  (codec PCM non nullo, listener registrato prima dello start, timestamp, cancellazione prima
  dello stop della camera, risposta a ogni `LaunchApp`) corrispondono alla documentazione.
- Developer Mode è un prerequisito e alcune funzioni richiedono il Developer Center.
- Le funzioni sperimentali non sono garantite per la produzione.

## Errori e informazioni superate

| # | La v1.0 diceva | Verifica | Correzione nella v1.1 |
|---|---|---|---|
| 1 | Eventi `session.created`, `input_audio_buffer.speech_started/stopped`, `conversation.item.created`, `response.created/done`, `response.cancel` per GPT-Live | Sono eventi della **Realtime API**. GPT-Live usa `session.started`, `session.input_transcript.delta`, `session.output_transcript.delta`, `session.usage.updated`, `session.close/closed`, `error`; gli eventi `response.*` esistono solo dentro `response.event` per il lavoro delegato | §3.6 |
| 2 | Server VAD e semantic VAD da configurare; barge-in da implementare fermando e cancellando la risposta | GPT-Live è **full duplex**: nessun parametro di VAD, nessun evento di inizio voce, nessun comando di cancellazione. Il modello gestisce i turni e le interruzioni; il client gestisce solo lo stop manuale | §3.5 |
| 3 | Durata massima della sessione Realtime: 60 minuti | Per GPT-Live non è documentato un massimo generale: ogni sessione ha `expires_at`; contesto di 128 000 token con motore sostitutivo oltre il 90%; chiamate SIP fino a 2 ore. Nessun timeout di inattività lato OpenAI | §3.7 |
| 4 | Function calling e visione “con la Realtime API” | In GPT-Live gli strumenti passano dalla **delegation** (modello di backend o nostro server) e `gpt-live-1` **non accetta immagini** | §3.9, §16 |
| 5 | “Il toolkit prevede una funzionalità di streaming audio” come capability a sé | L’audio è un’**estensione dello stream della fotocamera**: serve la camera attiva, permessi camera + microfono e approvazione; solo ingresso, nessuna uscita verso gli altoparlanti | §4.5 e §5 (Strada A) |
| 6 | Moduli: Core, Camera, Display, MockDevice | Esistono anche `MWDATSpeech`, `MWDATInputs`, `MWDATMotion`, `MWDATMockDeviceTestClient` | §4.2 |
| 7 | Versioni “da verificare” | iOS 17.2+, **Xcode 26.4+**, app Meta AI V292 e firmware V128 per l’SDK 1.0.1 | §2.1, §4.1 |
| 8 | Procedura Developer Mode generica | Meta AI → Impostazioni → Info app → 5 tocchi sul numero di versione → interruttore. Una sola app di terze parti registrata alla volta | §4.3, `VERIFICATION.md` |
| 9 | Esempio con `options: [.allowBluetooth]` | Da iOS 26 l’opzione si chiama `.allowBluetoothHFP` (quella vecchia è deprecata) | §6.1 |
| 10 | Strada A e Strada B come alternative equivalenti | La Strada A non gestisce l’uscita audio e non ha eco cancellation; la B usa il percorso delle chiamate, che gli occhiali già supportano | §5 |
| 11 | Disponibilità per mercato “da considerare” | Developer Center e capability complete solo nei Paesi in cui gli occhiali con Meta AI sono supportati; alcune capability abilitate lato server per singolo utente | §4.1 |

## Cosa mancava

- **Strada B come prima scelta** e **Strada C (telefonia)**, con un confronto tra le tre strade.
- **CallKit** per background e schermo bloccato: iOS non permette di avviare il microfono dal
  background, una chiamata CallKit sì.
- **Eco e auto-interruzione**: altoparlanti e microfoni degli occhiali sono vicini.
- **Il trasporto dipende dalla strada audio**: con la route Bluetooth WebRTC funziona così com’è;
  con i frame PCM del toolkit serve una sorgente audio personalizzata o un altro trasporto.
- **WebRTC su iOS** richiede un framework esterno e il coordinamento con `RTCAudioSession`.
- **Un benchmark a costo zero**: l’app ChatGPT con gli occhiali come auricolare mostra subito
  quanto ci si avvicina all’obiettivo e cosa RayGPT deve aggiungere.
- **Criteri di uscita misurabili** per ogni milestone e definizioni precise delle metriche
  (`t_response`, `t_bargein`).
- **Un modello a stati ortogonale** (dispositivo, audio, rete, turno) al posto della catena lineare.
- **UX senza schermo**: suoni di stato, timeout di inattività, risposte senza formattazione.
- **Privacy verso Meta**: opt-out di analytics e crash report dell’SDK.
- **Account Apple Developer**: con il profilo gratuito l’app scade dopo 7 giorni.
- **Uso all’estero**: gli esempi parlano di Pechino; in Cina OpenAI e Meta non sono raggiungibili
  senza accorgimenti.
- **Costi** con cifre indicative.

## Cosa resta incerto anche dopo la revisione

- Se “Hey Meta, start RayGPT” funziona con l’iPhone bloccato e in quale lingua.
- Se “Hey Meta, chiama …” funziona verso un numero arbitrario senza sbloccare il telefono.
- La qualità della voce via HFP per il modello OpenAI.
- Se il nostro account otterrà le approvazioni Meta necessarie.

Sono tutte domande a cui rispondono i test di [`VERIFICATION.md`](VERIFICATION.md).
