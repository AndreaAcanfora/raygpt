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

## Attivare “Ehi Meta, apri l’app Raggio”

Procedura verificata il 7 novembre 2026 (occhiali in italiano), seguendo la risposta di Meta in
https://github.com/meta/meta-wearables-dat-ios/discussions/326.

1. Firmware occhiali V128 e app Meta AI V292 o successive.
2. **Wearables Developer Center** (https://wearables.developer.meta.com): un’app con Team ID
   `PVX9XK893V`, bundle identifier `com.andreaacanfora.raygpt.app` e nome dell’app **Raggio**
   (Product listing: è la parola chiave del comando vocale). Ogni modifica richiede una nuova
   versione, da assegnare al canale **Beta** (Distribute), con il proprio account Meta AI
   invitato. Non esiste un permesso “Voice Invocation” da attivare: è incluso in ogni versione.
3. `MetaAppID` e `ClientToken` del Developer Center in `Config/RayGPT.local.xcconfig`
   (ignorato da Git), poi `xcodegen generate`:
   ```
   META_APP_ID = 1234567890
   CLIENT_TOKEN = AR|...
   ```
4. Nell’app Meta AI il **Developer Mode deve essere spento**: le app registrate in Developer
   Mode (`META_APP_ID = 0`) non si avviano a voce.
5. Nell’app: ingranaggio → **Occhiali Meta** → **Registra Raggio in Meta AI**, approvare in
   Meta AI. Con il Personal Team l’app non può usare l’universal link https del Developer
   Center (serve l’entitlement Associated Domains, solo a pagamento): Meta AI apre la pagina
   `/meta/callback` del backend in Safari. Consegnare la stessa richiesta all’app con
   `xcrun devicectl device process launch --device <UDID> --payload-url
   "raygpt://meta/callback?<parametri della pagina, con + scritto %2B>" com.andreaacanfora.raygpt.app`.
   Dopo una nuova versione nel Developer Center: **Annulla registrazione**, poi registrare di nuovo.
6. App Meta AI → **App connections** → **Raggio** → attivare **Launch with “Hey Meta”**.
   Tenere gli occhiali collegati circa 15 minuti, perché si aggiorni l’elenco delle app.
7. Dire **“Ehi Meta, apri l’app Raggio”**: Meta AI avvia l’app e parte la conversazione.
   Per chiuderla: **“termina Raggio”** (o “chiudi”, “ferma”, “stop”).

Lingua: Meta ha verificato solo l’inglese (US). In italiano funziona “apri l’app Raggio”;
“avvia Raggio” viene preso come richiesta generica o fa partire Spotify. Il nome è **Raggio** e
non RayGPT perché Meta AI trascriveva “RayGPT” come “regbet”: serve una parola sola che il
riconoscimento vocale nella lingua degli occhiali scriva sempre allo stesso modo.
