// RayGPT web test client: connects the browser to GPT-Live over WebRTC through the backend.
// Flow (docs/PROJECT.md §3.3): mic track + "oai-events" data channel → SDP offer → POST /api/session
// → SDP answer → wait for session.started on the data channel.
"use strict";

const PRICE_PER_MINUTE_USD = 0.05;
const CLOSE_TIMEOUT_MS = 3000;
const ICE_GATHERING_TIMEOUT_MS = 10_000;
const NEW_LINE_GAP_MS = 1500;

const $ = (id) => document.getElementById(id);
const ui = {
  token: $("token"), voice: $("voice"), idle: $("idle"), maxMinutes: $("maxMinutes"),
  start: $("start"), mute: $("mute"), stop: $("stop"),
  status: $("status"), stats: $("stats"), transcript: $("transcript"), events: $("events"),
  remote: $("remote"),
};

let session = null;

function newSession() {
  return {
    pc: null, dc: null, mic: null, audio: null,
    clickedAt: performance.now(), startedAt: 0, lastActivityAt: 0,
    seconds: 0, muted: false, closing: false, timer: null, onClosed: null,
    lastSpeaker: null, lastLine: null, lastDeltaAt: 0,
    lastUserDeltaAt: 0, responseTimes: [],
  };
}

// --- Setup -----------------------------------------------------------------

ui.token.value = localStorage.getItem("raygpt.token") ?? "";
ui.idle.value = localStorage.getItem("raygpt.idle") ?? ui.idle.value;
ui.maxMinutes.value = localStorage.getItem("raygpt.maxMinutes") ?? ui.maxMinutes.value;

fetch("/api/voices")
  .then((res) => res.json())
  .then(({ voices, default: fallback }) => {
    const saved = localStorage.getItem("raygpt.voice");
    for (const voice of voices) ui.voice.add(new Option(voice, voice));
    ui.voice.value = voices.includes(saved) ? saved : fallback;
  })
  .catch(() => setStatus("Backend non raggiungibile"));

ui.start.addEventListener("click", () => start().catch((error) => fail(error)));
ui.stop.addEventListener("click", () => stop("close_requested"));
ui.mute.addEventListener("click", toggleMute);

// --- Session lifecycle -----------------------------------------------------

async function start() {
  const token = ui.token.value.trim();
  if (!token) return setStatus("Inserisci il token del backend");
  localStorage.setItem("raygpt.token", token);
  localStorage.setItem("raygpt.voice", ui.voice.value);
  localStorage.setItem("raygpt.idle", ui.idle.value);
  localStorage.setItem("raygpt.maxMinutes", ui.maxMinutes.value);

  session = newSession();
  session.audio = new AudioContext();
  ui.transcript.replaceChildren();
  ui.events.textContent = "";
  setButtons("connecting");
  setStatus("Accesso al microfono…");

  session.mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const [track] = session.mic.getAudioTracks();
  logEvent(`microfono: ${track.label || "sconosciuto"}`);

  const pc = new RTCPeerConnection();
  session.pc = pc;
  pc.ontrack = (event) => {
    ui.remote.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    ui.remote.play().catch(() => setStatus("Tocca la pagina per sentire l’assistente"));
  };
  pc.onconnectionstatechange = () => {
    logEvent(`connessione: ${pc.connectionState}`);
    if (pc.connectionState === "failed") stop("connection_lost");
  };
  pc.addTrack(track, session.mic);

  // The data channel must exist before the offer is created.
  const dc = pc.createDataChannel("oai-events");
  session.dc = dc;
  dc.onmessage = (message) => handleEvent(JSON.parse(message.data));

  setStatus("Creazione della sessione…");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // As in OpenAI's WebRTC guide: send the offer once ICE gathering is complete (or after 10 s).
  await waitForIceGathering(pc, ICE_GATHERING_TIMEOUT_MS);

  const response = await fetch("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: pc.localDescription.sdp, voice: ui.voice.value }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(describeError(response.status, body));

  logEvent(`sessione: ${body.sessionId}`);
  await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
  setStatus("In attesa di GPT-Live…");
}

async function stop(reason) {
  if (!session || session.closing) return;
  session.closing = true;
  setStatus("Chiusura…");

  if (session.dc?.readyState === "open") {
    const closed = new Promise((resolve) => { session.onClosed = resolve; });
    session.dc.send(JSON.stringify({ type: "session.close" }));
    await Promise.race([closed, sleep(CLOSE_TIMEOUT_MS)]);
  }
  cleanup(reason);
}

function cleanup(reason) {
  if (!session) return;
  const current = session;
  session = null;
  clearInterval(current.timer);
  current.mic?.getTracks().forEach((track) => track.stop());
  current.pc?.close();
  ui.remote.srcObject = null;
  if (current.startedAt) beep(current.audio, 440, 0.15);
  setTimeout(() => current.audio?.close(), 500);
  setButtons("idle");
  setStatus(`Chiusa (${describeReason(reason)})`);
  renderStats(current);
}

function fail(error) {
  logEvent(`errore: ${error.message}`);
  cleanup("error");
  setStatus(`Errore: ${error.message}`);
}

function toggleMute() {
  if (!session?.dc || session.dc.readyState !== "open") return;
  session.muted = !session.muted;
  session.mic.getAudioTracks().forEach((track) => { track.enabled = !session.muted; });
  session.dc.send(JSON.stringify({ type: session.muted ? "session.input_audio.mute" : "session.input_audio.unmute" }));
  ui.mute.textContent = session.muted ? "Riattiva microfono" : "Silenzia microfono";
}

// --- GPT-Live events -------------------------------------------------------

function handleEvent(event) {
  if (!session) return;
  const now = performance.now();

  switch (event.type) {
    case "session.started":
      session.startedAt = now;
      session.lastActivityAt = now;
      session.timer = setInterval(checkLimits, 1000);
      setButtons("active");
      setStatus("In ascolto: parla pure");
      beep(session.audio, 880, 0.12);
      break;
    case "session.input_transcript.delta":
      session.lastUserDeltaAt = now;
      appendTranscript("user", event.delta, now);
      break;
    case "session.output_transcript.delta":
      if (session.lastSpeaker === "user" && session.lastUserDeltaAt) {
        session.responseTimes.push(now - session.lastUserDeltaAt);
      }
      appendTranscript("assistant", event.delta, now);
      break;
    case "session.usage.updated":
      session.seconds = event.usage?.seconds ?? session.seconds;
      break;
    case "session.closed":
      session.seconds = event.usage?.seconds ?? session.seconds;
      session.onClosed?.();
      if (!session.closing) cleanup(event.reason);
      return;
    case "error":
      setStatus(`Errore GPT-Live: ${event.error?.message ?? "sconosciuto"}`);
      break;
    // Web search delegated to the backend model (OPENAI_WEB_SEARCH_MODEL).
    case "session.delegation.created":
      session.lastActivityAt = now;
      setStatus("Sto cercando…");
      break;
    case "response.event":
      session.lastActivityAt = now;
      if (["response.completed", "response.failed", "response.incomplete"].includes(event.event?.type)) {
        setStatus("In ascolto: parla pure");
      }
      break;
  }
  const nestedType = event.type === "response.event" ? event.event?.type ?? "" : "";
  if (!event.type.endsWith(".delta") && !nestedType.endsWith(".delta")) logEvent(JSON.stringify(event));
  renderStats(session);
}

function appendTranscript(speaker, text, now) {
  if (!text) return;
  session.lastActivityAt = now;
  const continues = session.lastSpeaker === speaker && now - session.lastDeltaAt < NEW_LINE_GAP_MS;
  if (!continues || !session.lastLine) {
    session.lastLine = document.createElement("p");
    session.lastLine.className = speaker;
    ui.transcript.append(session.lastLine);
  }
  session.lastLine.textContent += text;
  session.lastSpeaker = speaker;
  session.lastDeltaAt = now;
  session.lastLine.scrollIntoView({ block: "end", behavior: "smooth" });
}

function checkLimits() {
  if (!session?.startedAt) return;
  const now = performance.now();
  if (now - session.lastActivityAt > Number(ui.idle.value) * 1000) stop("idle");
  else if (now - session.startedAt > Number(ui.maxMinutes.value) * 60_000) stop("max_duration");
  else renderStats(session);
}

// --- UI helpers ------------------------------------------------------------

function renderStats(current) {
  const parts = [];
  if (current.startedAt) {
    parts.push(`avvio ${seconds(current.startedAt - current.clickedAt)}`);
    const elapsed = (performance.now() - current.startedAt) / 1000;
    if (!current.closing && session === current) parts.push(`durata ${Math.round(elapsed)} s`);
  }
  if (current.responseTimes.length) {
    const sorted = [...current.responseTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    parts.push(`risposta ≈ ${seconds(median)} (mediana su ${sorted.length}, stimata dalle trascrizioni)`);
  }
  if (current.seconds) {
    parts.push(`fatturati ${Math.round(current.seconds)} s ≈ ${(current.seconds / 60 * PRICE_PER_MINUTE_USD).toFixed(3)} $`);
  }
  ui.stats.textContent = parts.join(" · ");
}

function setButtons(state) {
  ui.start.disabled = state !== "idle";
  ui.stop.disabled = state === "idle";
  ui.mute.disabled = state !== "active";
  ui.mute.textContent = "Silenzia microfono";
}

function setStatus(text) {
  ui.status.textContent = text;
}

function logEvent(text) {
  ui.events.textContent = `${new Date().toLocaleTimeString()} ${text}\n${ui.events.textContent}`.slice(0, 20_000);
}

function describeError(status, body) {
  const messages = {
    unauthorized: "token non valido",
    invalid_sdp: "offerta SDP non valida",
    invalid_voice: "voce non valida",
    daily_session_limit: "limite giornaliero di sessioni raggiunto",
  };
  return messages[body.error] ?? body.message ?? `HTTP ${status}`;
}

function describeReason(reason) {
  const reasons = {
    close_requested: "chiusa da te",
    idle: "silenzio prolungato",
    max_duration: "durata massima raggiunta",
    expired: "sessione scaduta",
    content: "filtro di sicurezza",
    remote_hangup: "chiusa da OpenAI",
    connection_lost: "connessione persa",
    error: "errore",
  };
  return reasons[reason] ?? reason ?? "motivo sconosciuto";
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForIceGathering(pc, timeoutMs) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function beep(context, frequency, duration) {
  if (!context || context.state === "closed") return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.15, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.frequency.value = frequency;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}
