// Online multiplayer via Firestore. One document per game room, keyed by a
// short human-typeable room code. The full engine `state` object (already
// plain JSON) is stored directly on the document and re-synced on every
// change — simplest possible approach, fine at this game's scale.
//
// Concurrency note: engine action functions already refuse to act on behalf
// of the wrong player (state.currentPlayerIndex check), so the main risk is
// two clients writing stale copies of `state` at once. We mitigate with a
// Firestore transaction on every write (read-modify-write against the
// latest server copy) rather than blind overwrites.

const GAMES_COLLECTION = "nature_games";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function getOrCreateLocalPlayerId() {
  let id = localStorage.getItem("nature_player_id");
  if (!id) {
    id = "u" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("nature_player_id", id);
  }
  return id;
}

async function createOnlineGame(hostName) {
  const db = getFirestore();
  const playerId = getOrCreateLocalPlayerId();
  let code;
  let attempts = 0;
  // Extremely unlikely to collide, but check anyway.
  do {
    code = generateRoomCode();
    attempts++;
    const existing = await db.collection(GAMES_COLLECTION).doc(code).get();
    if (!existing.exists) break;
  } while (attempts < 5);

  const doc = {
    code,
    hostId: playerId,
    status: "lobby",
    lobbyPlayers: [{ id: playerId, name: hostName || "Host", isBot: false }],
    state: null,
    updatedAt: Date.now()
  };
  await db.collection(GAMES_COLLECTION).doc(code).set(doc);
  return { code, playerId };
}

async function joinOnlineGame(code, name) {
  const db = getFirestore();
  code = code.toUpperCase().trim();
  const playerId = getOrCreateLocalPlayerId();
  const ref = db.collection(GAMES_COLLECTION).doc(code);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("No game found with that code.");
    const data = snap.data();
    if (data.status === "lobby") {
      const already = data.lobbyPlayers.find(p => p.id === playerId);
      if (!already) {
        if (data.lobbyPlayers.length >= 6) throw new Error("Lobby is full (max 6).");
        data.lobbyPlayers.push({ id: playerId, name: name || "Player", isBot: false });
        tx.update(ref, { lobbyPlayers: data.lobbyPlayers, updatedAt: Date.now() });
      }
    } else if (data.status === "playing") {
      const inGame = data.state && data.state.players.some(p => p.id === playerId);
      if (!inGame) throw new Error("That game has already started.");
    } else {
      throw new Error("That game has already finished.");
    }
    return data;
  });

  return { code, playerId, data: result };
}

async function addBotToLobby(code) {
  const db = getFirestore();
  const ref = db.collection(GAMES_COLLECTION).doc(code);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (data.lobbyPlayers.length >= 6) return;
    const botNum = data.lobbyPlayers.filter(p => p.isBot).length + 1;
    data.lobbyPlayers.push({ id: "bot" + botNum + "_" + Math.random().toString(36).slice(2, 6), name: "Bot " + botNum, isBot: true });
    tx.update(ref, { lobbyPlayers: data.lobbyPlayers, updatedAt: Date.now() });
  });
}

async function removeLobbyPlayer(code, playerId) {
  const db = getFirestore();
  const ref = db.collection(GAMES_COLLECTION).doc(code);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    data.lobbyPlayers = data.lobbyPlayers.filter(p => p.id !== playerId);
    tx.update(ref, { lobbyPlayers: data.lobbyPlayers, updatedAt: Date.now() });
  });
}

async function startOnlineGame(code) {
  const db = getFirestore();
  const ref = db.collection(GAMES_COLLECTION).doc(code);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (data.status !== "lobby") return;
    if (data.lobbyPlayers.length < 2) throw new Error("Need at least 2 players (add a bot if playing alone online).");
    const gameState = createGame(data.lobbyPlayers, { mode: "online", id: code });
    initFirstTurn(gameState);
    tx.update(ref, { status: "playing", state: gameState, updatedAt: Date.now() });
  });
}

function subscribeToGame(code, onUpdate) {
  const db = getFirestore();
  return db.collection(GAMES_COLLECTION).doc(code).onSnapshot(snap => {
    if (!snap.exists) { onUpdate(null); return; }
    onUpdate(snap.data());
  }, err => {
    console.error("Online sync error:", err);
  });
}

// Apply a mutator function to the latest server state inside a transaction,
// then write it back. `mutator(state)` should mutate the state in place
// using engine functions and return a short description (optional).
async function updateGameState(code, mutator) {
  const db = getFirestore();
  const ref = db.collection(GAMES_COLLECTION).doc(code);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !data.state) return;
    mutator(data.state);
    if (data.state.gameOver) data.status = "finished";
    tx.update(ref, { state: data.state, status: data.status, updatedAt: Date.now() });
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    createOnlineGame, joinOnlineGame, addBotToLobby, removeLobbyPlayer,
    startOnlineGame, subscribeToGame, updateGameState, getOrCreateLocalPlayerId,
    generateRoomCode
  };
}
