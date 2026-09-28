# Tug of Math

A two-sided math race drawn as an animated tug of war. Each correct answer is a pull on the rope, and faster answers pull harder. Drag the gold ribbon over your chalk line to win.

## Three ways to play

| Mode | What you need |
| ---- | ------------- |
| **Same PC** | One computer or tablet. Red and Blue share the keyboard or screen. |
| **LAN** | Two devices on the same Wi-Fi or network, plus Node.js on one of them. No internet needed. |
| **Internet** | Two devices anywhere, both with internet, opening the game from a web address. |

### Same PC

Open `index.html` in a browser and press **Start the tug**.

### LAN (same Wi-Fi, no internet needed)

1. On one computer, double-click `start-lan-server.bat` (or run `node server.js`). It needs [Node.js](https://nodejs.org).
2. The window prints addresses such as `http://192.168.1.20:5173/`. If Windows asks about the firewall, allow access on **private** networks.
3. Both players open that address in a browser.
4. Pick **LAN / Internet** in the menu. One player presses **Host a game**, and the other types the room code and presses **Join**.

### Internet (anywhere)

The page has to be on the web. Any static host works; no build step is needed.

- **Vercel:** vercel.com → **Add New → Project** → import this repository → Framework preset **Other**, leave the build command empty → **Deploy**. Every push to `main` redeploys.
- **GitHub Pages:** repository **Settings → Pages** → **Deploy from a branch**, branch `main`, folder `/ (root)`.

Both players open the site and pick **LAN / Internet**. One hosts; the other joins with the code, or opens the invite link from **Copy invite**.

#### Supabase (recommended for internet play)

With Supabase keys in `config.js`, online games run over [Supabase Realtime](https://supabase.com/docs/guides/realtime) and a **Quick match** button appears that pairs you with anyone else waiting.

1. In the Supabase dashboard open your project → **Project Settings → API**.
2. Copy the **Project URL** and the **anon / publishable** key into `config.js`.
3. Never put the `service_role` / secret key in `config.js`; the file is public.
4. No tables or SQL are needed. If connecting fails, open **Realtime → Settings** and make sure public channels are allowed.

Without Supabase keys the game connects the two browsers directly (WebRTC through [PeerJS](https://peerjs.com)). That needs no account, but a few strict school or office networks block it; Supabase or LAN mode avoids the problem.

## How it works

- **Two sides:** Red on the left, Blue on the right. Each side gets its own question with four answer choices.
- **Speed matters:** an answer in under a second gives the strongest pull. Streaks add a bonus.
- **Slips:** a wrong answer slides your team back a little and locks you out for one second. The right answer is shown.
- **Winning:** pull the ribbon over your line, or have it on your side when the clock runs out.
- **Online:** the host is Red and runs the rules; the guest is Blue. The host picks the settings and starts each round.

## Options

- Same PC with custom names, LAN / Internet, or vs computer (Rookie, Athlete, Champion)
- Math: addition, subtraction, times tables, division, or a mix
- Level: Easy, Medium, Hard
- Round: 60 s, 90 s, or no limit

## Controls

| Side | Keys |
| ---- | ---- |
| Red  | `A` `S` `D` `F` or `1`–`4` |
| Blue | `J` `K` `L` `;` or `7`–`0` |

In online games any of these keys answer for your own side. You can also tap or click the answers. `Enter` starts a round, `Esc` returns to the menu.

## Files

- `index.html` – page markup
- `style.css` – layout and theme
- `scene.js` – canvas renderer: field, characters, rope, particles
- `game.js` – questions, scoring, computer player, online rules, sound, main loop
- `net.js` – connection for online play (LAN WebSocket, Supabase Realtime, or PeerJS WebRTC) and Quick match
- `config.js` – Supabase Project URL and anon key for internet play (optional)
- `server.js` – LAN server with no dependencies: serves the game and relays moves
- `start-lan-server.bat` – double-click launcher for the LAN server on Windows
