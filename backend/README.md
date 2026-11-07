# RayGPT backend

Backend minimale di RayGPT (milestone M4, `docs/PROJECT.md` §7.3):

- crea le sessioni **GPT-Live** via WebRTC tenendo la chiave OpenAI sul server;
- risponde alle **chiamate telefoniche SIP** della Strada C, solo dai numeri autorizzati;
- serve una **pagina web di prova** per parlare con GPT-Live dall’iPhone (anche con gli occhiali
  collegati come auricolare) prima che esista l’app iOS.

## Requisiti

- Node.js 22.9 o successivo (`node --version`)
- Un progetto OpenAI dedicato con fatturazione attiva e una chiave API

## Configurazione

```bash
cd backend
npm install
cp .env.example .env
openssl rand -hex 32   # copia il risultato in APP_TOKEN
```

Nel file `.env` (ignorato da Git) inserire `OPENAI_API_KEY` e `APP_TOKEN`. Le altre voci sono
facoltative e documentate in `.env.example`.

## Avvio sul Mac

```bash
npm run dev        # sviluppo, si riavvia a ogni modifica
# oppure
npm run build && npm start
```

Il server ascolta su `http://localhost:8787`. Aprendo l’indirizzo nel browser del Mac si può
già parlare con GPT-Live usando microfono e altoparlanti del Mac.

## Prova dall’iPhone

Safari permette il microfono solo su HTTPS. Il modo più semplice è un tunnel temporaneo:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8787
```

Il comando stampa un indirizzo `https://….trycloudflare.com`. Sull’iPhone:

1. collegare gli occhiali (come per una telefonata);
2. aprire l’indirizzo in Safari, inserire il token (`APP_TOKEN`), scegliere la voce;
3. premere **Avvia**, consentire il microfono e parlare.

La pagina mostra la trascrizione, il tempo di avvio, una stima del tempo di risposta e i secondi
fatturati. Si chiude da sola dopo il silenzio impostato (predefinito 2 minuti) o dopo la durata
massima (predefinita 20 minuti).

Attenzione: finché il tunnel è attivo l’indirizzo è pubblico. È protetto dal token, ma conviene
chiudere il tunnel (Ctrl+C) quando si finisce. Con lo schermo bloccato Safari sospende la pagina:
per l’uso in tasca serve l’app iOS (milestone M6).

## Pubblicazione su Cloudflare Workers (consigliata)

Per non dipendere dal Mac acceso e dal tunnel, il backend può girare su Cloudflare Workers:
gratuito per un uso personale, sempre acceso, in HTTPS. Serve un account Cloudflare (gratuito).

```bash
cd backend
npm install
npx wrangler login                        # apre il browser per autorizzare
npx wrangler secret put OPENAI_API_KEY    # incolla la chiave quando richiesto
npx wrangler secret put APP_TOKEN         # incolla il token (openssl rand -hex 32)
npm run deploy
```

Il comando stampa l’indirizzo, per esempio `https://raygpt-backend.<tuo-account>.workers.dev`:
aprirlo in Safari sull’iPhone e usare la pagina di prova come sopra, senza tunnel.

- **Pubblicazione automatica:** ogni modifica a `backend/` unita su `main` viene pubblicata da
  GitHub Actions (job `deploy` di `.github/workflows/backend.yml`, secret `CLOUDFLARE_API_TOKEN`).
  Si può anche avviare a mano da GitHub → Actions → backend → Run workflow.
- Voce, modello e limite di sessioni sono in `wrangler.toml` (`[vars]`): basta modificarli e
  unire la modifica su `main`.
- Per la Strada C aggiungere `npx wrangler secret put OPENAI_WEBHOOK_SECRET` e il proprio
  numero in `SIP_CALLER_ALLOWLIST`.
- Log in tempo reale: `npx wrangler tail`.
- Su Workers il limite di sessioni giornaliere vale per singola istanza: il tetto di spesa vero
  resta il credito del progetto OpenAI.
- Prova in locale del Worker: creare `backend/.dev.vars` (ignorato da Git) con le stesse voci
  di `.env`, poi `npm run worker:dev`.

## Ricerca web durante la conversazione (facoltativa)

Con `OPENAI_WEB_SEARCH_MODEL` impostato (in `.env` oppure in `wrangler.toml`), quando servono
informazioni aggiornate (orari, meteo, notizie, eventi, posti vicini) GPT-Live passa la domanda
a un modello di backend che usa lo strumento `web_search` di OpenAI, poi risponde a voce.
Durante la ricerca la pagina di prova e l’app mostrano “Sto cercando…”.

- Valore di esempio: `gpt-5.6-terra` (il modello usato negli esempi della guida OpenAI);
  verificare i modelli disponibili per il proprio progetto.
- Costo a parte rispetto ai minuti vocali: token del modello di backend più le ricerche web
  (pagina prezzi OpenAI). Vuoto = disattivata.

## Il VPS come strumento (facoltativo)

Con `VPS_MCP_URL` e `VPS_MCP_TOKEN` impostati, il modello di backend della ricerca web riceve
anche il server MCP del VPS (cb-gateway): “usa il vps per mandare un messaggio su WhatsApp a…”
diventa un compito per il Claude che gira sul VPS, con il suo browser già loggato e GitHub.

- Richiede `OPENAI_WEB_SEARCH_MODEL`: lo strumento passa dallo stesso modello di backend.
- È OpenAI a chiamare il VPS, con il token come `Authorization: Bearer`; l’app non cambia.
- Un compito può durare un paio di minuti: se non è finito, RayGPT lo dice e controlla quando
  gli si chiede “com’è andata?” (`vps_task_status`).
- Con `WEB_SEARCH_VIA=vps` anche le ricerche web le fa il Claude del VPS al posto dello strumento
  `web_search` di OpenAI: niente costo di ricerca OpenAI, ma risposte in 20-60 secondi invece di 5-10.
- Su Workers l’URL sta in `wrangler.toml`; il token è il secret GitHub `VPS_MCP_TOKEN`, caricato
  dal workflow di deploy con `wrangler secret put` prima di pubblicare.

## Posizione dell’utente

Per domande come “una pizzeria qui vicino” il telefono manda la posizione:

- all’avvio, insieme alla richiesta di sessione (`location: { lat, lon, accuracy }`): il backend la
  traduce in un indirizzo con OpenStreetMap (Nominatim, gratuito) e la aggiunge alle istruzioni;
- durante la conversazione, se l’utente si sposta di almeno 250 m (al massimo una volta al minuto):
  il client chiede l’indirizzo a `POST /api/place` e lo aggiunge al contesto con
  `session.thinking.append`, che non viene detto ad alta voce e non interrompe.

I luoghi vicini li trova lo strumento `nearby` del gateway VPS (OpenStreetMap, circa un secondo).
Le coordinate non finiscono nei log del backend. Per le chiamate SIP la posizione non c’è.

## Endpoint

| Metodo e percorso | Autenticazione | Scopo |
|---|---|---|
| `GET /health` | — | Stato del servizio |
| `GET /api/voices` | — | Voci GPT-Live disponibili e voce predefinita |
| `POST /api/session` | `Authorization: Bearer <APP_TOKEN>` | Riceve `{ "sdp": "<offer>", "voice": "marin" }`, crea la sessione GPT-Live, restituisce `{ "sessionId", "sdp" }` |
| `POST /api/place` | `Authorization: Bearer <APP_TOKEN>` | Riceve `{ "location": { "lat", "lon" } }`, restituisce `{ "address", "lat", "lon" }` |
| `POST /sip/webhook` | Firma del webhook OpenAI | Strada C: accetta o rifiuta le chiamate in arrivo (`live.transport.incoming`) |
| `GET /` | — | Pagina web di prova |

Istruzioni e voce predefinita sono decise dal backend (`src/instructions.ts`, `OPENAI_VOICE`):
si possono cambiare senza toccare l’app.

## Strada C: chiamate telefoniche (facoltativa)

1. Nel progetto OpenAI: abilitare GPT-Live SIP e creare un webhook verso
   `https://<backend>/sip/webhook` per l’evento `live.transport.incoming`.
   Copiare il segreto di firma in `OPENAI_WEBHOOK_SECRET`.
2. In `SIP_CALLER_ALLOWLIST` inserire il proprio numero in formato `+39…`.
   Le chiamate da altri numeri vengono rifiutate; con la lista vuota vengono rifiutate tutte.
3. Presso un provider VoIP, puntare il trunk SIP del numero a
   `sip:<id progetto>@sip-eu.api.openai.com;transport=tls`.

Il backend deve essere raggiungibile da OpenAI in HTTPS in modo stabile (non con un tunnel
temporaneo): per esempio su Cloudflare Workers, con webhook `https://raygpt-backend.<tuo-account>.workers.dev/sip/webhook`.

## Limiti e sicurezza

- La chiave OpenAI non lascia mai il server; l’app riceve solo l’SDP answer.
- `MAX_SESSIONS_PER_DAY` limita le sessioni nelle ultime 24 ore (in memoria: si azzera al riavvio).
  Il limite vero di spesa va impostato nel progetto OpenAI.
- I log contengono solo metadati (id di sessione, tempi, numeri mascherati), mai audio o testo.

## Test

```bash
npm test          # test automatici con OpenAI simulato
npm run typecheck
```
