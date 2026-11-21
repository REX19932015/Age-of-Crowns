# Age of Crowns: Online

Your existing Age of Crowns game, now multiplayer. Every place, job, army, government system, ship and balloon from the single-player game is still there. On top of that:

* **Accounts** through Supabase: register, log in, log out, and stay logged in between visits.
* **One persistent character per account**: name, appearance, position, inventory, gold, jobs, army rank, government rank, medals and the rest of your progress. It loads automatically when you log in and saves automatically (every few seconds while you play, and when you leave).
* **Real multiplayer**: other players walk, run, sail and fly around the same 3D world with their names above their heads.
* **Chat**: Global, Local, Private, Kingdom and Army channels.
* **Shared systems, all checked by the server**: trading, gold gifts, house and estate ownership, kingdom treasuries and taxes, offices, elections, Parliament, army ranks, regiments and world events.

If `js/config.js` is left empty, the game runs offline exactly as before.

---

## What is in this folder

```
index.html             the game (your original, plus small hooks for online play)
js/config.js           ← THE ONLY FILE YOU EDIT in the game: Supabase URL, publishable key, server address
js/net.js              online layer: sign-in, saving, other players, chat, Realm panel, trading
css/online.css         styling for chat and panels (uses the game's own colours and fonts)
supabase/schema.sql    database tables, security rules (RLS) and starting data: paste into Supabase
server/server.js       the multiplayer server (Node.js 18+, no packages to install)
server/lib/ws.js       WebSocket support (built in, no dependencies)
server/lib/supabase.js server-side Supabase access
server/data/world.json towns and houses of the world, so the server can check property and events
server/.env.example    server settings template
server/Dockerfile      for hosts that run containers (Fly.io, Railway, any VPS)
render.yaml            one-click setup on Render
```

How the pieces fit together:

```
 Browser (index.html + js/net.js)
   │  sign up / log in ───────────────► Supabase Auth          (publishable key)
   │  WebSocket: movement, chat, trades, votes …
   ▼
 Multiplayer server (server/server.js)
   │  checks the login token with Supabase, enforces every rule
   ▼
 Supabase Postgres  (secret key; only the server can write)
```

---

## Step 1: Set up Supabase (about 5 minutes)

1. Create a project at <https://supabase.com> (the free tier is fine).
2. Open **SQL Editor → New query**. Paste the whole of `supabase/schema.sql` and click **Run**. You should see "Success". Running it again later is safe.
3. Open **Authentication → Sign In / Providers → Email** and make sure **Email** is enabled.
   * If **Confirm email** is on, new players must click the link in their email before signing in. The game tells them this. For quick testing you can turn it off.
4. Open **Project Settings → API Keys** and copy:
   * the **Publishable key** (`sb_publishable_…`). This goes in the game.
   * the **Secret key** (`sb_secret_…`). This goes **only** on the server.
   * If your project shows the older keys instead, use **anon** for the game and **service_role** for the server.
5. Copy the **Project URL** too (`https://xxxx.supabase.co`, under Project Settings → API / Data API).

**Optional, make yourself an admin.** Admins can use `/announce`, `/event`, `/kick` and `/mute` in chat. After you've created your account in the game, run this in the SQL Editor:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

---

## Step 2: Run the multiplayer server

The server needs **Node.js 18 or newer** and nothing else: there is no `npm install` step.

### Try it on your own computer first

```bash
cd server
cp .env.example .env        # then open .env and fill in SUPABASE_URL and SUPABASE_SECRET_KEY
node server.js
```

You should see `realm loaded …` and `Age of Crowns server listening on port 8080`. Opening <http://localhost:8080/health> shows `{"ok":true,…}`.

### Put it online on Render (free tier works)

1. Put this whole folder in a GitHub repository. `server/.env` is excluded by `.gitignore`, so your secret key stays private.
2. On <https://render.com>: **New → Blueprint**, then pick the repository. Render reads `render.yaml`.
3. When asked, enter `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
4. When it says *Live*, your server address is `wss://<your-service>.onrender.com` (the `https://` address with `https` swapped for `wss`).

On the free plan, Render puts the server to sleep after 15 minutes without visitors. The first player to arrive then waits about 30 seconds while it wakes. A paid instance stays awake.

**Other hosts.** In every case, set `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and optionally `ALLOWED_ORIGINS`.

* **Railway:** New Project → Deploy from repo, set the root directory to `server`, start command `node server.js`.
* **Fly.io:** `cd server && fly launch`. It finds the Dockerfile.
* **Your own VPS:** `node server.js` behind nginx or Caddy with HTTPS. The game needs `wss://` when it is served over `https://`.

Run **one** server instance. It keeps the live world (who is where, open trades) in memory.

---

## Step 3: Point the game at Supabase and the server

Open **`js/config.js`** and fill in the three values:

```js
window.AOC_CONFIG = {
  SUPABASE_URL: 'https://abcdefghijklmno.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxx',
  SERVER_URL: 'wss://age-of-crowns-server.onrender.com',
};
```

Never put the secret key here: anyone can read browser files.

---

## Step 4: Host the game

The game is static files: `index.html`, `js/`, `css/`. Any static host works:

* **GitHub Pages:** repository → Settings → Pages → deploy from your branch. The site is `https://<you>.github.io/<repo>/`.
* **Netlify** or **Cloudflare Pages:** drag the folder in, or connect the repository. No build command is needed.

Then:

1. In Supabase, open **Authentication → URL Configuration** and set the **Site URL** to your game's address, so confirmation emails link back to it.
2. Once it works, set `ALLOWED_ORIGINS` on the server to your game's address (for example `https://you.github.io`) so only your site can connect.

Files opened straight from disk (`file://`) can't sign in. For local testing, serve the folder, for example with `npx serve .` or `python3 -m http.server`, and use `SERVER_URL: 'ws://localhost:8080'`.

---

## Playing online

| Key | What it does |
|---|---|
| **Enter** | Open chat and type. Enter sends; Esc returns to the game. |
| **/** | Chat command: `/w Name message` sends a private message; `/g` `/l` `/k` `/a` post to Global, Local, Kingdom or Army; `/online` shows who is online. |
| **. (full stop)** | **Realm panel**: players online, Kingdom (offices, treasury, elections), Parliament, Army, Events, Property, Account (change kingdom, log out). |
| **E beside a player** | Trade, private message, give gold, wave/bow/salute, view their record. Regiment commanders can also invite, Marshals and Monarchs can set army ranks, and Monarchs can appoint to office. |
| **M** | The map also shows other players (coloured by kingdom) and live world events (gold stars). |

**Chat channels**

* **Global** reaches everyone.
* **Local** reaches players within 60 paces.
* **Kingdom** reaches citizens of your kingdom.
* **Army** reaches soldiers of the same army.
* **Private** reaches one player. If they're offline, it's delivered when they next log in.

Messages show the sender's name, kingdom colour and time. Clicking a name starts a private message.

**Spam limits:** at most 240 characters per message, 5 messages per 10 seconds, and no repeating the same line within 30 seconds. Repeat offenders are muted for 60 seconds. The server checks who may use each channel.

---

## What the server checks (and what it doesn't)

Critical actions go to the server, which checks them and writes to Supabase. The browser has **no** write access to any table.

| System | How it works online |
|---|---|
| **Gold and inventory** | The server keeps the true balance. Solo play (jobs, missions, loot) still pays as in the original game, but the server caps how fast gold can appear: 1,500 per minute by default, with up to 20,000 banked for big payouts. A save claiming more is corrected. Every change made by the server is logged in the `ledger` table. |
| **Trading** | Both players must stand together. Each puts gold, items and cargo on the table and both press Ready. The server re-checks both inventories and swaps them at once. The payer's kingdom takes its trade tax (5% to start) into its treasury. |
| **Gifts** | Gold can only be handed to someone standing next to you. You can't give more than you have. |
| **Houses and estates** | One owner per house across the whole realm. The server takes payment (moving house refunds half the old one) and the price goes to that kingdom's treasury. |
| **Elections** | Any citizen can call an election for an office: Monarch, Chancellor, Treasurer, Marshal, Speaker, or one of three seats. Citizens stand and vote: one vote per account, secret ballot, counted by the server. The winner takes office. Winning Monarch makes you ruler of that kingdom in your game. |
| **Parliament** | Office holders table motions and vote Aye or Nay. Motions are decrees, treasury grants to a player, or a new trade tax (0–20%). A motion closes when time runs out or everyone has voted, and the server carries it out. |
| **Armies** | Enlisting with a recruiter in the game registers you in that army on the server, which opens army chat. Ranks earned in play are confirmed one step every 90 seconds at most. The Marshal or Monarch can set any rank directly. Sergeants and above can raise a regiment (200 gold), invite soldiers, name officers and dismiss members. |
| **World events** | Every 12 minutes the Herald announces a fair, tournament, bandit raid or royal muster at a town. Travel there, join from the Realm panel, and stay for a minute to be paid. |

Honest limits:

* Each player's NPC world (wars between AI kingdoms, NPC elections, bandits, battles) is still simulated in their own browser, as in single-player. What's shared and server-checked is everything *between players* (the table above), plus where everyone is.
* Rewards from solo activities come from the browser, so the server limits how fast they can grow rather than checking each one. Gold that moves between players or into treasuries can't be faked.
* Other players' manors aren't drawn in your world, but ownership is enforced, so two players can't buy the same land.
* Characters made in the offline version stay in that browser. Online characters start fresh.

---

## Troubleshooting

* **"Cannot reach the multiplayer server. Retrying…"**: check `SERVER_URL`, use `wss://` for an https site, and open `https://<server>/health` in a browser. A sleeping free Render server takes about 30 seconds to wake.
* **"Could not load the realm from Supabase" in the server log**: `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is wrong, or `schema.sql` hasn't been run.
* **"Your login has expired"**: sign in again. This also appears if the game and the server point at different Supabase projects.
* **New account can't sign in**: confirm the email (check spam), or turn off email confirmation while testing.
* **Server log says `403` from the browser**: the site's address isn't in `ALLOWED_ORIGINS`.
* **Debugging in the browser console**: `AOC_NET.state` shows the connection, other players and chat history. `AOC_NET.say('global','hello')` sends a message.
