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

- Voce, modello e limite di sessioni sono in `wrangler.toml` (`[vars]`); dopo una modifica
  ripetere `npm run deploy`.
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

## Endpoint

| Metodo e percorso | Autenticazione | Scopo |
|---|---|---|
| `GET /health` | — | Stato del servizio |
| `GET /api/voices` | — | Voci GPT-Live disponibili e voce predefinita |
| `POST /api/session` | `Authorization: Bearer <APP_TOKEN>` | Riceve `{ "sdp": "<offer>", "voice": "marin" }`, crea la sessione GPT-Live, restituisce `{ "sessionId", "sdp" }` |
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
