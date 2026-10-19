# 💜 Rummikub — Purple Edition

A browser version of the classic tile game, with a purple glow-up. Play against 1–3 bots
at three difficulty levels. Live at **[rummikub.kenlill.com](https://rummikub.kenlill.com)**.

No build step and no dependencies — it's plain HTML, CSS and JavaScript modules.

## Features

- Full rules: runs, groups, jokers, the 30-point initial meld, and free table rearranging after you've melded
- Drag and drop tiles, or tap to select several and tap where they should go (works great on phones)
- Undo, reset turn, hints, and sort-by-color / sort-by-number
- Bots that search for the best melds; Normal bots lay off onto the table, Hard bots also borrow spare tiles and split runs
- Game auto-saves each turn so you can continue later, plus a win counter
- Synth sound effects (mutable) and confetti when you win
- Play against three original characters — Marco, Lou and Dino — in a sunny platformer-style world
  (sky, hills, pipes, ? blocks and a brick-block rack); all artwork is original SVG in `img/`

## Run locally

```sh
npm start        # serves at http://localhost:8080 (uses python3)
npm test         # rules + bot tests (Node 18+)
```

Any static file server works — ES modules just need to be served over http, not opened as `file://`.

## Project layout

| Path | What it does |
| --- | --- |
| `index.html` | Screens and dialogs |
| `css/styles.css` | The purple theme |
| `js/rules.js` | Tiles, set validation, scoring, turn validation (pure, tested) |
| `js/ai.js` | Bot move search |
| `js/main.js` | Game flow, rendering, drag & drop |
| `js/sound.js`, `js/confetti.js` | Effects |

## Deploying to rummikub.kenlill.com

The workflow in `.github/workflows/pages.yml` runs the tests and publishes the site to GitHub Pages
on every push to `main`. One-time setup:

1. **Repo → Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
2. **Settings → Pages → Custom domain:** enter `rummikub.kenlill.com` and save (then tick **Enforce HTTPS** once the certificate is issued).
3. **DNS for kenlill.com:** add a `CNAME` record — name `rummikub`, value `klill6506.github.io`.
   (If kenlill.com is on Cloudflare, set it to *DNS only* — grey cloud — until GitHub issues the certificate.)

The site is fully static, so it can also be hosted on Render, Netlify, Cloudflare Pages, etc. —
just publish the repo root with no build command.
