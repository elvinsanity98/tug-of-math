# Tug of Math

A two-sided math race drawn as an animated tug of war. Each correct answer is a pull on the rope, and faster answers pull harder. Drag the gold ribbon over your chalk line to win.

## Play

Open `index.html` in any modern browser. No build step or install needed.

Or serve the folder locally:

```bash
python -m http.server 5173
```

Then visit http://localhost:5173/.

## How it works

- **Two sides:** Red on the left, Blue on the right. Each side gets its own question with four answer choices.
- **Speed matters:** an answer in under a second gives the strongest pull. Streaks add a bonus.
- **Slips:** a wrong answer slides your team back a little and locks you out for one second. The right answer is shown.
- **Winning:** pull the ribbon over your line, or have it on your side when the clock runs out.

## Options

- 2 players (with custom names) or vs computer (Rookie, Athlete, Champion)
- Math: addition, subtraction, times tables, division, or a mix
- Level: Easy, Medium, Hard
- Round: 60 s, 90 s, or no limit

## Controls

| Side | Keys |
| ---- | ---- |
| Red  | `A` `S` `D` `F` or `1`–`4` |
| Blue | `J` `K` `L` `;` or `7`–`0` |

You can also tap or click the answers, so two players can share a tablet. `Enter` starts a round, `Esc` returns to the menu.

## Files

- `index.html` – page markup
- `style.css` – layout and theme
- `scene.js` – canvas renderer: field, characters, rope, particles
- `game.js` – questions, scoring, computer player, sound, main loop
