# Entrancle 🔔

A Heardle-style game for wrestling fans: hear the start of a wrestler's entrance theme and name **the wrestler or the song** in six tries.

- **Daily**: one theme a day, the same for everyone (it changes at local midnight), with a shareable result grid.
- **Unlimited**: play as many as you like, filtered by promotion (WWE/WWF or AEW) and era (Classic or Modern).
- **343 themes from 278 wrestlers and teams**: Attitude-era legends, the 80s and 90s, modern WWE and AEW.
- The clip grows with each skip or wrong guess: **1s → 2s → 4s → 7s → 11s → 16s**.
- A wrong wrestler from the same promotion and era turns 🟨 amber as a hint.
- Stats, streaks and the guess spread are saved in the browser (localStorage). There's no backend.

## Run it locally

ES modules and `fetch` don't work from `file://`, so serve the folder:

```bash
python3 -m http.server 8000      # or: npm start
# open http://localhost:8000
```

## Deploy

It's a plain static site with no build step. Push the folder to GitHub and turn on **GitHub Pages**, or drag it into Netlify, Cloudflare Pages or Vercel.

## Where the audio comes from

Each theme is stored as an **iTunes track ID**. During play the game asks Apple's public iTunes Lookup API for that track's 30-second preview (`itunes.apple.com/lookup?id=…`). It tries the UK store, then the US one. Nothing is downloaded or hosted by you, and preview links can't go out of date because they're fetched fresh each time. This is the same approach heardle.info uses.

Almost all tracks are official releases: WWE Music Group's "WWE: Song (Wrestler)" singles and compilations, and AEW's "All Elite Wrestling" releases. A few themes that are licensed songs use the original artist's recording: Real American, Cult of Personality, Metalingus, Kingdom, Judas and The Final Countdown.

Note: Apple chooses which 30 seconds the preview covers. Usually it's the start, but sometimes it starts mid-song, so a theme's famous opening (glass shattering, the gong) may not be in the clip.

## Editing the roster

The list lives in `tools/roster.txt`, one wrestler per line:

```
Wrestler|Era|alias1,alias2|Song title#iTunesTrackId#W ;; Another theme#iTunesTrackId#A
```

`W` = WWE/WWF and `A` = AEW. `Era` is `Classic` or `Modern`. Aliases count as correct guesses (e.g. `HBK`, `Daniel Bryan`).

To find a track ID, search `https://itunes.apple.com/search?entity=song&country=gb&term=WWE+your+wrestler` and copy the `trackId`. Then rebuild:

```bash
python3 tools/build_data.py       # writes data/themes.json
npm test                          # checks the data and game logic
```

> Adding or removing songs reshuffles the Daily order from that day on, so it's best to make roster changes before you share the game widely.

## Project layout

```
index.html          page markup and dialogs
css/style.css       arena-style dark theme
js/logic.js         pure game logic: daily pick, search, scoring, stats (unit-tested)
js/app.js           UI, audio player, storage, share
data/themes.json    generated roster (don't edit by hand)
tools/roster.txt    source roster
tools/build_data.py builds data/themes.json from roster.txt
tests/              node --test unit tests
```

## Customising

- **Name**: `GAME_NAME` in `js/app.js`, plus the `<title>` and logo in `index.html`. "Heardle" is a Spotify trademark, so this project uses its own name.
- **Clip lengths**: `CLIP_STEPS` in `js/logic.js`.
- **Daily #1 date**: `DAILY_EPOCH` in `js/logic.js`.

Fan-made and not affiliated with WWE, AEW, Apple or Spotify.
