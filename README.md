# RayGPT

Assistente vocale AI per gli occhiali **Ray-Ban Meta Gen 1**: si parla attraverso gli occhiali,
il telefono fa da ponte verso **OpenAI GPT-Live** e la risposta torna negli altoparlanti degli
occhiali. Un’esperienza simile a ChatGPT Advanced Voice, senza prendere in mano il telefono,
anche a schermo bloccato.

Sugli occhiali l’app si chiama **Raggio**: “Ehi Meta, apri l’app Raggio” avvia la conversazione,
“termina Raggio” la chiude.

> **Stato:** in uso personale. Il backend è online su Cloudflare Workers e provato con occhiali
> e iPhone (anche a telefono bloccato); avvio a voce con “Ehi Meta” verificato il 7 novembre 2026
> con gli occhiali in italiano. App Android disponibile (più recente, ancora da provare a fondo).
> Non è distribuito su App Store o Play Store: va compilato da sé.

## Come funziona

```
Occhiali Ray-Ban Meta ──Bluetooth HFP──▶ iPhone / Android ──WebRTC──▶ OpenAI GPT-Live
                                              │                          │
                                              └── POST /api/session ──▶ backend (Cloudflare Workers)
                                                                         │   chiave OpenAI, limiti
                                                                         └── strumenti: ricerca web,
                                                                             meteo, posizione, VPS (MCP)
```

- Gli occhiali fanno da **auricolare Bluetooth**: niente toolkit Meta per l’audio, che funziona
  anche con lo schermo spento. Ogni conversazione è una chiamata CallKit su iOS e un servizio in
  primo piano su Android.
- L’app manda l’offerta SDP al **backend**, che apre la sessione GPT-Live: la chiave OpenAI non
  lascia mai il backend, l’app conosce solo un token condiviso.
- Per le domande che richiedono dati aggiornati GPT-Live **delega** a un modello di testo con
  ricerca web. Facoltativo: un **VPS** collegato via MCP che esegue compiti lunghi (WhatsApp,
  email, siti web, GitHub) e li annuncia a voce quando finiscono.
- Avvio senza mani: “Ehi Meta” (Voice Invocations del toolkit Meta), Siri, Comandi rapidi, tasto
  Azione; su Android scorciatoie e link `raygpt://start`.

## Contenuto del repository

| Cartella | Contenuto |
|---|---|
| [`backend/`](backend/README.md) | Backend TypeScript (Hono): sessioni GPT-Live, ricerca web, VPS, posizione, chiamate SIP, pagina web di prova. Node o Cloudflare Workers |
| [`ios/RayGPT/`](ios/RayGPT/README.md) | App iOS “Raggio”: WebRTC, CallKit, Siri, “Ehi Meta”, storico conversazioni |
| [`android/`](android/README.md) | App Android “Raggio”: WebRTC, servizio in primo piano, scorciatoie, storico |
| [`spikes/AudioRouteProbe/`](spikes/AudioRouteProbe/README.md) | App di prova per l’audio degli occhiali |
| [`docs/`](docs/) | Documento tecnico, test sull’hardware, decisioni |

### Documenti

| File | Contenuto |
|---|---|
| [`docs/PROJECT.md`](docs/PROJECT.md) | Documento tecnico: architettura, strade audio, roadmap, rischi |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Test pratici con occhiali, telefono e Mac |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisioni prese e domande aperte |
| [`docs/REVIEW.md`](docs/REVIEW.md) | Analisi della prima versione del documento tecnico |
| [`docs/archive/`](docs/archive/) | Documento originale v1.0 (PDF) |

## Per iniziare

1. **Backend**: un progetto OpenAI con limite di spesa, poi `backend/` su Cloudflare Workers
   (o con Node sul proprio computer). Istruzioni in [`backend/README.md`](backend/README.md);
   la pagina web servita dal backend permette di provare GPT-Live dal browser del telefono.
2. **App**: iOS con Xcode 26 e XcodeGen ([`ios/RayGPT/README.md`](ios/RayGPT/README.md)), oppure
   Android con JDK 17 e Android SDK ([`android/README.md`](android/README.md)). Nelle
   impostazioni dell’app: indirizzo del backend e token.
3. **Occhiali**: abbinarli al telefono come auricolare Bluetooth. Per “Ehi Meta, apri l’app
   Raggio” serve un’app nel Meta Wearables Developer Center: procedura nel README iOS.

Costo: GPT-Live costa circa 0,05 $ al minuto di conversazione; il backend applica un limite di
sessioni al giorno (`MAX_SESSIONS_PER_DAY`). Cloudflare Workers rientra nel piano gratuito.

## Limiti noti

- Funziona sui **Ray-Ban Meta Gen 1** usati come auricolare; l’avvio a voce dipende dal toolkit
  Meta (sperimentale) e in italiano accetta solo “apri l’app Raggio”.
- Su iOS con il Personal Team gratuito l’universal link di Meta non arriva all’app: il README iOS
  descrive il passaggio manuale da fare una volta.
- Progetto personale: nessuna garanzia, nessun supporto.

## Regole del repository

- **Nessun segreto nel repository**: chiavi API e token restano nei secret di Cloudflare e di
  GitHub o in file locali ignorati da Git (`.env`, `*.local.xcconfig`).
- Documentazione in italiano; codice, commenti, commit e pull request in inglese.
- Versione del toolkit Meta fissata e aggiornata solo leggendo il changelog.
