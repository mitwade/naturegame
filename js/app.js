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

// Undo support: snapshot of STATE taken right before the most recent
// undo-eligible action. Only ever holds the *single* most recent move, and
// only when that move didn't reveal hidden information (drawing cards, or
// drawing tiles from the face-down pile, both reveal something the player
// would still know even after undoing — so those aren't undoable).
let undoSnapshot = null; // { state, playerIndex }
let endTurnPromptShown = false;

function snapshotForUndo() {
  undoSnapshot = { state: JSON.parse(JSON.stringify(STATE)), playerIndex: STATE.currentPlayerIndex };
}
function clearUndo() {
  undoSnapshot = null;
}
async function performUndo() {
  if (!undoSnapshot) return;
  const snap = undoSnapshot.state;
  undoSnapshot = null;
  await applyAction(state => {
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, snap);
  });
  toast("Move undone.");
}

// ---------- Screen helpers ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  if (id === "screen-menu") renderContinueSection();
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "claim-toast";
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---------- Continue / resume saved games ----------
function describeLocalSave(save) {
  if (!save || !save.state) return "";
  const s = save.state;
  const cur = s.players[s.currentPlayerIndex];
  return `Round ${s.round} of 3${cur ? " · " + cur.name + "'s turn" : ""}`;
}

function renderContinueSection() {
  const wrap = document.getElementById("continue-section");
  if (!wrap) return;
  const soloSave = loadLocalSave("solo");
  const passSave = loadLocalSave("pass");
  const onlineSave = loadOnlineSave();
  const items = [];
  if (soloSave) items.push({ mode: "solo", icon: "🖥️", title: "Solo vs Bots", desc: describeLocalSave(soloSave) });
  if (passSave) items.push({ mode: "pass", icon: "📱", title: "Pass & Play", desc: describeLocalSave(passSave) });
  if (onlineSave) items.push({ mode: "online", icon: "🌐", title: "Online Game", desc: `Room code ${onlineSave.code}` });

  if (!items.length) { wrap.classList.add("hidden"); wrap.innerHTML = ""; return; }
  wrap.classList.remove("hidden");
  wrap.innerHTML = `<h3 class="continue-heading">Continue Playing</h3><div class="continue-grid">` +
    items.map(it => `
      <div class="continue-card" data-resume="${it.mode}">
        <div class="continue-icon">${it.icon}</div>
        <div class="continue-text"><strong>${it.title}</strong><div class="continue-desc">${it.desc}</div></div>
        <button class="continue-discard" data-discard="${it.mode}" title="Discard saved game">✕</button>
      </div>`).join("") +
    `</div>`;

  wrap.querySelectorAll("[data-resume]").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-discard]")) return;
      resumeSavedGame(el.dataset.resume);
    });
  });
  wrap.querySelectorAll("[data-discard]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mode = btn.dataset.discard;
      if (mode === "online") clearOnlineSave(); else clearLocalSave(mode);
      renderContinueSection();
      toast("Saved game discarded.");
    });
  });
}

async function resumeSavedGame(mode) {
  if (mode === "solo" || mode === "pass") {
    const save = loadLocalSave(mode);
    if (!save) return;
    MODE = mode;
    STATE = save.state;
    LOCAL_SETUP_PLAYERS = save.setupPlayers || [];
    startGameScreen();
  } else if (mode === "online") {
    const save = loadOnlineSave();
    if (!save) return;
    if (!isFirebaseConfigured()) { toast("Online play isn't configured on this site."); return; }
    try {
      const { playerId } = await joinOnlineGame(save.code, save.name || "Player");
      ONLINE_CODE = save.code; ONLINE_PLAYER_ID = playerId;
      MODE = "online";
      enterOnlineLobby();
    } catch (e) {
      toast(e.message || String(e));
      clearOnlineSave();
      renderContinueSection();
    }
  }
}

// ---------- Menu ----------
document.querySelectorAll("#screen-menu .mode-card").forEach(card => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;
    if (mode === "solo" || mode === "pass") {
      const existing = loadLocalSave(mode);
      if (existing) {
        const label = mode === "solo" ? "Solo vs Bots" : "Pass & Play";
        const ok = confirm(`You have a ${label} game in progress. Starting a new game will discard it. Continue?`);
        if (!ok) return;
        clearLocalSave(mode);
      }
      openLocalSetup(mode);
    } else {
      openOnlineSetup();
    }
  });
});

document.getElementById("btn-menu-rules")?.addEventListener("click", openRulesModal);
document.getElementById("btn-menu-records")?.addEventListener("click", () => {
  recordsTab = "yours";
  document.querySelectorAll(".records-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === "yours"));
  renderRecordsScreen();
  showScreen("screen-records");
});
document.getElementById("btn-records-back")?.addEventListener("click", () => showScreen("screen-menu"));
document.querySelectorAll(".records-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    recordsTab = btn.dataset.tab;
    document.querySelectorAll(".records-tab").forEach(b => b.classList.toggle("active", b === btn));
    renderRecordsScreen();
  });
});

let recordsTab = "yours";

function renderRecordsSummaryAndList(records, opts = {}) {
  const stats = computeStatsFromRecords(records);
  const summaryEl = document.getElementById("records-summary");
  if (!stats.length) {
    summaryEl.innerHTML = opts.emptyMessage
      ? `<p style="color:var(--text-dim);">${opts.emptyMessage}</p>` : "";
  } else {
    summaryEl.innerHTML = `<div class="records-stat-grid">` + stats.map(s => `
      <div class="record-stat-card">
        <div class="record-stat-title">${MODE_LABELS[s.mode] || s.mode} · ${s.playerCount} players</div>
        <div class="record-stat-row"><span>Games played</span><strong>${s.games}</strong></div>
        <div class="record-stat-row"><span>Highest score</span><strong>${s.highest}</strong></div>
        <div class="record-stat-row"><span>Lowest score</span><strong>${s.lowest}</strong></div>
        <div class="record-stat-row"><span>Average score</span><strong>${s.average.toFixed(1)}</strong></div>
        <div class="record-stat-row"><span>Avg cards completed</span><strong>${s.avgCards.toFixed(1)}</strong></div>
        <div class="record-stat-row"><span>Avg duration</span><strong>${formatDuration(s.avgDurationMs)}</strong></div>
      </div>`).join("") + `</div>`;
  }

  const listEl = document.getElementById("records-list");
  if (!records.length) {
    listEl.innerHTML = `<p style="color:var(--text-dim);">${opts.emptyMessage || "No games recorded yet."}</p>`;
  } else {
    listEl.innerHTML = records.map(r => {
      const date = new Date(r.timestamp).toLocaleString();
      const top = Math.max(...r.players.map(p => p.points));
      const playersHtml = r.players.slice().sort((a, b) => b.points - a.points).map(p =>
        `<span class="record-player${p.points === top ? " record-winner" : ""}">${p.points === top ? "🏆 " : ""}${p.name} — ${p.points}pt (${p.cardsCompleted} cards)</span>`
      ).join("");
      return `<div class="record-row">
        <div class="record-row-head"><strong>${MODE_LABELS[r.mode] || r.mode}</strong> · ${r.playerCount} players · <span class="record-date">${date}</span> · <span class="record-duration">⏱ ${formatDuration(r.durationMs)}</span></div>
        <div class="record-row-players">${playersHtml}</div>
      </div>`;
    }).join("");
  }
}

async function renderRecordsScreen() {
  const listEl = document.getElementById("records-list");
  const summaryEl = document.getElementById("records-summary");
  const titleEl = document.getElementById("records-list-title");

  if (recordsTab === "yours") {
    titleEl.textContent = "Your Games";
    const records = loadGameRecords().slice().reverse();
    renderRecordsSummaryAndList(records, { emptyMessage: "No games recorded yet — finish a game to start building your records!" });
    return;
  }

  titleEl.textContent = "World Games";
  if (!isFirebaseConfigured()) {
    summaryEl.innerHTML = "";
    listEl.innerHTML = `<p style="color:var(--text-dim);">World records need online play configured on this site (see README) — that's what powers the shared record book.</p>`;
    return;
  }
  summaryEl.innerHTML = "";
  listEl.innerHTML = `<p style="color:var(--text-dim);">Loading world records…</p>`;
  const records = await fetchWorldRecords();
  records.sort((a, b) => b.timestamp - a.timestamp);
  renderRecordsSummaryAndList(records, {
    emptyMessage: "No world records yet — be the first to finish a game!"
  });
  if (records.length === WORLD_RECORDS_FETCH_LIMIT) {
    document.getElementById("records-summary").insertAdjacentHTML("beforeend",
      `<p style="color:var(--text-dim); font-size:12px; margin-top:6px;">Showing the most recent ${WORLD_RECORDS_FETCH_LIMIT} games worldwide.</p>`);
  }
}

// ---------- Local setup (solo / pass) ----------
function openLocalSetup(mode) {
  MODE = mode;
  LOCAL_SETUP_PLAYERS = [];
  if (mode === "solo") {
    LOCAL_SETUP_PLAYERS.push({ id: "human1", name: "You", isBot: false });
    LOCAL_SETUP_PLAYERS.push({ id: "bot1", name: "Bot 1", isBot: true, botLevel: "medium" });
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
      <span>${p.isBot ? "🖥️" : "♟️"}</span>
      <input type="text" value="${p.name}" data-idx="${i}" />
      ${p.isBot
        ? `<select data-difficulty="${i}" class="bot-difficulty-select">
            ${BOT_LEVELS.map(lvl => `<option value="${lvl}" ${((p.botLevel || "medium") === lvl) ? "selected" : ""}>${BOT_LEVEL_ICONS[lvl]} ${BOT_LEVEL_LABELS[lvl]}</option>`).join("")}
          </select>`
        : `<span style="font-size:12px;color:var(--text-dim);">Human</span>`}
      <button class="secondary small" data-remove="${i}">✕</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll("input[type=text]").forEach(inp => {
    inp.addEventListener("input", e => {
      LOCAL_SETUP_PLAYERS[+e.target.dataset.idx].name = e.target.value;
    });
  });
  container.querySelectorAll("[data-difficulty]").forEach(sel => {
    sel.addEventListener("change", e => {
      LOCAL_SETUP_PLAYERS[+e.target.dataset.difficulty].botLevel = e.target.value;
    });
    sel.title = BOT_LEVEL_DESCRIPTIONS[sel.value];
    sel.addEventListener("change", e => { e.target.title = BOT_LEVEL_DESCRIPTIONS[e.target.value]; });
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
  LOCAL_SETUP_PLAYERS.push({ id: "bot" + Date.now(), name: "Bot " + n, isBot: true, botLevel: "medium" });
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
  if (!isFirebaseConfigured()) {
    document.getElementById("online-setup-error").textContent =
      "Online play isn't configured yet — see README for the 5-minute Firebase setup.";
    return;
  }
  try {
    const name = document.getElementById("online-name").value.trim() || "Host";
    const { code, playerId } = await createOnlineGame(name);
    ONLINE_CODE = code; ONLINE_PLAYER_ID = playerId;
    saveOnlineJoin(code, name);
    enterOnlineLobby();
  } catch (e) {
    document.getElementById("online-setup-error").textContent = e.message || String(e);
  }
});

document.getElementById("btn-online-join").addEventListener("click", async () => {
  if (!isFirebaseConfigured()) {
    document.getElementById("online-setup-error").textContent =
      "Online play isn't configured yet — see README for the 5-minute Firebase setup.";
    return;
  }
  try {
    const name = document.getElementById("online-name").value.trim() || "Player";
    const code = document.getElementById("online-join-code").value.trim().toUpperCase();
    if (!code) return;
    const { playerId } = await joinOnlineGame(code, name);
    ONLINE_CODE = code; ONLINE_PLAYER_ID = playerId;
    saveOnlineJoin(code, name);
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
    if (data.status === "finished") { clearOnlineSave(); showGameOver(); }
    maybeRunBotTurn();
  }
}

function renderLobbyPlayers(players) {
  const el = document.getElementById("lobby-players");
  el.innerHTML = players.map(p => `
    <div class="player-row">
      <span>${p.isBot ? "🖥️" : "♟️"}</span> ${p.name}
      ${p.isBot ? `<select data-lobby-difficulty="${p.id}" class="bot-difficulty-select" title="${BOT_LEVEL_DESCRIPTIONS[p.botLevel || "medium"]}">
        ${BOT_LEVELS.map(lvl => `<option value="${lvl}" ${((p.botLevel || "medium") === lvl) ? "selected" : ""}>${BOT_LEVEL_ICONS[lvl]} ${BOT_LEVEL_LABELS[lvl]}</option>`).join("")}
      </select>` : ""}
    </div>`).join("");
  el.querySelectorAll("[data-lobby-difficulty]").forEach(sel => {
    sel.addEventListener("change", e => {
      setLobbyBotDifficulty(ONLINE_CODE, e.target.dataset.lobbyDifficulty, e.target.value).catch(err => toast(err.message || String(err)));
    });
  });
}

document.getElementById("btn-lobby-add-bot").addEventListener("click", () => addBotToLobby(ONLINE_CODE, "medium"));
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
  clearOnlineSave();
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
  if (MODE === "solo" || MODE === "pass") {
    if (STATE.gameOver) clearLocalSave(MODE); else saveLocalGame(MODE);
  }
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
    // Release the flag *before* applying the action. applyAction (local
    // modes) synchronously triggers afterLocalStateChange -> maybeRunBotTurn
    // again once this bot's turn resolves, so the very next bot (e.g. a
    // second/third bot in a row) needs to see botTurnInFlight === false at
    // that point or its turn gets silently swallowed and the game freezes.
    botTurnInFlight = false;
    await applyAction(state => { runBotTurn(state, state.currentPlayerIndex); });
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

// ---------- Modal (game menu + rulebook) ----------
function openModal(html) {
  document.getElementById("modal-box").innerHTML = html;
  document.getElementById("modal-backdrop").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-backdrop").classList.add("hidden");
  document.getElementById("modal-box").innerHTML = "";
}
document.getElementById("modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

function openRulesModal() {
  openModal(`
    <div class="rules-modal">
      <div class="rules-modal-head">
        <h2>📖 Rulebook</h2>
        <button class="secondary small" id="modal-close-rules">✕ Close</button>
      </div>
      <div class="rules-scroll">${RULEBOOK_HTML}</div>
    </div>
  `);
  document.getElementById("modal-close-rules").addEventListener("click", closeModal);
}

function openGameMenu() {
  const inGame = !!STATE;
  openModal(`
    <div class="game-menu-modal">
      <h3>Menu</h3>
      <div class="menu-modal-actions">
        <button id="modal-btn-resume" class="secondary">▶ Resume playing</button>
        <button id="modal-btn-rules" class="secondary">📖 Rulebook</button>
        ${inGame ? `<button id="modal-btn-save-exit" class="secondary">💾 Save &amp; exit to menu</button>` : ""}
        ${inGame ? `<button id="modal-btn-leave" class="danger-btn">🚪 Leave game (discard progress)</button>` : ""}
      </div>
    </div>
  `);
  document.getElementById("modal-btn-resume").addEventListener("click", closeModal);
  document.getElementById("modal-btn-rules").addEventListener("click", openRulesModal);
  const saveExitBtn = document.getElementById("modal-btn-save-exit");
  if (saveExitBtn) saveExitBtn.addEventListener("click", () => {
    if (MODE === "solo" || MODE === "pass") saveLocalGame(MODE);
    if (ONLINE_UNSUB) { ONLINE_UNSUB(); ONLINE_UNSUB = null; }
    closeModal();
    toast("Saved — resume it anytime from the main menu.");
    showScreen("screen-menu");
  });
  const leaveBtn = document.getElementById("modal-btn-leave");
  if (leaveBtn) leaveBtn.addEventListener("click", () => {
    const ok = confirm("Leave this game and discard your saved progress? This can't be undone.");
    if (!ok) return;
    if (MODE === "solo" || MODE === "pass") clearLocalSave(MODE);
    if (MODE === "online") clearOnlineSave();
    if (ONLINE_UNSUB) { ONLINE_UNSUB(); ONLINE_UNSUB = null; }
    MODE = null; STATE = null; ONLINE_CODE = null; ONLINE_PLAYER_ID = null;
    closeModal();
    showScreen("screen-menu");
  });
}

document.getElementById("btn-game-menu")?.addEventListener("click", openGameMenu);
document.getElementById("btn-menu-rules")?.addEventListener("click", openRulesModal);

// ---------- Game screen ----------
function startGameScreen(fromOnline) {
  showScreen("screen-game");
  placementMode = false; pendingPlacements = []; stagedBoardKeys = new Set(); selectedTileIndex = null;
  drawTilesMode = false; pendingTilePicks = [];
  passOverlayShownFor = null;
  undoSnapshot = null;
  endTurnPromptShown = false;
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
  const threshold = ROUND_THRESHOLDS[STATE.round - 1];
  STATE.players.forEach((p, i) => {
    const pts = p.score.reduce((s, cid) => s + CARDS_BY_ID[cid].points, 0);
    const chip = document.createElement("span");
    chip.className = "player-chip" + (i === STATE.currentPlayerIndex ? " active" : "");
    const roundBits = [];
    for (let r = 1; r <= 3; r++) {
      if (r < STATE.round) {
        roundBits.push(`R${r} ${p.completedByRound?.[r - 1] ?? 0}`);
      } else if (r === STATE.round) {
        roundBits.push(`R${r} ${p.roundCompletedCount}/${threshold}`);
      } else {
        roundBits.push(`R${r} –`);
      }
    }
    chip.innerHTML = `${p.isBot ? "🖥️" : "♟️"} ${p.name}<span class="pts">${pts}pt</span>` +
      `<span class="round-progress">${roundBits.join(" · ")}</span>`;
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

  // Pending picks row — lets the player see exactly what they've queued up
  // (including face-down pile draws, which aren't visible as tiles on the
  // board), with a single button to clear all picks and start over.
  const pendingRow = document.getElementById("draw-tiles-pending-row");
  pendingRow.classList.toggle("hidden", !drawTilesMode || pendingTilePicks.length === 0);
  if (drawTilesMode && pendingTilePicks.length > 0) {
    pendingRow.innerHTML = "";
    const list = document.createElement("div");
    list.className = "pending-pick-list";
    pendingTilePicks.forEach(pick => {
      const chip = document.createElement("span");
      chip.className = "pending-pick-chip";
      if (pick.source === "market") {
        chip.textContent = `${TERRAIN_EMOJI[STATE.tileMarket[pick.marketIndex]] || "🀫"} ${TERRAIN_LABELS[STATE.tileMarket[pick.marketIndex]] || "Tile"}`;
      } else {
        chip.textContent = "🂠 Face-down (random)";
      }
      list.appendChild(chip);
    });
    pendingRow.appendChild(list);
    const unselectBtn = document.createElement("button");
    unselectBtn.className = "secondary small";
    unselectBtn.textContent = "Unselect Choices";
    unselectBtn.addEventListener("click", () => {
      pendingTilePicks = [];
      renderGame();
    });
    pendingRow.appendChild(unselectBtn);
  }

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

  // Other players' tile pools (public info — visible to everyone; only
  // "Your Hand" of nature cards is private).
  const othersEl = document.getElementById("other-pools");
  othersEl.innerHTML = "";
  STATE.players.forEach((p, i) => {
    if (i === me) return; // skip my own pool, already shown above
    const row = document.createElement("div");
    row.className = "other-pool-row";
    const label = document.createElement("div");
    label.className = "other-pool-label";
    label.innerHTML = `${p.isBot ? "🖥️" : "♟️"} ${p.name} <span class="pts">(${p.pool.length}/7)</span>`;
    row.appendChild(label);
    const tray = document.createElement("div");
    tray.className = "tile-tray other-pool-tray";
    p.pool.forEach(terrain => {
      tray.appendChild(renderTileChip(terrain, { disabled: true }));
    });
    row.appendChild(tray);
    othersEl.appendChild(row);
  });

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
  document.getElementById("btn-draw-tiles-cancel").classList.toggle("hidden", !drawTilesMode);

  document.getElementById("btn-end-turn").disabled = !(myTurn && STATE.turnActionsUsed.length >= 2);
  document.getElementById("action-status").textContent = myTurn ? "" : `Waiting for ${curPlayer.name}…`;

  // Undo — only the client that made the move has a snapshot for it (see
  // snapshotForUndo), and it's invalidated the moment the turn moves on.
  if (undoSnapshot && (undoSnapshot.playerIndex !== STATE.currentPlayerIndex || !myTurn)) {
    undoSnapshot = null;
  }
  const undoBtn = document.getElementById("btn-undo");
  undoBtn.classList.toggle("hidden", !undoSnapshot);
  undoBtn.disabled = !undoSnapshot || placementMode || drawTilesMode;

  // Prompt to end turn once both actions are used.
  const turnComplete = myTurn && STATE.turnActionsUsed.length >= 2;
  const endTurnBtn = document.getElementById("btn-end-turn");
  endTurnBtn.classList.toggle("pulse-highlight", turnComplete);
  if (turnComplete && !endTurnPromptShown) {
    endTurnPromptShown = true;
    toast("Both actions used — click End Turn to continue.");
  } else if (!turnComplete) {
    endTurnPromptShown = false;
  }
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
  snapshotForUndo(); // playing tiles reveals nothing new — always undoable
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
  clearUndo(); // drawing cards reveals their identity — can't be undone
  await applyAction(state => {
    const res = drawCards(state, state.currentPlayerIndex);
    if (!res.success) toast(res.error);
  });
});

document.getElementById("btn-action-draw-tiles").addEventListener("click", () => {
  drawTilesMode = true; pendingTilePicks = [];
  renderGame();
});

document.getElementById("btn-draw-tiles-cancel").addEventListener("click", () => {
  drawTilesMode = false; pendingTilePicks = [];
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
  // Only undoable if every pick came from the face-up Market — drawing from
  // the face-down pile reveals a tile the player would still know about
  // even after "undoing", so that's not allowed.
  const allFaceUp = picks.length > 0 && picks.every(p => p.source === "market");
  if (allFaceUp) snapshotForUndo(); else clearUndo();
  await applyAction(state => {
    const res = drawTiles(state, state.currentPlayerIndex, picks);
    if (!res.success) toast(res.error);
  });
});

document.getElementById("btn-end-turn").addEventListener("click", async () => {
  clearUndo();
  await applyAction(state => {
    const res = endTurn(state);
    if (!res.success) toast(res.error);
  });
});

document.getElementById("btn-undo").addEventListener("click", performUndo);

// ---------- Game over ----------
function showGameOver() {
  recordGameResult(STATE, MODE);
  showScreen("screen-gameover");
  const winners = STATE.winner || [];
  const winnerNames = STATE.finalScores.filter(s => winners.includes(s.id)).map(s => s.name).join(" & ");
  document.getElementById("gameover-winner-line").textContent =
    winners.length ? `🏆 ${winnerNames} ${winners.length === 1 ? "wins" : "win"}!` : "";
  const table = document.getElementById("final-scores-table");
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
