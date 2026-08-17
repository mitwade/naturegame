// Persistent log of every completed game (any mode, any device this browser
// has played on), stored in localStorage. Used for the "Game Records" screen.

const GAME_RECORDS_KEY = "nature_game_records";
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
// update more than once).
function recordGameResult(state, mode) {
  if (!state || !state.finalScores) return;
  const records = loadGameRecords();
  if (records.some(r => r.gameId === state.id)) return;
  records.push({
    gameId: state.id,
    mode: mode || state.mode || "local",
    timestamp: Date.now(),
    playerCount: state.players.length,
    players: state.finalScores.map(s => ({
      name: s.name,
      points: s.points,
      cardsCompleted: s.cardsCompleted
    }))
  });
  saveGameRecords(records);
}

// Groups all recorded games by (mode, playerCount) and computes the stats
// requested for the Game Records screen.
function computeGameStats() {
  const records = loadGameRecords();
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
