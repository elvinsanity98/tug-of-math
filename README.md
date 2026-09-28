# Tug of Math

A math race drawn as an animated tug of war. Each correct answer is a pull on the rope, and faster answers pull harder. Drag the gold ribbon over your chalk line to win.

Developed by **BongDevz**.

## Modes

| Mode | Teams | What happens |
| ---- | ----- | ------------ |
| **Classic** | 1v1 or 5v5 | Casual games: online quick match, vs the computer, or (1v1) two players on one screen. Earns coins. |
| **Ranked** | 1v1 or 5v5 | Online quick match for stars. Earns 1.5× coins. |
| **Custom** | 1 to 5 a side | A private room with a code. The host picks each team's size, moves any player to the other side with ⇄, and chooses whether computer players fill empty spots. Practice only: no coins or stars. |

Quick match waits about 15 seconds (1v1) or 20 seconds (5v5) for other players, then fills any empty spots with computer players. Every player on the field has their own character, so a 5v5 shows ten pullers.

## Ranks

Ranked stars climb five tiers: **Bronze, Silver, Gold, Platinum, Diamond**. Each tier has divisions **I → V**, and every 10 stars moves you up one division. After Diamond V comes the top tier, **Legend**, where stars count up to 999.

- Win a ranked game: +1 star. Lose: −1 star.
- You never drop out of a tier, and Bronze losses cost nothing.
- Ranked questions match your tier: Bronze and Silver easy, Gold and Platinum medium, Diamond and Legend hard.

Each tier has its own badge, from a bronze shield up to Legend's flaming crest (see the **Ranks** page).

## Coins and skins

Classic and Ranked games pay coins: 10 for playing, 2 per right answer, 20 more for a win (×1.5 in Ranked). Every player starts with 100. The **Shop** sells 12 skins for your puller, from a Sporty Cap to the Robot. Royal Crown, Diamond Halo and Legend Flame also need Gold, Diamond or Legend rank. Your skin shows up for everyone in online games.

## Dashboard

After the landing screen, the dashboard shows your coins, rank and character, and has pages for **Play**, **Shop**, **Ranks**, **Leaderboard**, **History** (your last 25 games) and **Profile** (name and stats).

## Setting it up

### Website (Vercel)

vercel.com → **Add New → Project** → import this repository → Framework preset **Other**, leave the build command empty → **Deploy**. Every push to `main` redeploys. `.vercelignore` keeps `server.js` out, so Vercel serves plain files.

### Supabase (accounts, coins, ranks, online play)

1. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key into `config.js`. Never put the `service_role` / secret key there; the file is public.
2. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**. Players get an account automatically, with no email; it stays in their browser.
3. **SQL Editor**: run `supabase/schema.sql`, then `supabase/002_modes_ranks_skins.sql`. Coins, stars and purchases only change through the database functions in these files, never directly from the page.
4. If online play cannot connect, open **Realtime → Settings** and make sure public channels are allowed.

To remove a player, delete the user under **Authentication → Users**; their profile, skins and results go with it.

Without Supabase or internet the game still runs as a guest: Same PC, vs computer and LAN rooms work, and coins, ranks and the shop switch off.

### LAN (same Wi-Fi, no internet needed)

1. On one computer, double-click `start-lan-server.bat` (or run `node server.js`). It needs [Node.js](https://nodejs.org).
2. The window prints addresses such as `http://192.168.1.20:5173/`. If Windows asks about the firewall, allow access on **private** networks.
3. Everyone opens that address. One player creates a **Custom** room; up to nine others join with the code.

## How it works

- **Two sides:** Red on the left, Blue on the right. Each player gets their own sums with four answer choices.
- **Speed matters:** an answer in under a second gives the strongest pull. Streaks add a bonus. In team games each pull is shared out by team size, so a full team pulls about as hard as one player.
- **Slips:** a wrong answer slides your team back a little and locks you out for one second. The right answer is shown.
- **Winning:** pull the ribbon over your line, or have it on your side when the clock runs out.
- **Online:** the host runs the rope, the clock and the computer players; each device checks its own player's answers. If someone leaves mid-match, a computer player takes over their spot.

## Controls

| Side | Keys |
| ---- | ---- |
| Red  | `A` `S` `D` `F` or `1`–`4` |
| Blue | `J` `K` `L` `;` or `7`–`0` |

Outside Same PC, any of these keys answer for your own player. You can also tap or click the answers.

## Files

- `index.html` – screens: landing, dashboard, match, and the setup, lobby and result panels
- `style.css` – layout and theme
- `app.js` – landing, dashboard pages, Classic setup, quick match, room lobby, results and rewards
- `game.js` – the match: questions, scoring, computer players, rope, clock, online sync, sound
- `scene.js` – canvas renderer: field, characters and their skins, rope, particles, avatars
- `catalog.js` – rank tiers, rank badges and the skin list
- `net.js` – online rooms for 2 to 10 players (LAN WebSocket or Supabase Realtime) and quick match
- `db.js` – player account, coins, skins, ranks, results, leaderboard and history through Supabase
- `config.js` – Supabase Project URL and publishable key
- `supabase/schema.sql`, `supabase/002_modes_ranks_skins.sql` – database tables, rules and functions
- `server.js` – LAN server with no dependencies: serves the game and relays room messages
- `start-lan-server.bat` – double-click launcher for the LAN server on Windows
