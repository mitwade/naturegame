// Main app controller. Wires together engine + render + online modules
// across three modes: solo (vs bots), pass (pass-and-play on one device),
// and online (Firestore-synced, separate devices).

// ---------- Global state ----------
let MODE = null;              // 'solo' | 'pass' | 'online'
let STATE = null;             // current engine game state (mirror of Firestore in online mode)
let LOCAL_SETUP_PLAYERS = []; // [{id,name,isBot}] while configuring solo/pass
let ONLINE_CODE = null;
let ONLINE_PLAYER_ID = null;
let ONLINE_HOST_ID = null;
let ONLINE_UNSUB = null;
let ONLINE_STATUS = null;

// In-progress UI selection for the current action
let placementMode = false;
let pendingPlacements = [];     // [{terrain,q,r}]
let stagedBoardKeys = new Set();
let selectedTileIndex = null;

let drawTilesMode = false;
let pendingTilePicks = [];      // [{source:'market',marketIndex} | {source:'draw'}]

let passOverlayShownFor = null; // player index we've already shown the overlay for this render

// ---------- Screen helpers ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "claim-toast";
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---------- Menu ----------
document.querySelectorAll(".mode-card").forEach(card => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;
    if (mode === "solo" || mode === "pass") openLocalSetup(mode);
    else openOnlineSetup();
  });
});

// ---------- Local setup (solo / pass) ----------
function openLocalSetup(mode) {
  MODE = mode;
  LOCAL_SETUP_PLAYERS = [];
  if (mode === "solo") {
    LOCAL_SETUP_PLAYERS.push({ id: "human1", name: "You", isBot: false });
    LOCAL_SETUP_PLAYERS.push({ id: "bot1", name: "Bot 1", isBot: true });
    document.getElementById("local-setup-title").textContent = "Solo vs Bots";
  } else {
    LOCAL_SETUP_PLAYERS.push({ id: "human1", name: "Player 1", isBot: false });
    LOCAL_SETUP_PLAYERS.push({ id: "human2", name: "Player 2", isBot: false });
    document.getElementById("local-setup-title").textContent = "Pass & Play Setup";
  }
  renderLocalSetupList();
  showScreen("screen-local-setup");
}

function renderLocalSetupList() {
  const container = document.getElementById("player-list");
  container.innerHTML = "";
  LOCAL_SETUP_PLAYERS.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <span>${p.isBot ? "🤖" : "🧑"}</span>
      <input type="text" value="${p.name}" data-idx="${i}" />
      <span style="font-size:12px;color:var(--text-dim);">${p.isBot ? "Bot" : "Human"}</span>
      <button class="secondary small" data-remove="${i}">✕</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll("input[type=text]").forEach(inp => {
    inp.addEventListener("input", e => {
      LOCAL_SETUP_PLAYERS[+e.target.dataset.idx].name = e.target.value;
    });
  });
  container.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      LOCAL_SETUP_PLAYERS.splice(+btn.dataset.remove, 1);
      renderLocalSetupList();
    });
  });
}

document.getElementById("btn-add-human").addEventListener("click", () => {
  if (LOCAL_SETUP_PLAYERS.length >= 6) return toast("Max 6 players.");
  const n = LOCAL_SETUP_PLAYERS.filter(p => !p.isBot).length + 1;
  LOCAL_SETUP_PLAYERS.push({ id: "human" + Date.now(), name: "Player " + n, isBot: false });
  renderLocalSetupList();
});
document.getElementById("btn-add-bot").addEventListener("click", () => {
  if (LOCAL_SETUP_PLAYERS.length >= 6) return toast("Max 6 players.");
  const n = LOCAL_SETUP_PLAYERS.filter(p => p.isBot).length + 1;
  LOCAL_SETUP_PLAYERS.push({ id: "bot" + Date.now(), name: "Bot " + n, isBot: true });
  renderLocalSetupList();
});
document.getElementById("btn-local-back").addEventListener("click", () => showScreen("screen-menu"));

document.getElementById("btn-local-start").addEventListener("click", () => {
  if (LOCAL_SETUP_PLAYERS.length < 2) return toast("Need at least 2 players.");
  if (MODE === "pass" && LOCAL_SETUP_PLAYERS.filter(p => !p.isBot).length < 1) {
    return toast("Pass & Play needs at least 1 human.");
  }
  STATE = createGame(LOCAL_SETUP_PLAYERS);
  initFirstTurn(STATE);
  startGameScreen();
});

// ---------- Online setup ----------
function openOnlineSetup() {
  MODE = "online";
  document.getElementById("online-setup-error").textContent = "";
  if (!isFirebaseConfigured()) {
    document.getElementById("online-setup-error").textContent =
      "Online play isn't configured yet — the site owner needs to add Firebase project keys in js/firebaseConfig.js (see README).";
  }
  showScreen("screen-online-setup");
}
document.getElementById("btn-online-back").addEventListener("click", () => showScreen("screen-menu"));

document.getElementById("btn-online-create").addEventListener("click", async () => {
  try {
    const name = document.getElementById("online-name").value.trim() || "Host";
    const { code, playerId } = await createOnlineGame(name);
    ONLINE_CODE = code; ONLINE_PLAYER_ID = playerId;
    enterOnlineLobby();
  } catch (e) {
    document.getElementById("online-setup-error").textContent = e.message || String(e);
  }
});

document.getElementById("btn-online-join").addEventListener("click", async () => {
  try {
    const name = document.getElementById("online-name").value.trim() || "Player";
    const code = document.getElementById("online-join-code").value.trim().toUpperCase();
    if (!code) return;
    const { playerId } = await joinOnlineGame(code, name);
    ONLINE_CODE = code; ONLINE_PLAYER_ID = playerId;
    enterOnlineLobby();
  } catch (e) {
    document.getElementById("online-setup-error").textContent = e.message || String(e);
  }
});

function enterOnlineLobby() {
  document.getElementById("lobby-code").textContent = ONLINE_CODE;
  showScreen("screen-online-lobby");
  if (ONLINE_UNSUB) ONLINE_UNSUB();
  ONLINE_UNSUB = subscribeToGame(ONLINE_CODE, onOnlineDocUpdate);
}

function onOnlineDocUpdate(data) {
  if (!data) { toast("Game no longer exists."); showScreen("screen-menu"); return; }
  ONLINE_HOST_ID = data.hostId;
  ONLINE_STATUS = data.status;

  if (data.status === "lobby") {
    renderLobbyPlayers(data.lobbyPlayers);
    const isHost = ONLINE_PLAYER_ID === data.hostId;
    document.getElementById("lobby-host-controls").classList.toggle("hidden", !isHost);
    document.getElementById("lobby-wait-msg").classList.toggle("hidden", isHost);
    showScreen("screen-online-lobby");
  } else if (data.status === "playing" || data.status === "finished") {
    STATE = data.state;
    if (!document.getElementById("screen-game").classList.contains("hidden") === false) {
      // ensure we're on the game screen
    }
    startGameScreen(true);
    if (data.status === "finished") showGameOver();
    maybeRunBotTurn();
  }
}

function renderLobbyPlayers(players) {
  const el = document.getElementById("lobby-players");
  el.innerHTML = players.map(p => `<div class="player-row"><span>${p.isBot ? "🤖" : "🧑"}</span> ${p.name}</div>`).join("");
}

document.getElementById("btn-lobby-add-bot").addEventListener("click", () => addBotToLobby(ONLINE_CODE));
document.getElementById("btn-lobby-start").addEventListener("click", async () => {
  try {
    await startOnlineGame(ONLINE_CODE);
  } catch (e) {
    toast(e.message || String(e));
  }
});
document.getElementById("btn-lobby-leave").addEventListener("click", () => {
  if (ONLINE_UNSUB) ONLINE_UNSUB();
  if (ONLINE_CODE && ONLINE_PLAYER_ID) removeLobbyPlayer(ONLINE_CODE, ONLINE_PLAYER_ID).catch(() => {});
  ONLINE_CODE = null; ONLINE_PLAYER_ID = null;
  showScreen("screen-menu");
});

// ---------- Shared game action plumbing ----------

// Applies a mutator(state) => void either directly (local modes) or via a
// Firestore transaction (online mode), then re-renders.
async function applyAction(mutator) {
  if (MODE === "online") {
    await updateGameState(ONLINE_CODE, mutator).catch(e => toast(e.message || String(e)));
    // re-render happens via the onSnapshot listener
  } else {
    mutator(STATE);
    renderGame();
    afterLocalStateChange();
  }
}

function afterLocalStateChange() {
  if (STATE.gameOver) { showGameOver(); return; }
  if (MODE === "pass") maybePassDeviceOverlay();
  maybeRunBotTurn();
}

function getMyPlayerIndex() {
  if (MODE === "solo") return 0;
  if (MODE === "pass") return STATE.currentPlayerIndex;
  if (MODE === "online") return STATE.players.findIndex(p => p.id === ONLINE_PLAYER_ID);
  return -1;
}

function isMyTurn() {
  if (!STATE) return false;
  const mi = getMyPlayerIndex();
  return mi === STATE.currentPlayerIndex;
}

function amIHostForBots() {
  if (MODE !== "online") return true;
  return ONLINE_PLAYER_ID === ONLINE_HOST_ID;
}

let botTurnInFlight = false;
function maybeRunBotTurn() {
  if (!STATE || STATE.gameOver) return;
  const cur = STATE.players[STATE.currentPlayerIndex];
  if (!cur || !cur.isBot) return;
  if (!amIHostForBots()) return;
  if (botTurnInFlight) return;
  botTurnInFlight = true;
  setTimeout(async () => {
    await applyAction(state => { runBotTurn(state, state.currentPlayerIndex); });
    botTurnInFlight = false;
  }, 700);
}

function maybePassDeviceOverlay() {
  const cur = STATE.players[STATE.currentPlayerIndex];
  if (!cur || cur.isBot) return;
  if (passOverlayShownFor === STATE.currentPlayerIndex) return;
  passOverlayShownFor = STATE.currentPlayerIndex;
  document.getElementById("pass-device-name").textContent = cur.name;
  document.getElementById("pass-device-overlay").classList.remove("hidden");
}
document.getElementById("btn-pass-ready").addEventListener("click", () => {
  document.getElementById("pass-device-overlay").classList.add("hidden");
});

// ---------- Game screen ----------
function startGameScreen(fromOnline) {
  showScreen("screen-game");
  placementMode = false; pendingPlacements = []; stagedBoardKeys = new Set(); selectedTileIndex = null;
  drawTilesMode = false; pendingTilePicks = [];
  passOverlayShownFor = null;
  renderGame();
  if (MODE === "pass") maybePassDeviceOverlay();
  maybeRunBotTurn();
}

function dynamicLegalSpots() {
  // Legal spots given the real board PLUS any tiles staged this action so far.
  const board = boardMap(STATE.board);
  stagedBoardKeys.forEach(k => board.set(k, "staged"));
  const candidates = new Set();
  board.forEach((v, k) => {
    const { q, r } = parseKey(k);
    neighborsOf(q, r).forEach(n => {
      const nk = key(n.q, n.r);
      if (!board.has(nk)) candidates.add(nk);
    });
  });
  const minTouch = (STATE.firstTilePlacedEver || stagedBoardKeys.size > 0) ? 2 : 1;
  return [...candidates].filter(k => {
    const { q, r } = parseKey(k);
    let touch = 0;
    neighborsOf(q, r).forEach(n => { if (board.has(key(n.q, n.r))) touch++; });
    return touch >= minTouch;
  });
}

function renderGame() {
  if (!STATE) return;
  const me = getMyPlayerIndex();
  const myTurn = isMyTurn();

  document.getElementById("game-round-label").textContent = `Round ${STATE.round} of 3`;
  const curPlayer = STATE.players[STATE.currentPlayerIndex];
  document.getElementById("game-turn-label").textContent =
    `  •  ${curPlayer.name}'s turn (${STATE.turnActionsUsed.length}/2 actions used)`;

  // Players bar
  const inline = document.getElementById("players-inline");
  inline.innerHTML = "";
  STATE.players.forEach((p, i) => {
    const pts = p.score.reduce((s, cid) => s + CARDS_BY_ID[cid].points, 0);
    const chip = document.createElement("span");
    chip.className = "player-chip" + (i === STATE.currentPlayerIndex ? " active" : "");
    chip.innerHTML = `${p.isBot ? "🤖" : "🧑"} ${p.name}<span class="pts">${pts}pt</span>`;
    inline.appendChild(chip);
  });

  // Board
  const legalSpots = placementMode && myTurn ? dynamicLegalSpots() : [];
  renderBoard(document.getElementById("board-svg"), STATE, legalSpots, onBoardSpotClick);

  // Tile pool (only show/interact if it's my turn)
  const poolEl = document.getElementById("tile-tray");
  poolEl.innerHTML = "";
  const player = STATE.players[me] || STATE.players[STATE.currentPlayerIndex];
  document.getElementById("pool-count").textContent = `(${player.pool.length}/7)`;
  const stagedTerrainsUsed = pendingPlacements.map(p => p.terrain);
  const remaining = player.pool.slice();
  stagedTerrainsUsed.forEach(t => remaining.splice(remaining.indexOf(t), 1));

  player.pool.forEach((terrain, idx) => {
    const isStagedAway = (() => {
      // crude: mark chips as unavailable once enough of that terrain are staged
      const usedCount = stagedTerrainsUsed.filter(t => t === terrain).length;
      const sameTerrainIdxBefore = player.pool.slice(0, idx).filter(t => t === terrain).length;
      return sameTerrainIdxBefore < usedCount;
    })();
    const chip = renderTileChip(terrain, {
      selected: selectedTileIndex === idx,
      disabled: !myTurn || !placementMode || isStagedAway || pendingPlacements.length >= 2,
      onClick: () => { selectedTileIndex = (selectedTileIndex === idx ? null : idx); renderGame(); }
    });
    poolEl.appendChild(chip);
  });

  // Market
  const marketEl = document.getElementById("market-tray");
  marketEl.innerHTML = "";
  STATE.tileMarket.forEach((terrain, idx) => {
    const selected = pendingTilePicks.some(p => p.source === "market" && p._displayIdx === idx);
    const tile = renderMarketTile(terrain, {
      selected,
      onClick: () => onMarketTileClick(idx)
    });
    marketEl.appendChild(tile);
  });
  document.getElementById("draw-tiles-selected-label").textContent =
    drawTilesMode ? `Selected: ${pendingTilePicks.length}/${Math.min(2, 7 - player.pool.length)}` : "";

  // Bank
  const bankEl = document.getElementById("bank-row");
  bankEl.innerHTML = "";
  STATE.bank.forEach(cardId => {
    bankEl.appendChild(renderCard(cardId, {}));
  });

  // Hand (only show the acting player's hand for local pass mode / solo;
  // in online mode this is inherently only-my-data since we only see our
  // own hand array... but Firestore stores everyone's hand in one doc, so
  // for online we must only DISPLAY our own hand, not everyone's.)
  const handEl = document.getElementById("hand-row");
  handEl.innerHTML = "";
  const handOwner = MODE === "online" ? STATE.players[me] : player;
  if (handOwner) {
    handOwner.hand.forEach(cardId => handEl.appendChild(renderCard(cardId, {})));
  }

  // Log
  const logEl = document.getElementById("log-box");
  logEl.innerHTML = STATE.log.slice(-40).map(l => `<div>${l}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;

  // Action bar
  const canPlay = myTurn && canUseAction(STATE, STATE.currentPlayerIndex, "playTiles");
  const canDrawCards = myTurn && canUseAction(STATE, STATE.currentPlayerIndex, "drawCards");
  const canDrawTiles = myTurn && canUseAction(STATE, STATE.currentPlayerIndex, "drawTiles");

  document.getElementById("btn-action-play-tiles").classList.toggle("hidden", placementMode);
  document.getElementById("btn-action-play-tiles").disabled = !canPlay;
  document.getElementById("btn-action-draw-cards").disabled = !canDrawCards || placementMode || drawTilesMode;
  document.getElementById("btn-action-draw-cards").classList.toggle("hidden", drawTilesMode);
  document.getElementById("btn-action-draw-tiles").classList.toggle("hidden", placementMode || drawTilesMode);
  document.getElementById("btn-action-draw-tiles").disabled = !canDrawTiles;

  document.getElementById("btn-action-confirm-placement").classList.toggle("hidden", !placementMode);
  document.getElementById("btn-action-confirm-placement").disabled = pendingPlacements.length === 0;
  document.getElementById("btn-action-cancel-placement").classList.toggle("hidden", !placementMode);

  document.getElementById("btn-action-confirm-draw-tiles").classList.toggle("hidden", !drawTilesMode);
  document.getElementById("btn-action-confirm-draw-tiles").disabled = pendingTilePicks.length === 0;
  document.getElementById("btn-draw-tiles-draw").classList.toggle("hidden", !drawTilesMode);

  document.getElementById("btn-end-turn").disabled = !(myTurn && STATE.turnActionsUsed.length >= 2);
  document.getElementById("action-status").textContent = myTurn ? "" : `Waiting for ${curPlayer.name}…`;
}

function onBoardSpotClick(spotKey) {
  if (!placementMode) return;
  if (selectedTileIndex === null) { toast("Select a tile from your pool first."); return; }
  const me = getMyPlayerIndex();
  const player = STATE.players[me] || STATE.players[STATE.currentPlayerIndex];
  const terrain = player.pool[selectedTileIndex];
  const { q, r } = parseKey(spotKey);
  pendingPlacements.push({ terrain, q, r });
  stagedBoardKeys.add(spotKey);
  selectedTileIndex = null;
  renderGame();
}

document.getElementById("btn-action-play-tiles").addEventListener("click", () => {
  placementMode = true; pendingPlacements = []; stagedBoardKeys = new Set(); selectedTileIndex = null;
  renderGame();
});
document.getElementById("btn-action-cancel-placement").addEventListener("click", () => {
  placementMode = false; pendingPlacements = []; stagedBoardKeys = new Set(); selectedTileIndex = null;
  renderGame();
});
document.getElementById("btn-action-confirm-placement").addEventListener("click", async () => {
  const placements = pendingPlacements.slice();
  const myIndexAtClick = getMyPlayerIndex();
  placementMode = false; pendingPlacements = []; stagedBoardKeys = new Set(); selectedTileIndex = null;
  await applyAction(state => {
    const pi = state.currentPlayerIndex;
    const res = playTiles(state, pi, placements);
    if (!res.success) { toast(res.error); return; }
    if (res.claimable && res.claimable.length) {
      res.claimable.forEach(m => {
        const cr = claimCard(state, pi, m.cardId);
        if (cr.success) toast(`🎉 ${state.players[pi].name} claimed a ${cr.card.shape} card (+${cr.card.points}pt)!`);
      });
    }
  });
});

document.getElementById("btn-action-draw-cards").addEventListener("click", async () => {
  await applyAction(state => {
    const res = drawCards(state, state.currentPlayerIndex);
    if (!res.success) toast(res.error);
  });
});

document.getElementById("btn-action-draw-tiles").addEventListener("click", () => {
  drawTilesMode = true; pendingTilePicks = [];
  renderGame();
});
document.getElementById("btn-draw-tiles-draw").addEventListener("click", () => {
  const me = getMyPlayerIndex();
  const player = STATE.players[me] || STATE.players[STATE.currentPlayerIndex];
  const maxPick = Math.min(2, 7 - player.pool.length);
  if (pendingTilePicks.length >= maxPick) return toast("Already selected max tiles.");
  pendingTilePicks.push({ source: "draw" });
  renderGame();
});
function onMarketTileClick(idx) {
  if (!drawTilesMode) return;
  const me = getMyPlayerIndex();
  const player = STATE.players[me] || STATE.players[STATE.currentPlayerIndex];
  const maxPick = Math.min(2, 7 - player.pool.length);
  const existingAt = pendingTilePicks.findIndex(p => p.source === "market" && p._displayIdx === idx);
  if (existingAt !== -1) { pendingTilePicks.splice(existingAt, 1); renderGame(); return; }
  if (pendingTilePicks.length >= maxPick) return toast("Already selected max tiles.");
  pendingTilePicks.push({ source: "market", marketIndex: idx, _displayIdx: idx });
  renderGame();
}
document.getElementById("btn-action-confirm-draw-tiles").addEventListener("click", async () => {
  const picks = pendingTilePicks.map(p => p.source === "market" ? { source: "market", marketIndex: p.marketIndex } : { source: "draw" });
  drawTilesMode = false; pendingTilePicks = [];
  await applyAction(state => {
    const res = drawTiles(state, state.currentPlayerIndex, picks);
    if (!res.success) toast(res.error);
  });
});

document.getElementById("btn-end-turn").addEventListener("click", async () => {
  await applyAction(state => {
    const res = endTurn(state);
    if (!res.success) toast(res.error);
  });
});

// ---------- Game over ----------
function showGameOver() {
  showScreen("screen-gameover");
  const table = document.getElementById("final-scores-table");
  const winners = STATE.winner || [];
  const rows = STATE.finalScores
    .slice()
    .sort((a, b) => b.points - a.points)
    .map(s => `<tr class="${winners.includes(s.id) ? "winner" : ""}"><td>${winners.includes(s.id) ? "🏆 " : ""}${s.name}</td><td>${s.points} pts</td><td>${s.cardsCompleted} cards</td></tr>`)
    .join("");
  table.innerHTML = `<tr><th>Player</th><th>Points</th><th>Cards</th></tr>${rows}`;
}
document.getElementById("btn-back-to-menu").addEventListener("click", () => {
  if (ONLINE_UNSUB) { ONLINE_UNSUB(); ONLINE_UNSUB = null; }
  MODE = null; STATE = null; ONLINE_CODE = null; ONLINE_PLAYER_ID = null;
  showScreen("screen-menu");
});

// ---------- Init ----------
showScreen("screen-menu");
