# Chess Live

Two-player online chess with live video and voice. One player starts a game and sends a link, the other opens it, and they play while seeing and hearing each other.

## What it does

- Start a game and pick White, Black or Random. The other player gets the opposite color.
- Share the invite link (or the 6-letter game code). The board is set up and ready before the opponent arrives.
- Camera and microphone turn on when you start or join. Mic and camera can be switched off at any time.
- Every move appears in the Moves panel next to the board. Click any move (or use the arrow keys) to look back at that position, then return to the live game.
- Legal-move hints, drag or click to move, pawn promotion picker, check highlight, captured pieces and material count.
- Checkmate, stalemate, repetition, fifty-move rule and insufficient material are detected automatically. Players can also resign or agree a draw.
- **Save game** writes a standard `.pgn` file to the player's computer. In Chrome and Edge the player picks the folder; other browsers put it in Downloads. PGN files open in any chess program (Lichess, Chess.com analysis, ChessBase).
- **Open a saved game** on the home page replays a `.pgn` file move by move.
- If either player reloads or briefly loses connection, the game reconnects and carries on from the same position.
- Works on desktop and mobile browsers (Chrome, Edge, Firefox, Safari).

## Quickest try: just open the file

Double-click `docs/index.html`. The game opens in your browser and works without installing anything. In this mode there is no link to share, so the other player opens their own copy of the file, chooses **Join with a code**, and types your 6-letter game code. Players are connected through the free public PeerJS service.

## Run it on your computer (recommended)

Needs Node.js 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000. To try a two-player game on one machine, open the invite link in a second browser (or a private window).

## Put it online

Camera and microphone only work on `https://` sites (or localhost), so host it somewhere that gives you HTTPS. Any Node host works: Render, Railway, Fly.io, a VPS behind Nginx/Caddy, Azure App Service.

- Start command: `npm start`
- The server reads the `PORT` environment variable.
- Health check: `/healthz`

### TURN server (needed for a public launch)

Video, voice and moves go directly between the two players. That works on most home and office Wi-Fi, but roughly 10–20% of connections (some mobile networks, corporate firewalls) block direct links. A TURN server relays traffic for those players. Without it, those games will fail to connect.

Get TURN credentials from a provider such as Metered, Twilio, Xirsys or Cloudflare, or run your own coturn, then set:

```
TURN_URL=turn:your.turn.host:3478,turns:your.turn.host:5349
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

### Static hosting (quick demo only)

The `docs` folder also runs on its own on any static host. For GitHub Pages, go to Settings → Pages and serve the `main` branch from the `/docs` folder. In that mode it uses the free public PeerJS service to connect players, which has no uptime guarantee. Use the Node server for a real launch.

## Changing the code

The browser loads `docs/js/app.bundle.js`, which is built from the files in `docs/js/`. After editing any of them, run:

```
npm run build
```

## Project layout

```
server.js            web server + signaling service (helps the two browsers find each other)
docs/index.html    page structure
docs/css/style.css look and layout
docs/js/app.bundle.js  built file the page loads (from the files below)
docs/js/app.js     game flow, connection, video, saving
docs/js/board.js   chess board (drawing, moves, promotion)
docs/js/sound.js   move sounds (generated, no audio files)
docs/vendor/       chess.js (rules), PeerJS (WebRTC)
docs/assets/       chess piece graphics, site icon
```

To rename the product, change `APP_NAME` at the top of `docs/js/app.js`, plus the title and wordmark text in `index.html`.

## Licenses and credits

- chess.js: BSD-2-Clause
- PeerJS and PeerJS Server: MIT
- Chess piece artwork: Colin M.L. Burnett (Cburnett) via Wikimedia Commons and cm-chessboard, CC BY-SA 3.0. Keep a credit line on your site (for example in the footer or an About page).
- Fonts: Bricolage Grotesque and Figtree from Google Fonts (SIL Open Font License).

## Good next steps before launch

- Add a TURN service (above). This matters more than anything else on the list.
- Optional chess clocks (e.g. 10+0, 5+3).
- Analytics and an error tracker so you can see failed connections.
- A short privacy note: video and audio go player-to-player and are not recorded or stored by the server.
