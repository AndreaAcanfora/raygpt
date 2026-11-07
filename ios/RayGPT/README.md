# RayGPT per iOS

Prima versione dell’app (milestone M4–M6, `docs/PROJECT.md` §7–8):

- **GPT-Live via WebRTC**: l’app manda l’offerta SDP al backend (`POST /api/session`) e riceve
  la risposta; la chiave OpenAI resta sul backend.
- **Ogni conversazione è una chiamata CallKit** verso “RayGPT”: continua a schermo bloccato,
  compare nella schermata di blocco e si chiude anche da lì.
- **Occhiali come auricolare**: sessione audio `.playAndRecord` / `.voiceChat` con
  `.allowBluetoothHFP` (Strada B).
- **Avvio senza toccare l’app**: comandi Siri e Comandi rapidi “Avvia RayGPT” e “Chiudi RayGPT”,
  assegnabili anche al tasto Azione.
- Trascrizione, silenzia microfono, chiusura dopo il silenzio e durata massima, costo stimato.
- Token del backend salvato nel Portachiavi.

- **“Hey Meta, start RayGPT”** con le Voice Invocations del toolkit Meta (1.0.1, sperimentali):
  avvia la conversazione; “stop RayGPT” o “chiudi RayGPT” la chiude.

> Il codice è stato scritto senza poterlo compilare (non c’era Xcode a disposizione), dopo aver
> verificato le interfacce sugli header della libreria WebRTC 157. Se Xcode segnala errori,
> mandami i messaggi e li correggo.

## Prerequisiti

- Mac con Xcode 26 o successivo, [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- iPhone con iOS 17.2 o successivo, Modalità sviluppatore attiva
- Backend raggiungibile in HTTPS, per esempio su Cloudflare Workers (`backend/README.md`)

## Compilare e installare

```bash
cd ios/RayGPT
xcodegen generate
open RayGPT.xcodeproj
```

In Xcode: target **RayGPT** → **Signing & Capabilities** → **Team** (va bene il Personal Team
gratuito; con quello l’app va reinstallata ogni 7 giorni). Collegare l’iPhone e premere **Run**.
Al primo avvio Xcode scarica la libreria WebRTC (circa 45 MB).

## Configurare

Nell’app, icona ingranaggio:

1. indirizzo del backend, per esempio `https://raygpt-backend.<account>.workers.dev`;
2. token (`APP_TOKEN` del backend);
3. voce (quella scelta con la pagina web di prova), limiti di silenzio e durata.

## Provare

1. Collegare gli occhiali all’iPhone e premere **Avvia**: parte una chiamata “RayGPT” e,
   dopo il segnale “In ascolto”, si parla.
2. La riga sotto lo stato mostra la route audio: ingresso e uscita devono essere gli occhiali
   (`BluetoothHFP`).
3. Bloccare l’iPhone e continuare a parlare.
4. Chiudere con **Chiudi**, dalla schermata di blocco o dicendo “Ehi Siri, chiudi RayGPT”.
5. Per l’avvio a mani libere: “Ehi Siri, avvia RayGPT”, oppure Impostazioni → Tasto Azione →
   Comando rapido → Avvia RayGPT.

Annotare i risultati in `docs/VERIFICATION.md` (Fase 6).

## Attivare “Ehi Meta, avvia Raggio”

1. **Developer Mode** nell’app Meta AI: Impostazioni → Info app → 5 tocchi sul numero di
   versione → Developer Mode → Abilita. Firmware occhiali V128 e app Meta AI V292 o successive.
2. **Wearables Developer Center** (https://wearables.developer.meta.com): creare l’account e
   un’app con bundle identifier `com.andreaacanfora.raygpt.app`, nome dell’app **Raggio**
   (è la parola chiave del comando vocale), e una versione che includa il permesso
   Voice Invocation.
3. Se il Developer Center fornisce `MetaAppID` e `ClientToken`, metterli in
   `Config/RayGPT.local.xcconfig` (ignorato da Git):
   ```
   META_APP_ID = 1234567890
   CLIENT_TOKEN = AR|...
   ```
   e rigenerare il progetto (`xcodegen generate`). Senza, l’app usa il Developer Mode (`META_APP_ID = 0`).
4. Nell’app: ingranaggio → **Occhiali Meta** → **Registra RayGPT in Meta AI**, approvare in Meta AI.
   Lo stato deve diventare “In ascolto di “Ehi Meta, avvia Raggio””.
   Dopo una nuova versione nel Developer Center (per esempio un cambio di nome): **Annulla
   registrazione**, poi registrare di nuovo.
5. Dire **“Ehi Meta, avvia Raggio”**: Meta AI avvia l’app e parte la conversazione.
   Per chiuderla: **“stop Raggio”**.

In Developer Mode resta registrata una sola app di terze parti: registrare RayGPT cancella
la registrazione dei sample Meta, e viceversa. Da verificare: funzionamento a iPhone bloccato
e il comando “chiudi” in italiano.

Il nome nel Developer Center è **Raggio** e non RayGPT: con gli occhiali in italiano
Meta AI trascriveva “RayGPT” come “regbet” e non trovava l’app. Serve una parola che il
riconoscimento vocale nella lingua degli occhiali scriva sempre allo stesso modo.
