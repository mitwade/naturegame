# Nature — Build a Shared World

A browser implementation of *Nature*, playable:
- **Solo vs Bots** — you + up to 5 computer opponents, one device.
- **Pass & Play** — 2–6 people sharing one device, passing it each turn.
- **Online** — people on their own separate devices/phones, synced live via a
  free Firebase backend. Bots can be added to any online game too.

No build step. It's plain HTML/CSS/JS — open `index.html` or host the folder
as a static site (e.g. GitHub Pages) and it works.

---

## 1. Quick start (local testing)

You can't just double-click `index.html` in some browsers because of how
`fetch`/module loading behaves with `file://` URLs — serve it locally instead:

```bash
cd nature-game
python3 -m http.server 8000
# then open http://localhost:8000
```

Solo vs Bots and Pass & Play work immediately, with **zero setup**. Online
play needs the one-time Firebase setup in section 3 below.

---

## 2. Deploying to GitHub Pages

1. Create a new GitHub repo and push this folder's contents to it (root of
   the repo, or a `/docs` folder — either works, just set Pages accordingly).
2. In the repo: **Settings → Pages → Build and deployment → Source**, choose
   "Deploy from a branch", pick `main` and `/ (root)` (or `/docs`).
3. Wait a minute, then your game is live at
   `https://<your-username>.github.io/<repo-name>/`.

That's it for Solo and Pass & Play. For Online play, do section 3 first.

---

## 3. Online play setup (Firebase — free tier, ~5 minutes)

Online mode uses **Firestore** (a free real-time database from Google/Firebase)
so players on different devices see each other's moves instantly. You need
your own free Firebase project — takes a few minutes, no credit card required
for this usage level.

1. Go to <https://console.firebase.google.com/> and click **Add project**.
   Name it anything (e.g. "nature-game"). You can disable Google Analytics —
   not needed.
2. In your new project, click the **`</>` (Web) icon** to register a web app.
   Give it any nickname, skip Firebase Hosting (you're using GitHub Pages).
3. Firebase will show you a `firebaseConfig` object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "nature-game-xxxxx.firebaseapp.com",
     projectId: "nature-game-xxxxx",
     storageBucket: "nature-game-xxxxx.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   Copy those values into **`js/firebaseConfig.js`** in this project,
   replacing the placeholder `FIREBASE_CONFIG` object.
4. In the Firebase Console, go to **Build → Firestore Database → Create
   database**. Start in **test mode** (fine for a casual game with friends —
   see the security note below if you want to lock it down).
5. Commit and push the updated `js/firebaseConfig.js`, redeploy to GitHub
   Pages (just push — Pages redeploys automatically). Online mode now works.

### Security note
"Test mode" Firestore rules allow anyone with your config to read/write your
database for 30 days, then lock automatically. That's fine for casual use.
If you want it locked down long-term, use rules like this (Firestore →
Rules tab) which only allow read/write on the `nature_games` collection:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /nature_games/{gameId} {
      allow read, write: if true; // anyone with the room code can play
    }
  }
}
```

This is intentionally permissive (anyone who knows/guesses a 5-character
room code can join) — appropriate for a casual party game, not for anything
sensitive.

---

## 4. How online games work

- One player clicks **Create Game**, gets a 5-character room code, shares it
  (text, Discord, whatever).
- Others click **Join a game**, type the code, type their name.
- The host can add bots from the lobby, then clicks **Start Game**.
- Everyone's moves sync live through Firestore. If you refresh the page
  mid-game, rejoin with the same code — your browser remembers who you are
  via a small ID stored in `localStorage`.
- The **host's browser** is responsible for running bots' turns automatically
  (so bots don't double-move if two people's browsers both try). If the host
  closes their tab, bot turns will pause until they reopen it — everyone
  else's human turns are unaffected.

---

## 5. Project structure

```
nature-game/
  index.html              All screens (menu, setup, lobby, game, game-over)
  css/style.css            Styling
  js/
    constants.js            Terrain/shape constants, colors, emoji art
    hexgrid.js               Axial hex-grid math + pattern (triangle/elbow/line) detection
    cards.js                 Generates the 216-card deck (see note below)
    tiles.js                 Generates the 112-tile bag, shuffle helper
    engine.js                Core rules engine: turns, placement, claiming, rounds, scoring
    bot.js                   Bot AI (looks for completable/near-complete patterns)
    render.js                Hex board + card/tile DOM/SVG rendering
    firebaseConfig.js        <- put your Firebase keys here
    online.js                Firestore sync (lobby, game state, transactions)
    app.js                   Main controller wiring UI to engine, for all 3 modes
```

### A note on the Nature Card deck
The rulebook specifies the deck's *composition* precisely (216 unique cards;
72 per pattern shape; 24 "built around" each of the 8 terrains, plus 24
mixed) but the physical card sheets don't come with a machine-readable list
of each individual card's exact terrain combo. `js/cards.js` **generates** a
full 216-card deck that exactly matches the documented distribution,
deterministically and with no duplicates (verified — see below). If you'd
rather use the *exact* original 216 cards, replace `generateDeck()` in that
file with a hard-coded array of `{ shape, terrains: [a,b,c] }` objects; every
other module only depends on that shape, so nothing else needs to change.

---

## 6. Rules implementation notes

A few rulebook details worth knowing how they were interpreted in code:

- **Elbow vs. Triangle vs. Line** are distinguished purely by geometry: three
  mutually-touching tiles = Triangle; a bent 3-tile chain whose ends don't
  touch = Elbow; a straight 3-tile chain = Line. Rotation and mirroring are
  always allowed automatically, since matching works off hex adjacency, not
  fixed screen orientation.
- **Claiming** happens automatically and immediately whenever your placement
  completes a pattern matching a card in your hand or the public Bank (the
  rulebook doesn't describe a choice to decline a completed match).
- **Running out of cards or tiles**: per the rulebook, if the terrain-tile
  deck+discard *or* the Nature Card deck+discard are both fully empty, the
  current turn order finishes and the game ends immediately (rather than
  waiting for a 3rd/4th/5th-card round trigger that may never come).

---

## 7. Customizing art

Right now terrain tiles and cards render with emoji (🌋🌲🌊🏜️🧊🌸🪷⛰️) instead
of custom illustrations, so the game works with zero image assets. To use
your own artwork: edit `TERRAIN_COLORS`/`TERRAIN_EMOJI` in `js/constants.js`,
or swap the emoji `<text>` elements in `js/render.js`'s `renderBoard` and
`renderCard` for `<image>` tags pointing at your own tile/card art files.
