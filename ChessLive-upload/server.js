// Chess Live server
// Serves the game website and runs the signaling service that lets two
// browsers find each other. Video, voice and moves then flow directly
// between the two players (peer-to-peer), not through this server.

const path = require("path");
const http = require("http");
const express = require("express");
const { ExpressPeerServer } = require("peer");

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Connection helpers (STUN/TURN)
//
// STUN lets two browsers find a direct route to each other. That works for most
// home and office networks. Some mobile and corporate networks block direct
// routes; for those players a TURN server relays the video and moves.
//
// Option A (recommended): Cloudflare TURN. Set CF_TURN_KEY_ID and CF_TURN_API_TOKEN.
//   The server asks Cloudflare for short-lived logins and hands them to players.
// Option B: any other TURN provider with a fixed login. Set TURN_URL,
//   TURN_USERNAME and TURN_CREDENTIAL.
// With neither set, the game still works, using STUN only.
// ---------------------------------------------------------------------------

const BASE_STUN = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

const CF_KEY_ID = process.env.CF_TURN_KEY_ID;
const CF_TOKEN = process.env.CF_TURN_API_TOKEN;
const CF_TTL_SECONDS = 24 * 60 * 60; // each login is valid for 24 hours
let cfCache = { servers: null, expires: 0 };
let cfRetryAfter = 0; // after a failure, wait a minute before asking Cloudflare again
let cfPending = null;

async function cloudflareIceServers() {
  if (cfCache.servers && Date.now() < cfCache.expires) return cfCache.servers;
  if (Date.now() < cfRetryAfter) return null;
  if (cfPending) return cfPending;
  cfPending = (async () => {
    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(CF_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: CF_TTL_SECONDS }),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
      // Browsers block port 53, so leave those addresses out (Cloudflare's own advice).
      const servers = list
        .filter(Boolean)
        .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
        .filter((s) => s.urls.length);
      // Reuse the same login for 12 hours, so every player gets one with at least 12 hours left.
      cfCache = { servers, expires: Date.now() + (CF_TTL_SECONDS / 2) * 1000 };
      return servers;
    } catch (err) {
      console.error("Could not get Cloudflare TURN login, falling back to STUN only:", err.message);
      cfCache = { servers: null, expires: 0 };
      cfRetryAfter = Date.now() + 60 * 1000;
      return null;
    } finally {
      cfPending = null;
    }
  })();
  return cfPending;
}

async function iceServers() {
  if (CF_KEY_ID && CF_TOKEN) {
    const cf = await cloudflareIceServers();
    if (cf) return cf;
  }
  const servers = [...BASE_STUN];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(",").map((s) => s.trim()),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    });
  }
  return servers;
}

function turnMode() {
  if (CF_KEY_ID && CF_TOKEN) return "Cloudflare TURN";
  if (process.env.TURN_URL) return "custom TURN";
  return "STUN only (no TURN relay set up)";
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Basic security headers. Camera and microphone are allowed for this site only.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});

app.get("/api/config", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ iceServers: await iceServers() });
});

app.get("/healthz", (req, res) => res.send("ok"));

// Quick check after deploying: shows whether the relay is set up and working.
// (It never shows the secret token.)
app.get("/api/status", async (req, res) => {
  const servers = await iceServers();
  const relay = servers.some((s) => [].concat(s.urls).some((u) => u.startsWith("turn")));
  res.json({ ok: true, turnSetup: turnMode(), turnWorking: relay });
});

app.use(express.static(path.join(__dirname, "docs"), { maxAge: "1h" }));

const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
  path: "/",
  proxied: true,
  allow_discovery: false,
  alive_timeout: 60000,
});
app.use("/peerjs", peerServer);

// Any other path returns the app (so shared links like /?room=ABC123 work).
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "docs", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Chess Live running at http://localhost:${PORT}`);
  console.log(`Connection relay: ${turnMode()}`);
});
