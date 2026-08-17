// Persistent log of every completed game (any mode, any device this browser
// has played on), stored in localStorage. Used for the "Game Records" screen.

const GAME_RECORDS_KEY = "nature_game_records";
const WORLD_RECORDS_COLLECTION = "nature_game_records";
const WORLD_RECORDS_FETCH_LIMIT = 300;
const MODE_LABELS = { solo: "Solo vs Bots", pass: "Pass & Play", online: "Online" };

function loadGameRecords() {
  try {
    const raw = localStorage.getItem(GAME_RECORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveGameRecords(records) {
  try {
    // Cap history length so localStorage doesn't grow unbounded.
    localStorage.setItem(GAME_RECORDS_KEY, JSON.stringify(records.slice(-500)));
  } catch (e) {
    // best-effort
  }
}

// Records the result of a finished game exactly once (idempotent on
// state.id, since online mode's Firestore listener may fire the "finished"
// update more than once). Saves to this browser's local history AND — if
// online play is configured — to a shared "world" collection so every
// completed game (from anyone, any device) shows up on the World tab.
function recordGameResult(state, mode) {
  if (!state || !state.finalScores) return;
  const records = loadGameRecords();
  if (records.some(r => r.gameId === state.id)) return;
  const record = {
    gameId: state.id,
    mode: mode || state.mode || "local",
    timestamp: Date.now(),
    playerCount: state.players.length,
    players: state.finalScores.map(s => ({
      name: s.name,
      points: s.points,
      cardsCompleted: s.cardsCompleted
    }))
  };
  records.push(record);
  saveGameRecords(records);
  submitWorldRecord(record);
}

// Fire-and-forget write to the shared world collection. Never blocks or
// breaks gameplay if it fails (offline, Firestore not configured, etc.) —
// world records are a nice-to-have, not required for the game to work.
async function submitWorldRecord(record) {
  if (typeof isFirebaseConfigured !== "function" || !isFirebaseConfigured()) return;
  try {
    const db = getFirestore();
    await db.collection(WORLD_RECORDS_COLLECTION).doc(record.gameId).set(record);
  } catch (e) {
    console.warn("Could not submit world record:", e);
  }
}

// Pulls the most recent N games from the shared world collection. World
// stats are computed from this sample (not literally every game ever, for
// a client-only app without server-side aggregation) — recent-first, so
// the sample is always the freshest slice of activity.
async function fetchWorldRecords() {
  if (typeof isFirebaseConfigured !== "function" || !isFirebaseConfigured()) return [];
  try {
    const db = getFirestore();
    const snap = await db.collection(WORLD_RECORDS_COLLECTION)
      .orderBy("timestamp", "desc")
      .limit(WORLD_RECORDS_FETCH_LIMIT)
      .get();
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.warn("Could not fetch world records:", e);
    return [];
  }
}

// Groups a given list of records by (mode, playerCount) and computes the
// stats shown on the Game Records screen. Works for either the local
// history or a fetched world sample.
function computeStatsFromRecords(records) {
  const groups = {};
  records.forEach(r => {
    const k = r.mode + "|" + r.playerCount;
    if (!groups[k]) groups[k] = { mode: r.mode, playerCount: r.playerCount, games: 0, scores: [], cardCounts: [] };
    groups[k].games++;
    r.players.forEach(p => {
      groups[k].scores.push(p.points);
      groups[k].cardCounts.push(p.cardsCompleted);
    });
  });
  return Object.values(groups)
    .map(g => ({
      mode: g.mode,
      playerCount: g.playerCount,
      games: g.games,
      highest: Math.max(...g.scores),
      lowest: Math.min(...g.scores),
      average: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
      avgCards: g.cardCounts.reduce((a, b) => a + b, 0) / g.cardCounts.length
    }))
    .sort((a, b) => (a.mode === b.mode ? a.playerCount - b.playerCount : a.mode.localeCompare(b.mode)));
}

// Convenience wrapper for the local ("Yours") tab.
function computeGameStats() {
  return computeStatsFromRecords(loadGameRecords());
}
