// Chess Live server
// Serves the game website and runs the signaling service that lets two
// browsers find each other. Video, voice and moves then flow directly
// between the two players (peer-to-peer), not through this server.

const path = require("path");
const http = require("http");
const express = require("express");
const { ExpressPeerServer } = require("peer");

const PORT = process.env.PORT || 3000;

// Optional TURN relay. Most home and office connections work without one,
// but some mobile and corporate networks block direct connections.
// For a public launch, set these (e.g. from Metered, Twilio, Xirsys or your own coturn).
function iceServers() {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(",").map((s) => s.trim()),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    });
  }
  return servers;
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

app.get("/api/config", (req, res) => {
  res.json({ iceServers: iceServers() });
});

app.get("/healthz", (req, res) => res.send("ok"));

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
});
