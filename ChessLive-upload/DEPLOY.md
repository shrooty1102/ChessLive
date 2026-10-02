# Put Chess Live online for free

This takes about 30 minutes. You don't need to install anything on your computer.

You'll set up three free accounts:

- **GitHub** keeps your code.
- **Cloudflare** gives you the connection relay (TURN), so players on strict mobile or office networks can still connect.
- **Render** runs the game and gives you a web address like `https://chess-live-abcd.onrender.com`.

---

## Quick option: GitHub Pages (5 minutes, no accounts besides GitHub)

This publishes the game as a plain website at `https://<your-username>.github.io/<repo-name>/`. Players are connected through the free public PeerJS service, which has no uptime guarantee, and there's no TURN relay, so some mobile and office networks won't connect. It's fine for friends and testing. For a proper launch, follow Steps 1–6 below (Render + Cloudflare).

1. Put the files in your GitHub repository (Step 2 below).
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Then choose branch **main** and folder **/docs**, and click **Save**.
4. Wait 1–2 minutes and refresh the page. The site address appears at the top of the Pages settings.

Every later change to the `docs` folder on GitHub republishes the site automatically.

---

## Step 1. Unzip the project

Unzip `chess-live.zip`. You'll get a folder called `chess-live`. Inside it you should see `server.js`, `package.json`, `render.yaml`, `README.md`, this file and a `docs` folder.

If you ran `npm install` earlier, there will also be a `node_modules` folder. **Don't upload that one.** It's large and Render rebuilds it.

---

## Step 2. Put the code on GitHub

1. Go to https://github.com and sign up or sign in.
2. Click the **+** at the top right, then **New repository**.
3. Repository name: `chess-live`. Choose **Private** (Render can still read it). Leave everything else as it is. Click **Create repository**.
4. On the next page, click the link **uploading an existing file**.
5. Open your `chess-live` folder on your computer, select **everything inside it** (not the folder itself), and drag it onto the GitHub page. The `docs` folder goes up with its contents.
   - Skip `node_modules` if it's there.
   - `.gitignore` is a hidden file. It's fine if it doesn't go up.
6. Wait until all files show in the list, then click **Commit changes** at the bottom.
7. Check the result. The repository's main page should show `server.js`, `package.json`, `render.yaml` and the `docs` folder at the top level. If you see a single `chess-live` folder instead, you dragged the folder itself. Delete the repository and repeat step 5 with the files inside it.

---

## Step 3. Get your Cloudflare TURN keys

1. Go to https://dash.cloudflare.com/sign-up and create a free account (or sign in).
2. In the left menu, open **Realtime**. In some accounts it's still called **Calls**. Then choose **TURN Server**.
3. Click **Create**. Name it `chess-live` and confirm.
4. Cloudflare now shows two values:
   - **Turn Token ID**
   - **API Token**
5. Copy both into a note right away. **The API Token is shown only once.** If you lose it, create a new TURN key and use the new pair.

Cost: Cloudflare gives a free allowance of 1,000 GB, and charges $0.05 per GB after that. Only games where players can't connect directly use the relay (usually 10–20% of games). A one-hour relayed video game uses roughly 0.5–1 GB, so the free allowance covers about a thousand hours of relayed play. If Cloudflare asks for a payment method to switch on Realtime, the free allowance still applies.

Keep the API Token private. Don't put it in any file on GitHub. It only goes into Render (Step 4).

---

## Step 4. Deploy on Render

1. Go to https://render.com and click **Get Started**. Sign up **with GitHub** (this makes connecting the code easier).
2. In the Render dashboard, click **New +** and choose **Blueprint**.
3. Connect your GitHub account if asked. When GitHub asks which repositories Render may access, pick **Only select repositories** and choose `chess-live`.
4. Select the `chess-live` repository and click **Connect**.
5. Render reads `render.yaml` and shows one service called `chess-live` on the **Free** plan. It asks for two values:
   - `CF_TURN_KEY_ID` → paste the **Turn Token ID** from Cloudflare
   - `CF_TURN_API_TOKEN` → paste the **API Token** from Cloudflare
6. Give the Blueprint any name (for example `chess-live`) and click **Apply** (or **Deploy Blueprint**).
7. Wait 2–4 minutes. Open the `chess-live` service. When it says **Live**, your address is shown at the top, something like `https://chess-live-abcd.onrender.com`.

**If you don't see Blueprint,** set it up by hand instead: **New +** → **Web Service** → pick the repo, then enter:

| Setting | Value |
|---|---|
| Language | Node |
| Region | Singapore (closest to India) |
| Build command | `npm install` |
| Start command | `npm start` |
| Instance type | Free |
| Environment variables | `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` with the Cloudflare values |

Then click **Deploy Web Service**. Under **Settings**, set the health check path to `/healthz`.

---

## Step 5. Check that it's working

Replace the address below with yours.

1. Open `https://chess-live-abcd.onrender.com/healthz`. It should say `ok`.
2. Open `https://chess-live-abcd.onrender.com/api/status`. You want to see:
   ```
   {"ok":true,"turnSetup":"Cloudflare TURN","turnWorking":true}
   ```
   - `turnWorking: false` means the two Cloudflare values are wrong. Fix them in Render under **Environment** (see Troubleshooting).
   - `turnSetup: "STUN only..."` means the two values weren't added at all.
3. Play a real test game:
   - On your laptop, open your address, enter your name, pick a color and click **Start game**. Allow the camera and microphone.
   - Click **Copy invite link** and send it to your phone.
   - On the phone, **turn Wi-Fi off** so it uses mobile data. That tests the hard case where the relay is needed. Open the link, enter a name and join.
   - You should see and hear each other. Make a few moves on both sides, then click **Save game** and check the `.pgn` file lands on your computer.

---

## Step 6. Share it

Your game is live at your Render address. Anyone can start a game there and send the invite link to a friend.

---

## Free plan limits

- **It sleeps when unused.** After 15 minutes with nobody on the site, Render puts it to sleep. The next visitor sees a loading page for about a minute while it wakes up. While anyone is on the site (even one player waiting for an opponent), it stays awake.
- **750 free hours a month.** That's enough to run one service all month, even if it never sleeps.
- **Cloudflare relay:** 1,000 GB free, then $0.05 per GB.

### Optional: stop it from sleeping

1. Create a free account at https://uptimerobot.com.
2. Click **Add New Monitor** → type **HTTP(s)**.
3. URL: `https://chess-live-abcd.onrender.com/healthz`. Interval: **5 minutes**.

This pings the site every 5 minutes so it never falls asleep, and it emails you if the site goes down.

---

## Optional: your own domain (e.g. chess.yourname.com)

The domain itself is paid (usually ₹700–1,200 a year from GoDaddy, Namecheap, Hostinger or Cloudflare). Connecting it to Render is free, and Render adds the https certificate for you.

1. In Render, open the service → **Settings** → **Custom Domains** → **Add Custom Domain** → type your domain (e.g. `chess.yourname.com`).
2. Render shows a **CNAME** record. In your domain provider's DNS settings, add that record.
3. Wait 5–30 minutes until Render shows the domain as **Verified**. Then use the new address.

---

## Updating the game later

- **Small text or style changes:** open the file on GitHub, click the pencil icon, edit and **Commit changes**. Render redeploys by itself in 2–3 minutes.
- **Changes to the game code (`docs/js/...`):** the browser loads the combined file `docs/js/app.bundle.js`. After editing, run `npm install` and then `npm run build` on your computer, and upload the new `app.bundle.js` along with the files you changed.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Page takes about a minute to open | The free server was asleep. It's normal. Use UptimeRobot (above) to avoid it. |
| Render deploy says **Failed** | Open the service → **Logs**. Most often `package.json` isn't at the top level of the repo (see Step 2, point 7). |
| Camera/mic prompt never appears | Make sure the address starts with `https://`. In the browser's site settings (padlock icon), set Camera and Microphone to **Allow**, then reload. |
| Players join but never see each other | Open `/api/status`. If `turnWorking` is `false`, recheck the two Cloudflare values in Render → **Environment**, click **Save Changes** and wait for the redeploy. |
| "No open game with code…" | The person who started the game closed the page or left. Ask them to start a new game and send a fresh link. |
| "That game already has two players" | Each game is for two people. Start a new game. |
| Lost the Cloudflare API Token | In Cloudflare, create a new TURN key, then put both new values into Render → **Environment**. |
