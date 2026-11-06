# RayGPT

Assistente vocale AI per gli occhiali **Ray-Ban Meta Gen 1**: si parla attraverso gli occhiali,
l’iPhone fa da ponte verso un modello vocale OpenAI e la risposta torna negli altoparlanti
degli occhiali. Obiettivo: un’esperienza simile a ChatGPT Advanced Voice, senza prendere in
mano il telefono.

> **Stato: verifica hardware e backend.** Il backend con la pagina web di prova è pronto
> ([`backend/`](backend/README.md)); il codice dell’app iOS arriverà dopo il test audio sugli
> occhiali (milestone M3). Uso personale, non destinato all’App Store.

## Documenti

| File | Contenuto |
|---|---|
| [`docs/PROJECT.md`](docs/PROJECT.md) | Documento tecnico v1.1: architettura, strade audio, roadmap, rischi |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Test pratici con occhiali, iPhone e Mac da fare prima di scrivere codice |
| [`docs/REVIEW.md`](docs/REVIEW.md) | Analisi della v1.0: cosa era corretto, cosa era sbagliato o mancava |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisioni prese e domande aperte |
| [`docs/archive/`](docs/archive/) | Documento originale v1.0 (PDF) |
| [`backend/`](backend/README.md) | Backend: sessioni GPT-Live, chiamate SIP, pagina web di prova |
| [`ios/RayGPT/`](ios/RayGPT/README.md) | App iOS: GPT-Live via WebRTC, CallKit, comandi Siri (da compilare) |
| [`spikes/AudioRouteProbe/`](spikes/AudioRouteProbe/README.md) | App di prova per l’audio degli occhiali (M3-B) |

## Il punto in breve

La parte AI è la più semplice. Il rischio vero è **l’audio tra occhiali e iPhone** e
**l’attivazione con “Hey Meta”**. Le strade possibili sono tre:

- **B — gli occhiali come auricolare Bluetooth (HFP)**: consigliata per l’MVP;
- **C — telefonia**: “Hey Meta, chiama RayGPT” verso un numero collegato a OpenAI;
- **A — toolkit Meta**: audio PCM solo con la fotocamera attiva, sperimentale.

Dettagli e confronto in [`docs/PROJECT.md` §5](docs/PROJECT.md#5-le-tre-strade-per-laudio).

## Prossimi passi

1. Test senza codice (Fase 0 di [`VERIFICATION.md`](docs/VERIFICATION.md)): chiamate con gli
   occhiali, benchmark con l’app ChatGPT, “Hey Meta, chiama …”.
2. Account sul Meta Wearables Developer Center.
3. M0–M1: Xcode 26.4+, sample ufficiale Meta sull’iPhone, Developer Mode sugli occhiali.
4. M3: test audio HFP e DAT.
5. In parallelo: progetto OpenAI con limite di spesa, poi prova di GPT-Live dall’iPhone con la
   pagina web del backend (M4, `VERIFICATION.md` Fase 5).

## Regole del repository

- **Nessun segreto nel repository**: chiavi API e token restano sul backend o in file locali
  ignorati da Git (`.env`, `*.local.xcconfig`).
- Documentazione in italiano; codice, commenti, commit e pull request in inglese.
- Versione del toolkit Meta fissata e aggiornata solo leggendo il changelog.
