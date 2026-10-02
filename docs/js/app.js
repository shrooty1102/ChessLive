// Chess Live — main app
import { Chess } from "../vendor/chess.js";
import { Board, pieceSvg } from "./board.js";
import { playMove, unlockAudio, setSoundEnabled } from "./sound.js";

/* ------------------------------------------------------------------ */
/* Constants and state                                                */
/* ------------------------------------------------------------------ */

const APP_NAME = "Chess Live";
const PEER_PREFIX = "chesslive-v1-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_KEY = "chesslive-session";
const NAME_KEY = "chesslive-name";
const HEARTBEAT_MS = 4000;
const STALE_MS = 13000;
const DEFAULT_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };

const $ = (id) => document.getElementById(id);

const S = {
  mode: "lobby", // lobby | online | review
  role: null, // host | guest
  room: null,
  myName: "",
  oppName: "",
  myColor: null, // 'w' | 'b' (guest learns it from the host)
  chess: new Chess(),
  gameId: 1,
  startedAt: null,
  gameOver: null, // { result: '1-0'|'0-1'|'1/2-1/2', reason: string }
  viewPly: null, // null = following the live game
  flipped: false,

  peer: null,
  conn: null,
  call: null,
  connected: false,
  everConnected: false,
  lastSeen: 0,
  reconnectTimer: null,
  heartbeatTimer: null,
  resumed: false,
  leaving: false,

  localStream: null,
  outStream: null,
  hasCam: false,
  hasMic: false,
  camOn: true,
  micOn: true,
  oppCamOn: true,
  oppMicOn: true,

  drawOfferFromOpp: false,
  drawOfferPending: false,
  rematchFromOpp: false,
  rematchPending: false,

  reviewHeaders: null,
};

let board, lobbyBoard;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const other = (c) => (c === "w" ? "b" : "w");
const colorName = (c) => (c === "w" ? "White" : "Black");
const cleanName = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 24);
const cleanCode = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
const initials = (name) =>
  (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

const OPENED_FROM_DISK = location.protocol === "file:";

function inviteUrl() {
  // A file on this computer can't be opened by someone else, so share the code instead.
  if (OPENED_FROM_DISK) return S.room;
  return `${location.origin}${location.pathname.replace(/[^/]*$/, "")}?room=${S.room}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function whiteName() {
  if (S.mode === "review") return S.reviewHeaders?.White || "White";
  return S.myColor === "w" ? S.myName : S.oppName || "Opponent";
}
function blackName() {
  if (S.mode === "review") return S.reviewHeaders?.Black || "Black";
  return S.myColor === "b" ? S.myName : S.oppName || "Opponent";
}
function nameOf(color) {
  return color === "w" ? whiteName() : blackName();
}

/* ------------------------------------------------------------------ */
/* Piece sprite                                                       */
/* ------------------------------------------------------------------ */

async function loadSprite() {
  if (document.getElementById("wk")) return; // already inlined in index.html
  const res = await fetch("assets/pieces.svg");
  const text = await res.text();
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  holder.setAttribute("aria-hidden", "true");
  holder.innerHTML = text.replace(/<\?xml[^>]*>/, "");
  document.body.prepend(holder);
}

/* ------------------------------------------------------------------ */
/* Session (survives a page reload)                                   */
/* ------------------------------------------------------------------ */

function persist() {
  if (S.mode !== "online") return;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        room: S.room, role: S.role, myName: S.myName, oppName: S.oppName,
        myColor: S.myColor, gameId: S.gameId, pgn: S.chess.pgn(), over: S.gameOver,
        startedAt: S.startedAt, flipped: S.flipped,
      })
    );
  } catch {}
}
function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

/* ------------------------------------------------------------------ */
/* Lobby                                                              */
/* ------------------------------------------------------------------ */

function showLobby() {
  S.mode = "lobby";
  $("game").hidden = true;
  $("lobby").hidden = false;
  document.title = `${APP_NAME} — play face to face, from anywhere`;
  const saved = localStorage.getItem(NAME_KEY) || "";
  for (const id of ["createName", "joinName", "inviteName"]) if (!$(id).value) $(id).value = saved;
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== name));
}

function bindLobby() {
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  $("createForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = cleanName($("createName").value);
    if (!name) return $("createName").focus();
    const choice = new FormData(e.target).get("color");
    startAsHost(name, choice);
  });

  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = cleanName($("joinName").value);
    const code = cleanCode($("joinCode").value);
    if (!name) return $("joinName").focus();
    if (code.length !== 6) {
      toast("Game codes are 6 letters and numbers.");
      return $("joinCode").focus();
    }
    startAsGuest(name, code);
  });
  $("joinCode").addEventListener("input", (e) => (e.target.value = cleanCode(e.target.value)));

  $("inviteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = cleanName($("inviteName").value);
    if (!name) return $("inviteName").focus();
    startAsGuest(name, S.room);
  });

  $("notInvited").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    $("invitePanel").hidden = true;
    $("startPanel").hidden = false;
  });

  $("openSaved").addEventListener("click", () => $("savedFile").click());
  $("savedFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    openReview(await file.text());
  });
}

/* ------------------------------------------------------------------ */
/* Media (camera + microphone)                                        */
/* ------------------------------------------------------------------ */

const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

async function startMedia() {
  if (S.localStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("This browser can't use the camera here. Open the game over https to talk with video.", 5000);
    return;
  }
  const video = { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user", frameRate: { ideal: 24 } };
  const audio = MIC_CONSTRAINTS;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio });
  } catch (e1) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      toast("Camera isn't available, so you'll join with voice only.", 4500);
    } catch (e2) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video });
        toast("Microphone isn't available, so you'll join with video only.", 4500);
      } catch (e3) {
        toast("Camera and microphone are blocked. You can still play. To talk, allow them in your browser's site settings and reload.", 7000);
      }
    }
  }
  S.localStream = stream;
  S.hasCam = !!stream?.getVideoTracks().length;
  S.hasMic = !!stream?.getAudioTracks().length;
  S.camOn = S.hasCam;
  S.micOn = S.hasMic;
  if (stream) {
    $("meVideo").srcObject = stream;
    $("meVideo").play().catch(() => {});
  }
  watchMic(stream?.getAudioTracks()[0]);
}

// A microphone can go silent without the page being told: another app (Zoom,
// Teams) takes it, a headset is unplugged, or the system mutes it. The call would
// keep sending a dead track, so the other player hears nothing. Say so and recover.
function watchMic(track) {
  if (!track) return;
  const current = () => S.localStream?.getAudioTracks()[0] === track;
  if (track.muted) toast("Your microphone isn't sending any sound. Check that no other app is using it.", 6000);
  track.addEventListener("mute", () => {
    if (current()) toast("Your microphone stopped sending sound. Check that no other app is using it.", 6000);
  });
  track.addEventListener("ended", () => {
    if (!current()) return;
    toast("Your microphone was disconnected. Reconnecting it…", 4000);
    restartMic();
  });
}

async function restartMic() {
  let fresh;
  try {
    fresh = (await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })).getAudioTracks()[0];
  } catch {}
  if (!fresh || !S.localStream) {
    toast("Couldn't reconnect your microphone. Allow it in your browser's site settings and reload.", 7000);
    S.hasMic = S.micOn = false;
    applyLocalMedia();
    return;
  }
  fresh.enabled = S.micOn;
  for (const st of [S.localStream, S.outStream]) {
    if (!st) continue;
    st.getAudioTracks().forEach((t) => st.removeTrack(t));
    st.addTrack(fresh);
  }
  // Swap the new mic into the live call without restarting it.
  const sender = S.call?.peerConnection?.getSenders().find((x) => x.track?.kind === "audio");
  if (sender) await sender.replaceTrack(fresh).catch((e) => console.warn("replaceTrack failed", e));
  watchMic(fresh);
  toast("Microphone reconnected.");
}

// During a call, type chessLiveDebug() in the browser console (F12) to see whether
// your microphone makes sound and whether that sound is reaching the other player.
window.chessLiveDebug = async function () {
  const mic = S.localStream?.getAudioTracks()[0];
  console.log("Microphone:", mic
    ? { device: mic.label, enabled: mic.enabled, muted: mic.muted, state: mic.readyState }
    : "none, so the call carries silence");
  console.log("Mic button on:", S.micOn, "| Opponent's mic on:", S.oppMicOn);
  const pc = S.call?.peerConnection;
  if (!pc) return console.log("No video/voice call is connected yet.");
  const sent = pc.getSenders().find((x) => x.track?.kind === "audio")?.track;
  console.log("Audio track in the call:", sent
    ? { device: sent.label, sameAsMic: sent === mic, enabled: sent.enabled, muted: sent.muted, state: sent.readyState }
    : "none");
  console.log("Connection:", pc.connectionState, "| ICE:", pc.iceConnectionState);
  const rows = {};
  (await pc.getStats()).forEach((r) => {
    if (r.kind !== "audio") return;
    if (r.type === "media-source") rows["Your mic level (0 to 1)"] = r.audioLevel;
    if (r.type === "outbound-rtp") { rows["Audio packets sent"] = r.packetsSent; rows["Audio bytes sent"] = r.bytesSent; }
    if (r.type === "remote-inbound-rtp") rows["Packets the opponent lost"] = r.packetsLost;
    if (r.type === "inbound-rtp") { rows["Audio packets received"] = r.packetsReceived; rows["Opponent's level (0 to 1)"] = r.audioLevel; }
  });
  console.table(rows);
  console.log("Run it again while talking. 'Audio packets sent' should go up and 'Your mic level' should be above 0.");
};

// Every call carries one audio and one video track so the other side can always
// send theirs back. If we have no camera or mic, a silent / blank stand-in is used.
function outgoingStream() {
  if (S.outStream) return S.outStream;
  const tracks = [];
  const local = S.localStream;
  const a = local?.getAudioTracks()[0];
  const v = local?.getVideoTracks()[0];
  if (a) tracks.push(a);
  else {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      const ctx = new C();
      const dest = ctx.createMediaStreamDestination();
      tracks.push(dest.stream.getAudioTracks()[0]);
    } catch {}
  }
  if (v) tracks.push(v);
  else {
    const canvas = Object.assign(document.createElement("canvas"), { width: 160, height: 90 });
    const g = canvas.getContext("2d");
    g.fillStyle = "#10241e";
    g.fillRect(0, 0, 160, 90);
    const t = canvas.captureStream?.(1).getVideoTracks()[0];
    if (t) tracks.push(t);
  }
  S.outStream = new MediaStream(tracks.filter(Boolean));
  return S.outStream;
}

function applyLocalMedia() {
  S.localStream?.getVideoTracks().forEach((t) => (t.enabled = S.camOn));
  S.localStream?.getAudioTracks().forEach((t) => (t.enabled = S.micOn));
  send({ type: "media", video: S.camOn, audio: S.micOn });
  renderMedia();
}

function stopMedia() {
  S.localStream?.getTracks().forEach((t) => t.stop());
  S.outStream?.getTracks().forEach((t) => t.stop());
  S.localStream = null;
  S.outStream = null;
}

function renderMedia() {
  const mic = $("micBtn"), cam = $("camBtn");
  mic.disabled = !S.hasMic;
  cam.disabled = !S.hasCam;
  mic.setAttribute("aria-pressed", String(S.micOn));
  cam.setAttribute("aria-pressed", String(S.camOn));
  mic.setAttribute("aria-label", S.micOn ? "Turn microphone off" : "Turn microphone on");
  cam.setAttribute("aria-label", S.camOn ? "Turn camera off" : "Turn camera on");
  mic.title = !S.hasMic ? "No microphone available" : S.micOn ? "Microphone on" : "Microphone off";
  cam.title = !S.hasCam ? "No camera available" : S.camOn ? "Camera on" : "Camera off";

  $("meCover").hidden = S.hasCam && S.camOn;
  $("meCoverText").textContent = S.hasCam ? "Camera off" : "No camera";
  $("meAvatar").textContent = initials(S.myName);
  $("meMicBadge").hidden = S.micOn;

  const hasRemote = !!$("oppVideo").srcObject;
  $("oppCover").hidden = S.connected && hasRemote && S.oppCamOn;
  $("oppAvatar").textContent = initials(S.oppName);
  $("oppCoverText").textContent = !S.connected
    ? S.everConnected ? "Reconnecting…" : S.role === "guest" ? "Connecting…" : "Waiting for your opponent"
    : S.oppCamOn ? "Starting video…" : "Camera off";
  $("oppMicBadge").hidden = !S.connected || S.oppMicOn;
  $("waitingInvite").hidden = !(S.mode === "online" && S.role === "host" && !S.everConnected);
}

/* ------------------------------------------------------------------ */
/* Networking (PeerJS / WebRTC)                                       */
/* ------------------------------------------------------------------ */

let peerOptsCache = null;
async function peerOptions() {
  if (peerOptsCache) return peerOptsCache;
  let ice = DEFAULT_ICE;
  let ownServer = false;
  try {
    const r = await fetch("api/config", { cache: "no-store" });
    if (r.ok) {
      const cfg = await r.json();
      if (Array.isArray(cfg.iceServers)) ice = cfg.iceServers;
      ownServer = true;
    }
  } catch {}
  const secure = location.protocol === "https:";
  peerOptsCache = ownServer
    ? {
        host: location.hostname,
        port: Number(location.port) || (secure ? 443 : 80),
        path: "/peerjs",
        secure,
        config: { iceServers: ice },
        debug: 1,
      }
    : { config: { iceServers: ice }, debug: 1 }; // static hosting: use the free public PeerJS service
  return peerOptsCache;
}

function send(msg) {
  if (S.conn && S.conn.open) {
    try { S.conn.send(msg); } catch (e) { console.warn("send failed", e); }
  }
}

async function openHostPeer(attempt = 0) {
  const opts = await peerOptions();
  const peer = new Peer(PEER_PREFIX + S.room, opts);
  S.peer = peer;

  peer.on("open", () => renderAll(false));

  peer.on("connection", (conn) => {
    if (S.conn && S.conn.open && S.conn.peer !== conn.peer && Date.now() - S.lastSeen < STALE_MS) {
      // Two players are already here.
      conn.on("open", () => {
        conn.send({ type: "full" });
        setTimeout(() => conn.close(), 500);
      });
      return;
    }
    const old = S.conn;
    attachConn(conn);
    if (old && old !== conn) try { old.close(); } catch {}
  });

  peer.on("call", (call) => answerCall(call));

  peer.on("disconnected", () => {
    if (!peer.destroyed && !S.leaving) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
  });

  peer.on("error", (err) => {
    console.warn("peer error", err.type, err);
    if (err.type === "unavailable-id") {
      // The code is still held by our previous page (after a reload) or, rarely, by another game.
      peer.destroy();
      if (S.resumed && attempt < 12) {
        setStatus("Reopening your game…");
        setTimeout(() => openHostPeer(attempt + 1), 2500);
      } else if (!S.resumed) {
        S.room = newCode();
        history.replaceState(null, "", `?room=${S.room}`);
        renderAll(false);
        openHostPeer(0);
      } else {
        toast("This game is open in another tab or window.", 6000);
      }
    } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
      setStatus("Can't reach the game server. Retrying…");
      if (!S.leaving) setTimeout(() => {
        if (peer.destroyed) openHostPeer(attempt + 1);
        else if (peer.disconnected) peer.reconnect();
      }, 3000);
    } else if (err.type === "browser-incompatible") {
      toast("This browser doesn't support video calls. Try the latest Chrome, Edge, Firefox or Safari.", 8000);
    }
  });
}

async function openGuestPeer() {
  const opts = await peerOptions();
  const peer = new Peer(opts);
  S.peer = peer;

  peer.on("open", () => connectToHost());
  peer.on("call", (call) => answerCall(call));
  peer.on("disconnected", () => {
    if (!peer.destroyed && !S.leaving) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
  });
  peer.on("error", (err) => {
    console.warn("peer error", err.type, err);
    if (err.type === "peer-unavailable") {
      if (!S.everConnected) {
        noGameFound();
      } else {
        scheduleReconnect();
      }
    } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
      setStatus("Can't reach the game server. Retrying…");
      scheduleReconnect();
    } else if (err.type === "browser-incompatible") {
      toast("This browser doesn't support video calls. Try the latest Chrome, Edge, Firefox or Safari.", 8000);
    }
  });
}

let notFoundTries = 0;
function noGameFound() {
  // The host may still be connecting (or reloading). Try a few times before giving up.
  notFoundTries++;
  if (notFoundTries < 4) {
    setStatus("Looking for the game…");
    setTimeout(connectToHost, 2500);
    return;
  }
  leaveGame({ silent: true });
  toast(`No open game with code ${S.room}. Check the code, or ask for a new link.`, 7000);
}

function connectToHost() {
  if (!S.peer || S.peer.destroyed || S.leaving) return;
  if (S.peer.disconnected) { S.peer.reconnect(); return; }
  const conn = S.peer.connect(PEER_PREFIX + S.room, { reliable: true, serialization: "json" });
  attachConn(conn);
}

function scheduleReconnect() {
  if (S.role !== "guest" || S.leaving || S.reconnectTimer) return;
  S.reconnectTimer = setTimeout(() => {
    S.reconnectTimer = null;
    if (!S.connected && !S.leaving) {
      connectToHost();
      scheduleReconnect();
    }
  }, 3000);
}

function attachConn(conn) {
  S.conn = conn;
  conn.on("open", () => {
    if (S.conn !== conn) return;
    S.lastSeen = Date.now();
    if (S.role === "guest") {
      send({
        type: "hello", v: 1, name: S.myName, gameId: S.gameId, pgn: S.chess.pgn(),
        over: S.gameOver, plies: S.chess.history().length, hadColor: S.myColor,
      });
      placeCall();
    }
    startHeartbeat();
  });
  conn.on("data", (d) => {
    if (S.conn !== conn) return;
    S.lastSeen = Date.now();
    handleMessage(d);
  });
  conn.on("close", () => {
    if (S.conn !== conn) return;
    onConnectionLost();
  });
  conn.on("error", (e) => console.warn("conn error", e));
}

function startHeartbeat() {
  clearInterval(S.heartbeatTimer);
  S.heartbeatTimer = setInterval(() => {
    if (!S.conn) return;
    send({ type: "ping" });
    if (S.connected && Date.now() - S.lastSeen > STALE_MS) {
      try { S.conn.close(); } catch {}
      onConnectionLost();
    }
  }, HEARTBEAT_MS);
}

function onConnected() {
  const first = !S.connected;
  S.connected = true;
  S.everConnected = true;
  notFoundTries = 0;
  clearTimeout(S.reconnectTimer);
  S.reconnectTimer = null;
  if (!S.startedAt) S.startedAt = new Date().toISOString();
  send({ type: "media", video: S.camOn, audio: S.micOn });
  if (first) playMove("notify");
  persist();
  renderAll(false);
}

function onConnectionLost() {
  if (!S.connected && S.conn === null) return;
  const was = S.connected;
  S.connected = false;
  S.drawOfferFromOpp = S.drawOfferPending = false;
  S.rematchFromOpp = S.rematchPending = false;
  S.conn = null;
  try { S.call?.close(); } catch {}
  S.call = null;
  $("oppVideo").srcObject = null;
  if (was && !S.leaving) toast(`${S.oppName || "Your opponent"} disconnected. Waiting for them to come back…`, 4000);
  scheduleReconnect();
  renderAll(false);
}

function placeCall() {
  if (!S.peer || S.peer.destroyed) return;
  const call = S.peer.call(PEER_PREFIX + S.room, outgoingStream());
  if (call) bindCall(call);
}

function answerCall(call) {
  if (S.call && S.call !== call) try { S.call.close(); } catch {}
  call.answer(outgoingStream());
  bindCall(call);
}

function bindCall(call) {
  S.call = call;
  call.on("stream", (remote) => {
    if (S.call !== call) return;
    const v = $("oppVideo");
    v.srcObject = remote;
    v.play()
      .then(() => ($("enableAudio").hidden = true))
      .catch(() => ($("enableAudio").hidden = false));
    renderMedia();
  });
  call.on("close", () => {
    if (S.call !== call) return;
    S.call = null;
    $("oppVideo").srcObject = null;
    renderMedia();
  });
  call.on("error", (e) => console.warn("call error", e));
}

/* ------------------------------------------------------------------ */
/* Messages                                                           */
/* ------------------------------------------------------------------ */

function pgnPlies(pgn) {
  const c = new Chess();
  try { c.loadPgn(pgn || ""); return c; } catch { return null; }
}
function isPrefix(shortHist, longHist) {
  return shortHist.every((m, i) => longHist[i] === m);
}

function handleMessage(d) {
  if (!d || typeof d !== "object") return;
  switch (d.type) {
    case "ping":
      break;

    case "hello": {
      if (S.role !== "host") return;
      S.oppName = cleanName(d.name) || "Opponent";
      // If the guest has a longer copy of this same game (e.g. we reloaded), take it.
      if (d.gameId === S.gameId) {
        const theirs = pgnPlies(d.pgn);
        const mine = S.chess.history();
        if (theirs && theirs.history().length > mine.length && isPrefix(mine, theirs.history())) {
          S.chess = theirs;
        }
        if (!S.gameOver && d.over) S.gameOver = d.over;
      }
      send({
        type: "state", hostName: S.myName, hostColor: S.myColor, gameId: S.gameId,
        pgn: S.chess.pgn(), over: S.gameOver, startedAt: S.startedAt,
      });
      onConnected();
      break;
    }

    case "state": {
      if (S.role !== "guest") return;
      S.oppName = cleanName(d.hostName) || "Opponent";
      S.myColor = other(d.hostColor);
      if (d.startedAt) S.startedAt = d.startedAt;
      const theirs = pgnPlies(d.pgn) || new Chess();
      if (d.gameId !== S.gameId || theirs.history().length >= S.chess.history().length) {
        S.chess = theirs;
        S.gameOver = d.over || null;
      }
      S.gameId = d.gameId;
      S.viewPly = null;
      onConnected();
      if (S.gameOver) showResult(false);
      break;
    }

    case "move": {
      if (d.gameId !== S.gameId) return;
      const hist = S.chess.history({ verbose: true });
      if (d.ply === hist.length) {
        if (!applyMove({ from: d.from, to: d.to, promotion: d.promotion }, false)) send({ type: "syncReq" });
      } else if (d.ply < hist.length && hist[d.ply]?.from === d.from && hist[d.ply]?.to === d.to) {
        // duplicate, ignore
      } else {
        send({ type: "syncReq" });
      }
      break;
    }

    case "syncReq":
      send({ type: "sync", gameId: S.gameId, pgn: S.chess.pgn(), over: S.gameOver });
      break;

    case "sync": {
      if (d.gameId !== S.gameId) return;
      const theirs = pgnPlies(d.pgn);
      if (!theirs) return;
      const mineLen = S.chess.history().length;
      if (theirs.history().length >= mineLen) {
        S.chess = theirs;
        if (d.over) S.gameOver = d.over;
        renderAll(false);
        persist();
      } else {
        send({ type: "sync", gameId: S.gameId, pgn: S.chess.pgn(), over: S.gameOver });
      }
      break;
    }

    case "media":
      S.oppCamOn = !!d.video;
      S.oppMicOn = !!d.audio;
      renderMedia();
      break;

    case "resign":
      if (d.gameId !== S.gameId || S.gameOver) return;
      finishGame({
        result: S.myColor === "w" ? "1-0" : "0-1",
        reason: `${S.oppName} resigned`,
      });
      break;

    case "drawOffer":
      if (S.gameOver) return;
      S.drawOfferFromOpp = true;
      playMove("notify");
      renderOffer();
      break;
    case "drawAccept":
      if (!S.drawOfferPending || S.gameOver) return;
      S.drawOfferPending = false;
      finishGame({ result: "1/2-1/2", reason: "Draw agreed" });
      break;
    case "drawDecline":
      S.drawOfferPending = false;
      toast(`${S.oppName} declined the draw.`);
      renderAll(false);
      break;

    case "rematchOffer":
      S.rematchFromOpp = true;
      playMove("notify");
      renderOffer();
      if ($("resultDialog").open) $("resultRematch").textContent = "Accept rematch";
      break;
    case "rematchAccept":
      if (!S.rematchPending) return;
      startNextGame();
      break;
    case "rematchDecline":
      S.rematchPending = false;
      toast(`${S.oppName} doesn't want a rematch right now.`);
      renderAll(false);
      break;

    case "leave":
      toast(`${S.oppName || "Your opponent"} left the game.`, 5000);
      break;

    case "full":
      leaveGame({ silent: true });
      toast("That game already has two players.", 6000);
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Game rules and flow                                                */
/* ------------------------------------------------------------------ */

function applyMove(m, local) {
  let mv;
  try {
    mv = S.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  } catch {
    return null;
  }
  if (!S.startedAt) S.startedAt = new Date().toISOString();
  S.viewPly = null;
  S.drawOfferFromOpp = false; // a move answers an open draw offer
  if (local) {
    send({ type: "move", gameId: S.gameId, ply: S.chess.history().length - 1, from: mv.from, to: mv.to, promotion: mv.promotion });
  } else if (document.hidden) {
    document.title = `Your move — ${APP_NAME}`;
  }
  const kind = S.chess.inCheck() ? "check" : mv.captured ? "capture" : mv.flags.includes("k") || mv.flags.includes("q") ? "castle" : "move";
  playMove(kind);
  checkGameEnd(mv.color);
  persist();
  renderAll(true);
  return mv;
}

function checkGameEnd(mover) {
  const c = S.chess;
  let over = null;
  if (c.isCheckmate()) over = { result: mover === "w" ? "1-0" : "0-1", reason: "Checkmate" };
  else if (c.isStalemate()) over = { result: "1/2-1/2", reason: "Stalemate" };
  else if (c.isInsufficientMaterial()) over = { result: "1/2-1/2", reason: "Not enough pieces left to checkmate" };
  else if (c.isThreefoldRepetition()) over = { result: "1/2-1/2", reason: "Same position three times" };
  else if (c.isDrawByFiftyMoves()) over = { result: "1/2-1/2", reason: "Fifty moves without a capture or pawn move" };
  if (over) finishGame(over);
}

function finishGame(over) {
  S.gameOver = over;
  S.drawOfferFromOpp = S.drawOfferPending = false;
  playMove("end");
  persist();
  renderAll(false);
  setTimeout(() => showResult(true), 350);
}

function resultScore(result) {
  return { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½" }[result] || "*";
}

function resultHeadline() {
  const r = S.gameOver?.result;
  if (!r) return "";
  if (r === "1/2-1/2") return "Draw";
  const winner = r === "1-0" ? "w" : "b";
  if (S.mode === "online") return winner === S.myColor ? "You won" : `${S.oppName || "Your opponent"} won`;
  return `${colorName(winner)} won`;
}

function showResult() {
  if (!S.gameOver) return;
  $("resultScore").textContent = resultScore(S.gameOver.result);
  $("resultTitle").textContent = resultHeadline();
  $("resultText").textContent = S.gameOver.reason;
  $("resultRematch").hidden = S.mode !== "online";
  $("resultRematch").disabled = !S.connected || S.rematchPending;
  $("resultRematch").textContent = S.rematchFromOpp ? "Accept rematch" : S.rematchPending ? "Rematch offered" : "Play again";
  if (!$("resultDialog").open) $("resultDialog").showModal();
}

function offerRematch() {
  if (!S.connected) return;
  if (S.rematchFromOpp) {
    send({ type: "rematchAccept" });
    startNextGame();
    return;
  }
  S.rematchPending = true;
  send({ type: "rematchOffer" });
  toast(`Rematch offered. Waiting for ${S.oppName}…`);
  showResult();
  renderAll(false);
}

function startNextGame() {
  S.gameId += 1;
  S.myColor = other(S.myColor);
  S.chess = new Chess();
  S.gameOver = null;
  S.viewPly = null;
  S.flipped = false;
  S.startedAt = new Date().toISOString();
  S.rematchFromOpp = S.rematchPending = false;
  S.drawOfferFromOpp = S.drawOfferPending = false;
  if ($("resultDialog").open) $("resultDialog").close();
  persist();
  renderAll(false);
  toast(`New game. You're playing ${colorName(S.myColor)}.`);
}

/* ------------------------------------------------------------------ */
/* Starting, resuming and leaving                                     */
/* ------------------------------------------------------------------ */

function enterGame() {
  $("lobby").hidden = true;
  $("game").hidden = false;
  window.scrollTo(0, 0);
  $("game").classList.toggle("mode-review", S.mode === "review");
  $("leaveBtn").textContent = S.mode === "review" ? "Close" : "Leave";
  $("inviteUrl").value = S.room ? inviteUrl() : "";
  $("waitingInvite").querySelector(".waiting-text").textContent = OPENED_FROM_DISK
    ? "Send them this game code. They open Chess Live, choose Join with a code, and enter it."
    : "Send them this link. The game starts as soon as they join.";
  $("shareLink").hidden = !navigator.share;
  setSoundButtons();
  renderMedia();
  renderAll(false);
}

async function startAsHost(name, choice) {
  unlockAudio();
  localStorage.setItem(NAME_KEY, name);
  Object.assign(S, {
    mode: "online", role: "host", room: newCode(), myName: name, oppName: "",
    myColor: choice === "r" ? (crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "w" : "b") : choice,
    chess: new Chess(), gameId: 1, gameOver: null, viewPly: null, startedAt: null, resumed: false, leaving: false,
  });
  history.replaceState(null, "", `?room=${S.room}`);
  enterGame();
  setStatus("Turning on your camera…");
  await startMedia();
  renderMedia();
  persist();
  await openHostPeer();
  renderAll(false);
}

async function startAsGuest(name, code) {
  unlockAudio();
  localStorage.setItem(NAME_KEY, name);
  Object.assign(S, {
    mode: "online", role: "guest", room: code, myName: name, oppName: "",
    myColor: null, chess: new Chess(), gameId: 1, gameOver: null, viewPly: null, resumed: false, leaving: false,
  });
  history.replaceState(null, "", `?room=${S.room}`);
  enterGame();
  setStatus("Turning on your camera…");
  await startMedia();
  renderMedia();
  await openGuestPeer();
  renderAll(false);
}

async function resume(sess) {
  Object.assign(S, {
    mode: "online", role: sess.role, room: sess.room, myName: sess.myName, oppName: sess.oppName || "",
    myColor: sess.myColor, gameId: sess.gameId || 1, gameOver: sess.over || null,
    startedAt: sess.startedAt, flipped: !!sess.flipped, resumed: true, leaving: false,
  });
  S.chess = pgnPlies(sess.pgn) || new Chess();
  enterGame();
  await startMedia();
  renderMedia();
  if (S.role === "host") await openHostPeer();
  else await openGuestPeer();
  renderAll(false);
}

function leaveGame({ silent = false } = {}) {
  S.leaving = true;
  if (!silent) send({ type: "leave" });
  clearInterval(S.heartbeatTimer);
  clearTimeout(S.reconnectTimer);
  S.reconnectTimer = null;
  setTimeout(() => {
    try { S.call?.close(); } catch {}
    try { S.conn?.close(); } catch {}
    try { S.peer?.destroy(); } catch {}
    S.peer = S.conn = S.call = null;
  }, silent ? 0 : 250);
  stopMedia();
  $("oppVideo").srcObject = null;
  $("meVideo").srcObject = null;
  clearSession();
  Object.assign(S, {
    connected: false, everConnected: false, room: null, role: null, oppName: "",
    drawOfferFromOpp: false, drawOfferPending: false, rematchFromOpp: false, rematchPending: false,
  });
  if ($("resultDialog").open) $("resultDialog").close();
  history.replaceState(null, "", location.pathname);
  $("invitePanel").hidden = true;
  $("startPanel").hidden = false;
  showLobby();
}

/* ------------------------------------------------------------------ */
/* Review mode (open a saved game)                                    */
/* ------------------------------------------------------------------ */

function openReview(text) {
  const c = new Chess();
  try {
    c.loadPgn(text);
  } catch {
    toast("That file isn't a chess game this app can read. Choose a .pgn file saved from a game.", 6000);
    return;
  }
  const h = c.getHeaders();
  S.mode = "review";
  S.chess = c;
  S.reviewHeaders = h;
  S.myColor = "w";
  S.flipped = false;
  S.viewPly = 0;
  S.room = null;
  S.gameOver = h.Result && h.Result !== "*" ? { result: h.Result, reason: h.Termination || "" } : null;
  enterGame();
  document.title = `${h.White || "White"} vs ${h.Black || "Black"} — ${APP_NAME}`;
}

/* ------------------------------------------------------------------ */
/* Saving                                                             */
/* ------------------------------------------------------------------ */

function pgnDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function buildPgn() {
  if (S.mode === "review") return S.chess.pgn();
  const c = new Chess();
  c.loadPgn(S.chess.pgn());
  c.setHeader("Event", `${APP_NAME} game`);
  c.setHeader("Site", location.host || APP_NAME);
  c.setHeader("Date", pgnDate(S.startedAt));
  c.setHeader("Round", String(S.gameId));
  c.setHeader("White", whiteName());
  c.setHeader("Black", blackName());
  c.setHeader("Result", S.gameOver?.result || "*");
  if (S.gameOver?.reason) c.setHeader("Termination", S.gameOver.reason);
  return c.pgn({ maxWidth: 80 }) + "\n";
}

function fileName() {
  const slug = (s) => (s || "player").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
  const date = pgnDate(S.startedAt).replace(/\./g, "-");
  return `chess-${slug(whiteName())}-vs-${slug(blackName())}-${date}.pgn`;
}

async function saveGame() {
  const pgn = buildPgn();
  const name = fileName();
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "Chess game (PGN)", accept: { "application/x-chess-pgn": [".pgn"] } }],
      });
      const w = await handle.createWritable();
      await w.write(pgn);
      await w.close();
      toast(`Game saved as ${handle.name}`);
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
      // fall through to a normal download
    }
  }
  const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Game saved to your downloads as ${name}`);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function liveHistory() {
  return S.chess.history({ verbose: true });
}

function viewedPly(hist) {
  return S.viewPly === null ? hist.length : Math.max(0, Math.min(S.viewPly, hist.length));
}

function isLive(hist) {
  return S.mode === "online" && (S.viewPly === null || S.viewPly >= hist.length);
}

function orientation() {
  const base = S.myColor || "w";
  return S.flipped ? other(base) : base;
}

function kingSquareInCheck(fen) {
  const c = new Chess(fen);
  if (!c.inCheck()) return null;
  const sq = c.findPiece({ type: "k", color: c.turn() });
  return sq?.[0] || null;
}

function myMovableColor(hist) {
  if (S.mode !== "online" || !S.connected || S.gameOver || !S.myColor) return null;
  if (!isLive(hist)) return null;
  return S.chess.turn() === S.myColor ? S.myColor : null;
}

function renderAll(animate = true) {
  if (S.mode === "lobby" || !board) return;
  const hist = liveHistory();
  const ply = viewedPly(hist);
  const startFen = hist[0]?.before || S.chess.fen();
  const fen = ply === 0 ? startFen : hist[ply - 1].after;
  const last = ply > 0 ? hist[ply - 1] : null;

  board.setOrientation(orientation());
  board.setPosition(fen, { lastMove: last && { from: last.from, to: last.to }, check: kingSquareInCheck(fen), animate });
  board.setMovable(myMovableColor(hist));

  renderMoves(hist, ply);
  renderPlayers(fen);
  renderStatus(hist);
  renderControls(hist, ply);
  renderOffer();
  renderMedia();
  $("roomCode").textContent = S.room || "";
}

function renderMoves(hist, ply) {
  const list = $("moves");
  const rows = [];
  for (let i = 0; i < hist.length; i += 2) {
    const n = i / 2 + 1;
    const w = hist[i], b = hist[i + 1];
    const cell = (m, idx) =>
      m ? `<button type="button" class="move${idx + 1 === ply ? " current" : ""}" data-ply="${idx + 1}">${escapeHtml(m.san)}</button>` : "<span></span>";
    rows.push(`<li class="move-row"><span class="move-no">${n}.</span>${cell(w, i)}${cell(b, i + 1)}</li>`);
  }
  list.innerHTML = rows.join("");
  $("movesEmpty").hidden = hist.length > 0;
  $("movesEmpty").textContent = S.mode === "review" ? "This saved game has no moves." : "White moves first. Moves appear here as they're played.";

  const current = list.querySelector(".move.current");
  if (current) {
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - 36) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  } else if (ply === 0) list.scrollTop = 0;
}

function captureInfo(fen) {
  const counts = { w: {}, b: {} };
  for (const ch of fen.split(" ")[0]) {
    if (!/[pnbrqk]/i.test(ch)) continue;
    const c = ch === ch.toUpperCase() ? "w" : "b";
    const t = ch.toLowerCase();
    counts[c][t] = (counts[c][t] || 0) + 1;
  }
  // pieces of `victim` color that are missing
  const missing = (victim) =>
    ["q", "r", "b", "n", "p"].flatMap((t) => Array(Math.max(0, START_COUNT[t] - (counts[victim][t] || 0))).fill(t));
  const material = (c) => Object.entries(counts[c]).reduce((s, [t, n]) => s + (VALUES[t] || 0) * n, 0);
  return { missing, diff: material("w") - material("b") };
}

function renderCaptures(el, capturerColor, info) {
  const victims = info.missing(other(capturerColor));
  const adv = capturerColor === "w" ? info.diff : -info.diff;
  el.innerHTML =
    victims.map((t) => pieceSvg(other(capturerColor), t)).join("") +
    (adv > 0 ? `<span class="adv">+${adv}</span>` : "");
}

function renderPlayers(fen) {
  const bottomColor = S.mode === "online" ? S.myColor || "w" : orientation();
  const topColor = other(bottomColor);
  const info = captureInfo(fen);

  $("meName").textContent = S.mode === "online" ? `${S.myName} (you)` : nameOf(bottomColor);
  $("oppName").textContent = S.mode === "online" ? S.oppName || (S.role === "guest" ? "Connecting…" : "Waiting for opponent") : nameOf(topColor);
  $("meChip").innerHTML = S.myColor || S.mode === "review" ? pieceSvg(bottomColor, "k") : "";
  $("oppChip").innerHTML = S.myColor || S.mode === "review" ? pieceSvg(topColor, "k") : "";
  renderCaptures($("meCaptures"), bottomColor, info);
  renderCaptures($("oppCaptures"), topColor, info);

  const turn = S.chess.turn();
  const active = S.mode === "online" && S.connected && !S.gameOver;
  $("meCard").classList.toggle("to-move", active && turn === bottomColor);
  $("oppCard").classList.toggle("to-move", active && turn === topColor);

  const dot = $("connDot");
  dot.classList.toggle("live", S.connected);
  dot.classList.toggle("lost", !S.connected && S.everConnected);
  dot.title = S.connected ? "Connected" : S.everConnected ? "Disconnected" : "Not connected yet";
}

function setStatus(text, cls = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

function renderStatus(hist) {
  if (S.mode === "review") {
    const r = S.gameOver ? ` · ${resultScore(S.gameOver.result)}${S.gameOver.reason ? `, ${S.gameOver.reason.toLowerCase()}` : ""}` : "";
    setStatus(`${whiteName()} vs ${blackName()}${r}`);
    return;
  }
  if (S.gameOver) {
    setStatus(`${resultHeadline()}. ${S.gameOver.reason}.`, "is-over");
    return;
  }
  if (!S.connected) {
    if (!S.everConnected) {
      if (S.role === "host") setStatus(`Waiting for your opponent to join. You're playing ${colorName(S.myColor)}.`);
      else setStatus("Connecting to the game…");
    } else {
      setStatus(S.role === "guest" ? "Connection lost. Reconnecting…" : `${S.oppName || "Your opponent"} disconnected. Waiting for them to come back…`);
    }
    return;
  }
  const mine = S.chess.turn() === S.myColor;
  if (mine) {
    setStatus(S.chess.inCheck() ? "Your move. You're in check." : hist.length === 0 ? "Your move. You're White, so you start." : "Your move", "is-mine");
  } else {
    setStatus(`${S.oppName}'s move`);
  }
}

function renderControls(hist, ply) {
  const online = S.mode === "online";
  const playing = online && S.connected && !S.gameOver && !!S.myColor;
  $("drawBtn").disabled = !playing || S.drawOfferPending || hist.length < 2;
  $("drawBtn").querySelector("span").textContent = S.drawOfferPending ? "Draw offered" : "Offer draw";
  $("resignBtn").disabled = !playing;
  $("saveBtn").disabled = online ? false : true;
  $("saveBtn").hidden = S.mode === "review";

  const navDisabled = { start: ply === 0, prev: ply === 0, next: ply >= hist.length, end: ply >= hist.length };
  document.querySelectorAll(".nav-btn").forEach((b) => (b.disabled = navDisabled[b.dataset.nav]));

  const reviewing = online && !isLive(hist);
  $("reviewBanner").hidden = !reviewing;
  if (reviewing) $("reviewText").textContent = ply === 0 ? "Viewing the starting position" : `Viewing move ${Math.ceil(ply / 2)}${ply % 2 ? "" : "…"}`;
}

function renderOffer() {
  const box = $("offerBox");
  if (S.mode !== "online" || !S.connected) { box.hidden = true; return; }
  if (S.rematchFromOpp && S.gameOver) {
    $("offerText").textContent = `${S.oppName} wants a rematch with colors swapped.`;
    box.dataset.kind = "rematch";
    box.hidden = false;
  } else if (S.drawOfferFromOpp && !S.gameOver) {
    $("offerText").textContent = `${S.oppName} offers a draw.`;
    box.dataset.kind = "draw";
    box.hidden = false;
  } else box.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Game screen controls                                               */
/* ------------------------------------------------------------------ */

function goTo(ply) {
  const n = liveHistory().length;
  ply = Math.max(0, Math.min(ply, n));
  S.viewPly = S.mode === "online" && ply === n ? null : ply;
  renderAll(true);
}

function confirmDialog({ title, text, yes, danger = true }) {
  return new Promise((resolve) => {
    const d = $("confirmDialog");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmYes").textContent = yes;
    $("confirmYes").className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
    d.returnValue = "";
    d.addEventListener("close", () => resolve(d.returnValue === "yes"), { once: true });
    d.showModal();
  });
}

function setSoundButtons() {
  const on = localStorage.getItem("chesslive-sound") !== "off";
  setSoundEnabled(on);
  $("soundBtn").setAttribute("aria-pressed", String(on));
  $("soundBtn").setAttribute("aria-label", on ? "Turn move sounds off" : "Turn move sounds on");
}

function bindGame() {
  $("moves").addEventListener("click", (e) => {
    const b = e.target.closest(".move");
    if (b) goTo(Number(b.dataset.ply));
  });
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const n = liveHistory().length;
      const cur = viewedPly(liveHistory());
      goTo({ start: 0, prev: cur - 1, next: cur + 1, end: n }[b.dataset.nav]);
    })
  );
  $("backToLive").addEventListener("click", () => goTo(Infinity));

  document.addEventListener("keydown", (e) => {
    if (S.mode === "lobby" || e.target.closest("input, textarea, dialog[open]")) return;
    const cur = viewedPly(liveHistory());
    const n = liveHistory().length;
    const map = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n, ArrowUp: 0, ArrowDown: n };
    if (e.key in map) {
      e.preventDefault();
      goTo(map[e.key]);
    }
  });

  $("flipBtn").addEventListener("click", () => {
    S.flipped = !S.flipped;
    persist();
    renderAll(false);
  });

  $("saveBtn").addEventListener("click", saveGame);
  $("resultSave").addEventListener("click", saveGame);
  $("resultRematch").addEventListener("click", offerRematch);

  $("resignBtn").addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Resign this game?", text: `${S.oppName} will win.`, yes: "Resign" });
    if (!ok || S.gameOver || !S.connected) return;
    send({ type: "resign", gameId: S.gameId });
    finishGame({ result: S.myColor === "w" ? "0-1" : "1-0", reason: `${S.myName} resigned` });
  });

  $("drawBtn").addEventListener("click", () => {
    if (S.drawOfferFromOpp) {
      send({ type: "drawAccept" });
      finishGame({ result: "1/2-1/2", reason: "Draw agreed" });
      return;
    }
    S.drawOfferPending = true;
    send({ type: "drawOffer" });
    toast(`Draw offered to ${S.oppName}.`);
    renderAll(false);
  });

  $("offerAccept").addEventListener("click", () => {
    const kind = $("offerBox").dataset.kind;
    if (kind === "draw") {
      S.drawOfferFromOpp = false;
      send({ type: "drawAccept" });
      finishGame({ result: "1/2-1/2", reason: "Draw agreed" });
    } else if (kind === "rematch") {
      send({ type: "rematchAccept" });
      startNextGame();
    }
  });
  $("offerDecline").addEventListener("click", () => {
    const kind = $("offerBox").dataset.kind;
    if (kind === "draw") { S.drawOfferFromOpp = false; send({ type: "drawDecline" }); }
    else if (kind === "rematch") { S.rematchFromOpp = false; send({ type: "rematchDecline" }); }
    renderOffer();
  });

  $("micBtn").addEventListener("click", () => { S.micOn = !S.micOn; applyLocalMedia(); });
  $("camBtn").addEventListener("click", () => { S.camOn = !S.camOn; applyLocalMedia(); });
  $("soundBtn").addEventListener("click", () => {
    const on = $("soundBtn").getAttribute("aria-pressed") !== "true";
    localStorage.setItem("chesslive-sound", on ? "on" : "off");
    setSoundButtons();
  });

  const copyInvite = async () => {
    if (!(await copyText(inviteUrl()))) return;
    toast(OPENED_FROM_DISK
      ? `Game code ${S.room} copied. Your opponent opens Chess Live and joins with this code.`
      : "Invite link copied. Send it to your opponent.");
  };
  $("copyLink").addEventListener("click", copyInvite);
  $("copyLink2").addEventListener("click", copyInvite);
  $("inviteUrl").addEventListener("focus", (e) => e.target.select());
  $("shareLink").addEventListener("click", () =>
    navigator.share?.({ title: `${APP_NAME}`, text: `Play chess with me on ${APP_NAME}`, url: inviteUrl() }).catch(() => {})
  );

  $("enableAudio").addEventListener("click", () => {
    $("oppVideo").play().then(() => ($("enableAudio").hidden = true)).catch(() => {});
  });

  $("leaveBtn").addEventListener("click", async () => {
    if (S.mode === "review") { leaveGame({ silent: true }); return; }
    const inProgress = S.connected && !S.gameOver && liveHistory().length > 0;
    const ok = await confirmDialog({
      title: "Leave this game?",
      text: inProgress
        ? "The game isn't finished. Save it first if you want to keep the moves."
        : "Your opponent will see that you left.",
      yes: "Leave game",
    });
    if (ok) leaveGame();
  });
  $("homeLink").addEventListener("click", (e) => {
    e.preventDefault();
    $("leaveBtn").click();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) document.title = S.mode === "online" ? `Game ${S.room} — ${APP_NAME}` : document.title;
  });

  window.addEventListener("beforeunload", (e) => {
    if (S.mode === "online" && S.connected && !S.gameOver && liveHistory().length > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  await loadSprite();

  lobbyBoard = new Board($("lobbyBoard"));
  lobbyBoard.setPosition(new Chess().fen(), { animate: false });

  board = new Board($("board"), {
    getMoves: (sq) => (S.mode === "online" ? S.chess.moves({ square: sq, verbose: true }) : []),
    onMove: (m) => {
      if (!myMovableColor(liveHistory())) return renderAll(false);
      if (!applyMove(m, true)) renderAll(false);
    },
  });
  board.setPosition(new Chess().fen(), { animate: false });

  bindLobby();
  bindGame();

  const params = new URLSearchParams(location.search);
  const room = cleanCode(params.get("room"));
  const sess = readSession();

  if (room && sess && sess.room === room) {
    resume(sess);
    return;
  }
  showLobby();
  if (room && room.length === 6) {
    S.room = room;
    $("inviteCode").textContent = room;
    $("invitePanel").hidden = false;
    $("startPanel").hidden = true;
    $("inviteName").focus();
  } else {
    $("createName").focus({ preventScroll: true });
  }
}

boot();
