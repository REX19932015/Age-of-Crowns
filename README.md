# Age of Crowns: Online

Your existing Age of Crowns game, now multiplayer. Every place, job, army, government system, ship and balloon from the single-player game is still there. On top of that:

* **Accounts** through Supabase: register, log in, log out, and stay logged in between visits.
* **One persistent character per account**: name, appearance, position, inventory, gold, jobs, army rank, government rank, medals and the rest of your progress. It loads automatically when you log in and saves automatically (every few seconds while you play, and when you leave).
* **Real multiplayer**: other players walk, run, sail and fly around the same 3D world with their names above their heads.
* **Chat**: Global, Local, Private, Kingdom and Army channels.
* **Shared systems, all checked by the server**: trading, gold gifts, house and estate ownership, kingdom treasuries and taxes, offices, elections, Parliament, army ranks, regiments and world events.

* **Seasons**: real-calendar seasons with a battle pass, the Spring story campaign, holidays and live events (see **Seasons** below).

If `js/config.js` is left empty, the game runs offline exactly as before.

> **Upgrading a game that is already online?** See **Adding the seasonal update to a running game** near the end.

---

## What is in this folder

```
index.html             the game (your original, plus small hooks for online play)
js/config.js           ← THE ONLY FILE YOU EDIT in the game: Supabase URL, publishable key, server address
js/net.js              online layer: sign-in, saving, other players, chat, Realm panel, trading, home screen
js/seasons.js          seasons: battle pass, story, challenges, holidays, wardrobe, seasonal look, graphics settings
css/online.css         styling for chat and panels (uses the game's own colours and fonts)
css/seasons.css        styling for the Season panel and HUD
supabase/schema.sql    database tables, security rules (RLS) and starting data: paste into Supabase
supabase/seasons.sql   the seasonal tables: run after schema.sql
server/server.js       the multiplayer server (Node.js 18+, no packages to install)
server/lib/ws.js       WebSocket support (built in, no dependencies)
server/lib/supabase.js server-side Supabase access
server/season.js       seasons on the server: calendar, XP, story steps, rewards, events
server/data/world.json towns and houses of the world, so the server can check property and events
server/data/seasons.js all seasonal content: items, battle passes, the Spring campaign, holidays, events
server/data/places.json story locations and event checkpoints
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
2. Open **SQL Editor → New query**. Paste the whole of `supabase/schema.sql` and click **Run**. You should see "Success". Then do the same with `supabase/seasons.sql` in a new query. Running either again later is safe.
3. Open **Authentication → Sign In / Providers → Email** and make sure **Email** is enabled.
   * If **Confirm email** is on, new players must click the link in their email before signing in. The game tells them this. For quick testing you can turn it off.
4. Open **Project Settings → API Keys** and copy:
   * the **Publishable key** (`sb_publishable_…`). This goes in the game.
   * the **Secret key** (`sb_secret_…`). This goes **only** on the server.
   * If your project shows the older keys instead, use **anon** for the game and **service_role** for the server.
5. Copy the **Project URL** too (`https://xxxx.supabase.co`, under Project Settings → API / Data API).

**Optional, make yourself an admin.** Admins get an **⚑ Admin** tab in the Realm panel (.) listing every player in the realm, online and offline, with **Go to**, **Bring here**, Message, Mute and Kick, and can use `/announce`, `/event`, `/kick` and `/mute` in chat. Only accounts marked admin in the database receive that list. After you've created your account in the game, run this in the SQL Editor:

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

When the page opens, a loading screen shows the realm being built. After you sign in, a **home screen** shows your character, gold, who's online and what's happening; press **Enter the realm** to play. (A brand-new character goes straight in.)

| Key | What it does |
|---|---|
| **Enter** | Open chat and type. Enter sends the message and puts you back in the world (or click ➤). Esc closes chat without sending. |
| **/** | Chat command: `/w Name message` sends a private message (names with spaces work for players who are online); `/g` `/l` `/k` `/a` post to Global, Local, Kingdom or Army; `/online` shows who is online. |
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

## Seasons

**Seasons from the real calendar.** The server's own clock picks the season: Spring (20 Mar – 20 Jun), Summer (21 Jun – 21 Sep), Autumn (22 Sep – 20 Dec) and Winter (21 Dec – 19 Mar). Every player sees the same one. The world follows it: foliage colour, snow and ice, weather, fog tint, light, falling petals, leaves, fireflies, pollen or snow flurries, and town decorations (blossom, maypoles, bunting, pumpkins, hay bales, snowmen, lanterns and trees).

**The Spring story, *The Broken Crown*.** Seven chapters, about 36 steps, ten story characters standing in the world, six side stories, choices that change later chapters, and a live finale (*The Concord Assembly*) where everyone holds three posts in the Crossroads Market together. The server checks every step from where it sees you: you have to actually be there. The finale reward (the Regalia of the Restored Concord and more) is only for finishing the story; it is never in the battle pass and never sold. Premium is never needed for any story step or event. Summer, Autumn and Winter stories are planned (their chapters are listed in the Calendar tab) but not written yet.

**Battle pass, 100 tiers in 10 chapters, plus 50 bonus tiers.** XP comes from story steps, daily, weekly and seasonal challenges, live events, holiday hunts and helping others. 1,500 XP per tier.

* **Free track:** an item, a tonic, gold or a chest through every chapter, and a **chest at the end of each chapter** where you choose one of three rewards (gold, tonics with gold, or an XP boost). Tier 100 is the Grand Crown Chest.
* **Premium track** (20,000 *in-game* gold; there is no real-money purchase anywhere): something on every tier, Royal Chests, and the season's **evolving outfit**, one look that grows grander at tiers 1, 33, 66 and 100.
* **Rewards that do something:** wardrobe items (outfits, hats, titles, nameplates, balloon envelopes, ship sails, musket finishes, emotes), **healing tonics** for your real inventory, gold, and **XP boosts** (×1.5 or ×2 for a while; boosts of the same strength add their time together).
* **Bonus tiers 101–150** for those who keep playing: gold every tier, Prestige Chests, and a prestige title (tier 125) and nameplate (tier 150) for everyone who reaches them.
* The pass screen has a showcase (evolving outfit, your next big rewards), a chapter strip that jumps the track to any chapter, rarity colours, a chest picker, a pop-up card when a reward arrives, **Try it on** for outfits and hats you don't own yet, and the XP boost timer on your HUD.

**Holidays.** Valentine's (Day of Friendship), Easter (Spring Festival, date worked out each year), Midsummer, Halloween (Haunted Lantern Walk), Winterfest and New Year (with fireworks). Each has a hunt across the realm with its own rewards.

**Live world events with objectives.** Nine kinds (fairs, tournaments, expeditions, footraces, regattas and more): reach checkpoints in order, hold a place together, or stay and take part.

**Graphics settings.** Auto, Low, Medium, High and Ultra (resolution, shadows, draw distance, particles, decorations), remembered in your browser.

**Also in this update:** a loading screen with a real progress bar, a home screen after signing in, Enter sends chat messages, the admin player list, `/w` working with names that have spaces, and the map changes (W A S D pan the map; admins click to teleport and can move straight away).

Keys: **Tab** Season panel · **Enter** chat · **.** Realm panel · **M** map · **E** talk to story characters.

### Admin commands for seasons

| Command | What it does |
|---|---|
| `/givexp 5000` | Gives you XP to test the battle pass (admin XP is never boosted) |
| `/finale` | Starts the live finale now |
| `/event` | Starts a live world event now |
| `/announce text` | Herald announcement to everyone |
| `/kick Name`, `/mute Name 10` | Moderation |

### Server settings (all optional)

Leave these out for normal play: the season then follows the real calendar. They're for trying things early.

| Name | Default | What it does |
|---|---|---|
| `SEASON_OVERRIDE` | (real calendar) | `spring`, `summer`, `autumn` or `winter` |
| `SEASON_OVERRIDE_DAY` | `0` | Pretend the overridden season started this many days ago |
| `HOLIDAY_OVERRIDE` | (real calendar) | Turn on a holiday now, e.g. `winterfest` or `halloween,newyear` |
| `CHAPTER_GAP_DAYS` | `7` | Days between story chapters opening |
| `FINALE_EVERY_MINUTES` | `120` | How often the live finale runs once chapter 7 is open |
| `FINALE_HOLD_SECONDS` | `60` | How long the finale posts must be held |
| `EVENT_EVERY_MINUTES` | `12` | How often live world events start |

### What the server checks for seasons

The browser only asks; the server decides. A player can't give themselves XP, items, tiers or rewards.

* **XP** is added only by the server, from what it sees: where you are for story steps, the towns you enter, trades, votes, events and gold earned.
* **Claims:** each reward can be claimed once per account. The database itself refuses a second claim (a key on player, season, tier and track), even if two claims arrive at the same moment.
* **Chests:** the server checks the choice is one of the chest's options; asking for anything else is refused, and an opened chest can't be opened again for a different choice.
* **Premium** is paid from the server's own gold balance.
* **Tonics** go into the inventory on the server, which tells the game.
* **Boosts** are stored on the server with an end time. Admin test XP is never boosted.
* **Private data:** players can read only their own season progress, claims and items (Row Level Security), and can't write to any of those tables.
* **The admin list** is sent only to accounts marked admin in the database. It contains names, kingdoms, gold, positions and last-seen times, never emails or account ids.

### Tested

With a local stand-in for Supabase (real Postgres running both SQL files and their security rules) and the real servers:

* **Seasonal server:** 104 checks. They cover the calendar, the whole Spring campaign and finale with two players, and cheating attempts (claiming early, claiming twice at once, choosing a chest option that isn't there, writing to the database directly). They also cover chests, tonics, boosts (×1.5 event XP confirmed), bonus tiers to 150, the wardrobe, challenges, the Winterfest hunt and live events. Separately, 19 calendar checks.
* **Multiplayer:** 91 checks, on both the live and the seasonal server. They include the admin list (non-admins refused, no private fields) and summons.
* **Two real browsers** (Chromium) on each version: the loading screen and its progress, Enter-to-send (including whispers and the To box), the home screen (desktop and phone width), and the admin list (search, filter, Go to, Bring here, moving straight after teleporting). On the seasonal version they also cover chapter 1 played through the UI, Claim all, opening chests, the reward card, Try it on, the wardrobe seen by the other player, and graphics settings. No JavaScript errors.
* **Upgrading:** a character made on the previous live server, with its database, kept its name, gold, inventory, job, medals and position after `seasons.sql` was run and the seasonal server took over. That server picked Autumn from the real date, and Autumn rewards could be claimed and equipped.

### Not done, or not yet seen

* **The 3D seasonal look hasn't been checked by eye.** Three.js can't be downloaded in my workspace, so the browser tests ran with a stand-in for it. The panels, menus and HUD shown in screenshots are real. The petals, leaves, snow, decorations, fog tint, story characters and markers in the 3D world haven't been looked at. Please check them in the game.
* **The graphics overhaul is settings plus seasonal atmosphere.** There are no new terrain, water or sky shaders, building or character models, or animations.
* **Summer, Autumn and Winter stories** are outlines only. Their battle passes, items, holidays and events are complete.
* On Render's free plan the server sleeps after 15 minutes without players; the first visitor waits about 30 seconds.

---

## Adding the seasonal update to a running game

Your players, characters and progress stay as they are. Do it in this order:

1. **Supabase** (your existing project): SQL Editor → New query → paste the whole of `supabase/seasons.sql` → **Run**. It only adds tables and one column; it doesn't change existing data. Running it twice is safe.
2. **GitHub**: upload the update's files over the old ones (keep your own `js/config.js`).
3. **Render** redeploys the server and the game page on its own after the commit. Check `https://<server>.onrender.com/health`, then open the game. The server log shows the season it picked, e.g. `season: Autumn (autumn-2026)`.

If the code goes up before the SQL, the game still runs, but season progress can't be saved until `seasons.sql` has been run.

---

## Troubleshooting

* **"Cannot reach the multiplayer server. Retrying…"**: check `SERVER_URL`, use `wss://` for an https site, and open `https://<server>/health` in a browser. A sleeping free Render server takes about 30 seconds to wake.
* **"Could not load the realm from Supabase" in the server log**: `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is wrong, or `schema.sql` hasn't been run.
* **"Your login has expired"**: sign in again. This also appears if the game and the server point at different Supabase projects.
* **New account can't sign in**: confirm the email (check spam), or turn off email confirmation while testing.
* **Server log says `403` from the browser**: the site's address isn't in `ALLOWED_ORIGINS`.
* **Debugging in the browser console**: `AOC_NET.state` shows the connection, other players and chat history. `AOC_NET.say('global','hello')` sends a message.
