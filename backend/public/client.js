// RayGPT web test client: connects the browser to GPT-Live over WebRTC through the backend.
// Flow (docs/PROJECT.md §3.3): mic track + "oai-events" data channel → SDP offer → POST /api/session
// → SDP answer → wait for session.started on the data channel.
"use strict";

const PRICE_PER_MINUTE_USD = 0.05;
const CLOSE_TIMEOUT_MS = 3000;
const ICE_GATHERING_TIMEOUT_MS = 10_000;
const NEW_LINE_GAP_MS = 1500;
const VPS_POLL_MS = 4000;
/** Seconds before the idle limit when the assistant says it is about to close, and the grace after it. */
const IDLE_WARNING_S = 15;
const IDLE_GRACE_MS = 20_000;
const HISTORY_KEY = "raygpt.history";
const HISTORY_LIMIT = 50;

const $ = (id) => document.getElementById(id);
const ui = {
  token: $("token"), voice: $("voice"), idle: $("idle"), maxMinutes: $("maxMinutes"),
  mic: $("mic"), refreshMics: $("refreshMics"),
  start: $("start"), mute: $("mute"), stop: $("stop"),
  status: $("status"), stats: $("stats"), transcript: $("transcript"), events: $("events"),
  copyEvents: $("copyEvents"), copyStatus: $("copyStatus"),
  history: $("history"), historyDetail: $("historyDetail"), clearHistory: $("clearHistory"),
  remote: $("remote"),
};

let session = null;

function newSession() {
  return {
    pc: null, dc: null, mic: null, audio: null,
    clickedAt: performance.now(), clickedWall: Date.now(), startedAt: 0, lastActivityAt: 0,
    seconds: 0, muted: false, closing: false, timer: null, onClosed: null,
    lastSpeaker: null, lastLine: null, lastDeltaAt: 0,
    lastUserDeltaAt: 0, responseTimes: [],
    token: "", geoWatch: null, sentPosition: null, sentAt: 0,
    sessionId: null, record: newRecord(),
    // VPS tasks of this conversation (rules in docs: VPS polling and announcements).
    vpsTimer: null, vpsBusy: false, delegating: false, lastDelegationEndAt: 0, handled: new Set(),
    idleWarnedAt: 0,
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
ui.refreshMics.addEventListener("click", () => listMicrophones(ui.mic.value, true));
ui.mic.addEventListener("change", () => localStorage.setItem("raygpt.mic", ui.mic.value));
navigator.mediaDevices?.addEventListener?.("devicechange", () => listMicrophones(ui.mic.value));
listMicrophones(localStorage.getItem("raygpt.mic") ?? "");
ui.stop.addEventListener("click", () => stop("close_requested"));
ui.mute.addEventListener("click", toggleMute);
ui.copyEvents.addEventListener("click", copyEvents);
ui.clearHistory.addEventListener("click", () => {
  if (!confirm("Eliminare tutte le conversazioni salvate?")) return;
  writeHistory([]);
  renderHistory();
});
renderHistory();

// --- Session lifecycle -----------------------------------------------------

async function start() {
  const token = ui.token.value.trim();
  if (!token) return setStatus("Inserisci il token del backend");
  localStorage.setItem("raygpt.token", token);
  localStorage.setItem("raygpt.voice", ui.voice.value);
  localStorage.setItem("raygpt.idle", ui.idle.value);
  localStorage.setItem("raygpt.maxMinutes", ui.maxMinutes.value);

  session = newSession();
  session.token = token;
  session.audio = new AudioContext();
  // Ask for the position right away, in parallel with the microphone and the SDP offer.
  const positionPromise = currentPosition();
  ui.transcript.replaceChildren();
  ui.events.textContent = "";
  setButtons("connecting");
  setStatus("Accesso al microfono…");

  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (ui.mic.value) audio.deviceId = { exact: ui.mic.value };
  session.mic = await navigator.mediaDevices.getUserMedia({ audio });
  const [track] = session.mic.getAudioTracks();
  listMicrophones(track.getSettings().deviceId);
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

  const position = await positionPromise;
  if (position) {
    session.sentPosition = position;
    session.sentAt = Date.now();
    logEvent(`posizione: inviata (precisione ${Math.round(position.accuracy)} m)`);
  } else {
    logEvent("posizione: non disponibile");
  }
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: pc.localDescription.sdp, voice: ui.voice.value, location: position ?? undefined }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(describeError(response.status, body));

  session.sessionId = body.sessionId;
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
  clearInterval(current.vpsTimer);
  clearTimeout(current.saveTimer);
  if (current.geoWatch !== null) navigator.geolocation.clearWatch(current.geoWatch);
  current.mic?.getTracks().forEach((track) => track.stop());
  current.pc?.close();
  ui.remote.srcObject = null;
  if (current.startedAt) beep(current.audio, 440, 0.15);
  setTimeout(() => current.audio?.close(), 500);
  setButtons("idle");
  setStatus(`Chiusa (${describeReason(reason)})`);
  renderStats(current);
  logEvent(`chiusura: ${reason ?? "sconosciuto"}`);
  if (current.startedAt) {
    saveRecord(current, reason ?? "closed");
    renderHistory();
  }
  if (current.sessionId || current.startedAt) {
    // Fire and forget: the backend logs why the conversation ended.
    fetch("/api/session/end", {
      method: "POST",
      keepalive: true,
      headers: { Authorization: `Bearer ${current.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: current.sessionId ?? undefined, reason: reason ?? "closed", seconds: current.seconds }),
    }).catch(() => {});
  }
}

// ── Position ────────────────────────────────────────────────────────────
// Sent when the conversation starts; afterwards, a move of MOVE_METRES (at most every
// MOVE_INTERVAL_MS) is added to the session context without interrupting speech.
const MOVE_METRES = 250;
const MOVE_INTERVAL_MS = 60_000;

function currentPosition() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 120_000 },
    );
  });
}

function metres(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function watchPosition() {
  if (!("geolocation" in navigator) || !session) return;
  session.geoWatch = navigator.geolocation.watchPosition((p) => {
    const position = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
    if (!session || session.dc?.readyState !== "open") return;
    const moved = session.sentPosition ? metres(session.sentPosition, position) : Infinity;
    if (moved < MOVE_METRES || Date.now() - session.sentAt < MOVE_INTERVAL_MS) return;
    session.sentPosition = position;
    session.sentAt = Date.now();
    sendPosition(position).catch((error) => logEvent(`posizione: aggiornamento non riuscito (${error.message})`));
  }, () => {}, { enableHighAccuracy: true, maximumAge: 30_000 });
}

async function sendPosition(position) {
  const current = session;
  const response = await fetch("/api/place", {
    method: "POST",
    headers: { Authorization: `Bearer ${current.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ location: position }),
  });
  const place = await response.json().catch(() => ({}));
  if (!response.ok || session !== current || current.dc?.readyState !== "open") return;
  const where = `${place.address ? `${place.address} ` : ""}(lat ${place.lat}, lon ${place.lon})`;
  // thinking.append adds context without being spoken and without interrupting.
  current.dc.send(JSON.stringify({
    type: "session.thinking.append",
    event_id: `pos_${Date.now()}`,
    delegation_id: null,
    content: `The user's position is now ${where}.`,
  }));
  logEvent(`posizione: aggiornata (precisione ${Math.round(position.accuracy)} m)`);
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
      watchPosition();
      session.vpsTimer = setInterval(pollVps, VPS_POLL_MS);
      break;
    case "session.input_transcript.delta":
      session.lastUserDeltaAt = now;
      session.idleWarnedAt = 0;
      appendTranscript("user", event.delta, now);
      if (isStopCommand(session.lastLine?.textContent)) {
        stop("voice_command");
        return;
      }
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
      session.idleWarnedAt = 0;
      session.delegating = true;
      setStatus("Sto cercando…");
      break;
    case "response.event":
      session.lastActivityAt = now;
      if (["response.completed", "response.failed", "response.incomplete"].includes(event.event?.type)) {
        session.delegating = false;
        session.lastDelegationEndAt = Date.now();
        setStatus(session.vpsBusy ? "Il VPS sta lavorando…" : "In ascolto: parla pure");
      }
      break;
  }
  const nestedType = event.type === "response.event" ? event.event?.type ?? "" : "";
  if (!event.type.endsWith(".delta") && !nestedType.endsWith(".delta")) logEvent(JSON.stringify(event));
  renderStats(session);
}

function appendTranscript(speaker, text, now) {
  if (!text) return;
  // After the idle warning the assistant's own words must not keep the conversation open.
  if (speaker === "user" || !session.idleWarnedAt) session.lastActivityAt = now;
  const continues = session.lastSpeaker === speaker && now - session.lastDeltaAt < NEW_LINE_GAP_MS;
  if (!continues || !session.lastLine) {
    session.lastLine = document.createElement("p");
    session.lastLine.className = speaker;
    ui.transcript.append(session.lastLine);
    session.record.lines.push({ speaker, text: "" });
  }
  session.lastLine.textContent += text;
  session.record.lines.at(-1).text += text;
  scheduleSave(session);
  session.lastSpeaker = speaker;
  session.lastDeltaAt = now;
  session.lastLine.scrollIntoView({ block: "end", behavior: "smooth" });
}

function checkLimits() {
  if (!session?.startedAt) return;
  const now = performance.now();
  // Nobody speaks while the VPS works or a delegation runs: that is not silence.
  if (session.vpsBusy || session.delegating || session.muted) {
    session.lastActivityAt = now;
    session.idleWarnedAt = 0;
  }
  const idleMs = Number(ui.idle.value) * 1000;
  if (session.idleWarnedAt && now - session.idleWarnedAt >= IDLE_GRACE_MS) stop("idle");
  else if (now - session.startedAt > Number(ui.maxMinutes.value) * 60_000) stop("max_duration");
  else {
    if (!session.idleWarnedAt && now - session.lastActivityAt >= idleMs - IDLE_WARNING_S * 1000) {
      session.idleWarnedAt = now;
      say("Tell the user, in one short Italian sentence, that you will close the conversation in a few seconds because nobody is speaking, unless they say something.");
      logEvent("silenzio: avviso prima della chiusura");
    }
    renderStats(session);
  }
}

/** Context the model says aloud (unlike thinking.append), e.g. a VPS outcome or the idle warning. */
function say(content) {
  if (session?.dc?.readyState !== "open") return;
  session.dc.send(JSON.stringify({
    type: "session.commentary.append", event_id: `say_${Date.now()}`, delegation_id: null, content,
  }));
}

// ── VPS tasks ───────────────────────────────────────────────────────────
// A task can outlast the 25 s the VPS tool waits: GPT-Live then only hears "still running".
// Polling keeps the conversation open meanwhile and has the outcome said when it is ready.
async function pollVps() {
  const current = session;
  if (!current?.startedAt || current.vpsPolling) return;
  current.vpsPolling = true;
  try {
    const since = new Date(current.clickedWall).toISOString();
    const response = await fetch(`/api/vps/tasks?since=${encodeURIComponent(since)}`, {
      headers: { Authorization: `Bearer ${current.token}` },
    });
    if (response.status === 404) return clearInterval(current.vpsTimer);
    if (!response.ok || session !== current) return;
    const { tasks } = await response.json();
    const busy = tasks.some((t) => t.status === "queued" || t.status === "running");
    if (busy !== current.vpsBusy) {
      current.vpsBusy = busy;
      logEvent(`vps: ${busy ? "al lavoro" : "libero"}`);
      if (busy) setStatus("Il VPS sta lavorando…");
      else if (!current.delegating) setStatus("In ascolto: parla pure");
    }
    for (const task of tasks) {
      if ((task.status !== "done" && task.status !== "failed") || current.handled.has(task.id)) continue;
      if (current.delegating) continue; // the running delegation may still pick it up
      current.handled.add(task.id);
      // Finished after the last delegation ended: the model only heard "still running".
      if (current.lastDelegationEndAt && Date.parse(task.finishedAt) > current.lastDelegationEndAt) {
        say(announcement(task));
        current.lastActivityAt = performance.now();
        current.idleWarnedAt = 0;
        logEvent(`vps: annunciato l'esito di ${task.id}`);
      }
    }
  } catch (error) {
    logEvent(`vps: controllo non riuscito (${error.message})`);
  } finally {
    current.vpsPolling = false;
  }
}

function announcement(task) {
  const outcome = task.status === "failed" ? `it failed: ${task.result ?? "unknown error"}` : task.result ?? "";
  return `The VPS task the user asked for earlier has finished. Request: "${task.instruction.slice(0, 200)}". `
    + `Outcome: ${outcome.slice(0, 1200).replace(/[.\s]+$/, "")}. Tell the user the outcome now, briefly, in Italian.`;
}

// ── History ─────────────────────────────────────────────────────────────
// Conversations are kept in this browser (last HISTORY_LIMIT), saved while they run too.

function newRecord() {
  // Not crypto.randomUUID(): it needs a secure context, and the page may be opened over plain http on a LAN.
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, startedAt: new Date().toISOString(), endedAt: null, reason: null, billedSeconds: 0, lines: [] };
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeHistory(records) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
  } catch {
    // Storage full or disabled: the history is a convenience, the conversation goes on.
  }
}

function saveRecord(current, reason) {
  if (!current.record.lines.length && !reason) return;
  const record = { ...current.record, billedSeconds: current.seconds, reason, endedAt: reason ? new Date().toISOString() : null };
  writeHistory([record, ...readHistory().filter((r) => r.id !== record.id)]);
}

function scheduleSave(current) {
  clearTimeout(current.saveTimer);
  current.saveTimer = setTimeout(() => saveRecord(current, null), 2000);
}

function renderHistory() {
  const records = readHistory();
  ui.history.replaceChildren(...records.map((record) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    const start = new Date(record.startedAt);
    const minutes = record.endedAt ? Math.max(1, Math.round((Date.parse(record.endedAt) - start) / 60_000)) : null;
    const first = record.lines.find((l) => l.speaker === "user")?.text.trim() ?? "";
    button.textContent = `${start.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}`
      + `${minutes ? ` · ${minutes} min` : ""} · ${record.reason ? describeReason(record.reason) : "interrotta"}`
      + `${first ? ` · ${first.slice(0, 60)}` : ""}`;
    button.addEventListener("click", () => showRecord(record));
    item.append(button);
    return item;
  }));
  ui.clearHistory.disabled = records.length === 0;
}

function showRecord(record) {
  ui.historyDetail.replaceChildren(...record.lines.map((line) => {
    const p = document.createElement("p");
    p.className = line.speaker;
    p.textContent = line.text;
    return p;
  }));
  ui.historyDetail.hidden = false;
}

// --- Voice commands --------------------------------------------------------

// "Stop Raggio" / "Chiudi Raggio" (also "ferma", "termina", "spegni", in either order, and the old name
// "RayGPT") close the conversation. "(?!n)" keeps "ragionare" out.
// Transcripts spell the name in many ways ("Ray GPT", "rei gpt", "Ray gipiti"), so the text is
// folded to lowercase letters and digits before matching.
const STOP_COMMAND =
  /(?:stop+|chiudi|ferma|termina|spegni)(?:r[aeiy]+(?:g|j)[ie]?(?:p|b)[ie]?t|ra[gj]+i?o(?!n))|(?:r[aeiy]+(?:g|j)[ie]?(?:p|b)[ie]?t|ra[gj]+i?o(?!n))(?:stop+|chiudi|ferma|termina|spegni)/;

function isStopCommand(text) {
  if (!text) return false;
  const folded = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return STOP_COMMAND.test(folded);
}

// --- Microphones -----------------------------------------------------------

// Device names are only visible after microphone permission: "Aggiorna" asks for it once.
async function listMicrophones(selected, askPermission = false) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  if (askPermission) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
    } catch {
      return setStatus("Permesso microfono negato");
    }
  }
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  ui.mic.replaceChildren(new Option("Predefinito di sistema", ""));
  inputs.forEach((device, index) => {
    if (device.deviceId === "default" || !device.deviceId) return;
    ui.mic.add(new Option(device.label || `Microfono ${index + 1}`, device.deviceId));
  });
  ui.mic.value = [...ui.mic.options].some((o) => o.value === selected) ? selected : "";
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
  ui.events.textContent = `${new Date().toLocaleTimeString()} ${text}\n${ui.events.textContent}`.slice(0, 200_000);
}

/** Copies the event log, oldest first, to paste it into a bug report. */
async function copyEvents() {
  const text = ui.events.textContent.trim().split("\n").reverse().join("\n");
  if (!text) {
    ui.copyStatus.textContent = "Nessun evento da copiare";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers without the async clipboard API.
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  ui.copyStatus.textContent = `Copiati ${text.split("\n").length} eventi`;
  setTimeout(() => { ui.copyStatus.textContent = ""; }, 3000);
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
    idle: "silenzio",
    max_duration: "durata massima raggiunta",
    expired: "sessione scaduta",
    content: "filtro di sicurezza",
    remote_hangup: "chiusa da OpenAI",
    connection_lost: "connessione persa",
    error: "errore",
    voice_command: "comando vocale",
    call_ended: "chiamata terminata",
    closed: "chiusa da GPT-Live",
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
