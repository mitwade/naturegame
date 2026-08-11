// Core rules engine for Nature. Pure-ish functions operating on a plain
// JSON-serializable state object (so it can be dropped straight into
// Firestore for online play, or kept in memory for local play).

const CARDS_BY_ID = {};
const CARD_KEY_TO_ID = {};
(function initCardTables() {
  const deck = generateDeck();
  deck.forEach(c => {
    CARDS_BY_ID[c.id] = c;
    CARD_KEY_TO_ID[cardCanonicalKey(c.shape, c.terrains)] = c.id;
  });
})();
const ALL_CARD_IDS = Object.keys(CARDS_BY_ID);

const ROUND_THRESHOLDS = [3, 4, 5]; // index by round-1

function boardMap(boardObj) {
  const m = new Map();
  Object.keys(boardObj).forEach(k => m.set(k, boardObj[k]));
  return m;
}

// ---------- Game creation ----------

function createGame(playerConfigs, options = {}) {
  const tileBag = shuffle(generateTileBag());
  const cardDeck = shuffle(ALL_CARD_IDS.slice());

  const startingTerrain = tileBag.pop();
  const board = {};
  board[key(0, 0)] = startingTerrain;

  const bank = cardDeck.splice(0, 5);
  const tileMarket = [];
  for (let i = 0; i < 5; i++) tileMarket.push(tileBag.pop());

  const players = playerConfigs.map((p, i) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    botLevel: p.botLevel || "smart",
    hand: cardDeck.splice(0, 3),
    pool: [tileBag.pop(), tileBag.pop(), tileBag.pop()],
    score: [],
    roundCompletedCount: 0,
    turnsThisRound: 0
  }));

  return {
    id: options.id || ("game-" + Math.random().toString(36).slice(2, 9)),
    mode: options.mode || "local",
    board,
    bank,
    deckCardIds: cardDeck,
    cardDiscard: [],
    tileMarket,
    tileDrawPile: tileBag,
    tileDiscard: [],
    players,
    currentPlayerIndex: 0,
    round: 1,
    turnActionsUsed: [],
    firstTilePlacedEver: false,
    roundEndTriggered: false,
    roundEndTargetTurns: null,
    gameEndTriggered: false,
    gameEndTargetTurns: null,
    roundStarterIndex: 0,
    log: [],
    gameOver: false,
    winner: null,
    finalScores: null
  };
}

function logMsg(state, msg) {
  state.log.push(msg);
  if (state.log.length > 300) state.log.shift();
}

// ---------- Placement ----------

function getLegalSpots(state) {
  const board = boardMap(state.board);
  const candidates = new Set();
  for (const k of board.keys()) {
    const { q, r } = parseKey(k);
    neighborsOf(q, r).forEach(n => {
      const nk = key(n.q, n.r);
      if (!board.has(nk)) candidates.add(nk);
    });
  }
  const minTouch = state.firstTilePlacedEver ? 2 : 1;
  return [...candidates].filter(k => {
    const { q, r } = parseKey(k);
    return touchCount(board, q, r) >= minTouch;
  });
}

function matchTerrains(card, tiles) {
  const k = cardCanonicalKey(card.shape, tiles.map(t => t.terrain));
  return k === cardCanonicalKey(card.shape, card.terrains);
}

// Find every unclaimed card (bank + this player's hand) that matches a
// pattern formed using at least one of the given newly-placed tile keys.
function findClaimableMatches(state, playerIndex, newTileKeys) {
  const board = boardMap(state.board);
  const patterns = findPatternsIncluding(board, newTileKeys);
  const player = state.players[playerIndex];
  const availableIds = new Set([...state.bank, ...player.hand]);
  const claimedThisScan = new Set();
  const matches = [];
  for (const pattern of patterns) {
    const k = cardCanonicalKey(pattern.shape, pattern.tiles.map(t => t.terrain));
    const cardId = CARD_KEY_TO_ID[k];
    if (!cardId) continue;
    if (!availableIds.has(cardId)) continue;
    if (claimedThisScan.has(cardId)) continue;
    claimedThisScan.add(cardId);
    const source = state.bank.includes(cardId) ? "bank" : "hand";
    matches.push({ cardId, source, shape: pattern.shape, points: SHAPE_POINTS[pattern.shape] });
  }
  return matches;
}

// placements: array (length 1 or 2) of { terrain, q, r }
function playTiles(state, playerIndex, placements) {
  if (state.currentPlayerIndex !== playerIndex) return { success: false, error: "Not your turn." };
  if (state.turnActionsUsed.includes("playTiles")) return { success: false, error: "Play Tiles already used this turn." };
  if (!placements || placements.length < 1 || placements.length > 2) {
    return { success: false, error: "Must place 1 or 2 tiles." };
  }

  const player = state.players[playerIndex];
  const poolCopy = player.pool.slice();
  const board = boardMap(state.board);
  const newKeys = [];
  let firstTileFlag = state.firstTilePlacedEver; // local until full success

  for (const p of placements) {
    const idx = poolCopy.indexOf(p.terrain);
    if (idx === -1) return { success: false, error: `You don't have a ${p.terrain} tile.` };
    const k = key(p.q, p.r);
    if (board.has(k)) return { success: false, error: "That spot is already occupied." };
    const minTouch = firstTileFlag ? 2 : 1;
    if (touchCount(board, p.q, p.r) < minTouch) {
      return { success: false, error: "That placement doesn't satisfy the touching rule yet." };
    }
    poolCopy.splice(idx, 1);
    board.set(k, p.terrain);
    firstTileFlag = true;
    newKeys.push(k);
  }

  // Commit (only reached if every placement in this call validated OK)
  player.pool = poolCopy;
  const newBoard = {};
  board.forEach((v, k) => (newBoard[k] = v));
  state.board = newBoard;
  state.firstTilePlacedEver = firstTileFlag;
  state.turnActionsUsed.push("playTiles");
  logMsg(state, `${player.name} placed ${placements.length} tile(s).`);

  const claimable = findClaimableMatches(state, playerIndex, newKeys);
  checkSupplyExhaustion(state);
  return { success: true, newKeys, claimable };
}

// ---------- Claiming ----------

function claimCard(state, playerIndex, cardId) {
  const player = state.players[playerIndex];
  let source = null;
  if (state.bank.includes(cardId)) {
    source = "bank";
    state.bank.splice(state.bank.indexOf(cardId), 1);
  } else if (player.hand.includes(cardId)) {
    source = "hand";
    player.hand.splice(player.hand.indexOf(cardId), 1);
  } else {
    return { success: false, error: "Card not available to claim." };
  }
  player.score.push(cardId);
  player.roundCompletedCount++;
  const card = CARDS_BY_ID[cardId];
  logMsg(state, `${player.name} claimed ${card.shape} card (${card.points} pt) from ${source}.`);

  const threshold = ROUND_THRESHOLDS[state.round - 1];
  if (!state.roundEndTriggered && player.roundCompletedCount >= threshold) {
    state.roundEndTriggered = true;
    state.roundEndTargetTurns = player.turnsThisRound;
    logMsg(state, `Round ${state.round} end triggered by ${player.name}!`);
  }
  return { success: true, source, card };
}

// ---------- Draw actions ----------

function ensureCardDeck(state) {
  if (state.deckCardIds.length === 0 && state.cardDiscard.length > 0) {
    state.deckCardIds = shuffle(state.cardDiscard);
    state.cardDiscard = [];
  }
}

function drawCards(state, playerIndex) {
  if (state.currentPlayerIndex !== playerIndex) return { success: false, error: "Not your turn." };
  if (state.turnActionsUsed.includes("drawCards")) return { success: false, error: "Draw Cards already used this turn." };
  const player = state.players[playerIndex];
  const drawn = [];
  for (let i = 0; i < 2; i++) {
    ensureCardDeck(state);
    if (state.deckCardIds.length === 0) break;
    drawn.push(state.deckCardIds.shift());
  }
  player.hand.push(...drawn);
  state.turnActionsUsed.push("drawCards");
  logMsg(state, `${player.name} drew ${drawn.length} card(s).`);
  checkSupplyExhaustion(state);
  return { success: true, drawn };
}

function ensureTileBag(state) {
  if (state.tileDrawPile.length === 0 && state.tileDiscard.length > 0) {
    state.tileDrawPile = shuffle(state.tileDiscard);
    state.tileDiscard = [];
  }
}

// picks: array (len 1-2) of { source: 'market', marketIndex } | { source: 'draw' }
function drawTiles(state, playerIndex, picks) {
  if (state.currentPlayerIndex !== playerIndex) return { success: false, error: "Not your turn." };
  if (state.turnActionsUsed.length !== 1) return { success: false, error: "Draw Tiles must be your second action." };
  if (state.turnActionsUsed.includes("drawTiles")) return { success: false, error: "Draw Tiles already used this turn." };
  const player = state.players[playerIndex];
  if (player.pool.length >= 7) return { success: false, error: "Tile pool already full (7)." };
  if (!picks || picks.length < 1 || picks.length > 2) return { success: false, error: "Pick 1 or 2 tiles." };
  const allowed = Math.min(picks.length, 7 - player.pool.length);
  if (allowed < picks.length) return { success: false, error: "That would exceed the 7-tile limit." };

  const gained = [];
  // Handle market picks by index carefully (indices shift as we remove).
  const marketPicksSorted = picks
    .map((p, i) => ({ ...p, origIndex: i }))
    .filter(p => p.source === "market")
    .sort((a, b) => b.marketIndex - a.marketIndex);
  const drawPicks = picks.filter(p => p.source === "draw");

  for (const p of marketPicksSorted) {
    if (p.marketIndex < 0 || p.marketIndex >= state.tileMarket.length) {
      return { success: false, error: "Invalid market slot." };
    }
    const terrain = state.tileMarket.splice(p.marketIndex, 1)[0];
    gained.push(terrain);
    ensureTileBag(state);
    if (state.tileDrawPile.length > 0) state.tileMarket.push(state.tileDrawPile.pop());
  }
  for (const _ of drawPicks) {
    ensureTileBag(state);
    if (state.tileDrawPile.length === 0) break;
    gained.push(state.tileDrawPile.pop());
  }

  player.pool.push(...gained);
  state.turnActionsUsed.push("drawTiles");
  logMsg(state, `${player.name} drew ${gained.length} tile(s).`);
  checkSupplyExhaustion(state);
  return { success: true, gained };
}

// Per rulebook: "If there's nothing left in either the deck or its discard
// pile, finish the current turn order and end the game." Checked after every
// draw/place action so we never loop forever waiting for a claim that can't
// happen because there's nothing left to draw or place.
function checkSupplyExhaustion(state) {
  if (state.gameEndTriggered) return;
  const cardsGone = state.deckCardIds.length === 0 && state.cardDiscard.length === 0;
  const tilesGone = state.tileDrawPile.length === 0 && state.tileDiscard.length === 0 && state.tileMarket.length === 0;
  if (cardsGone || tilesGone) {
    state.gameEndTriggered = true;
    state.gameEndTargetTurns = state.players[state.currentPlayerIndex].turnsThisRound;
    logMsg(state, "Card and/or tile supply exhausted — finishing out the turn order, then the game ends.");
  }
}

function canUseAction(state, playerIndex, action) {
  if (state.currentPlayerIndex !== playerIndex) return false;
  if (state.turnActionsUsed.length >= 2) return false;
  if (state.turnActionsUsed.includes(action)) return false;
  if (action === "drawTiles") {
    if (state.turnActionsUsed.length !== 1) return false;
    if (state.players[playerIndex].pool.length >= 7) return false;
  }
  return true;
}

// ---------- Turn / round / game flow ----------

function startTurnBookkeeping(state) {
  state.turnActionsUsed = [];
  state.players[state.currentPlayerIndex].turnsThisRound++;
}

function allPlayersReachedTarget(state) {
  return state.players.every(p => p.turnsThisRound >= state.roundEndTargetTurns);
}

function refillBank(state) {
  while (state.bank.length < 5) {
    ensureCardDeck(state);
    if (state.deckCardIds.length === 0) break;
    state.bank.push(state.deckCardIds.shift());
  }
}

function doRoundCleanup(state) {
  logMsg(state, `--- Round ${state.round} ends ---`);
  // Score is already tallied via claim; just archive & reset pools/hands.
  state.players.forEach(p => {
    state.tileDiscard.push(...p.pool);
    p.pool = [];
    state.cardDiscard.push(...p.hand);
    p.hand = [];
    p.roundCompletedCount = 0;
    p.turnsThisRound = 0;
  });
  state.cardDiscard.push(...state.bank);
  state.bank = [];

  const bothEmpty = () => {
    ensureCardDeck(state);
    ensureTileBag(state);
    return state.deckCardIds.length === 0 || state.tileDrawPile.length < state.players.length * 3;
  };

  if (state.round >= 3) {
    finalizeGame(state);
    return;
  }

  if (bothEmpty()) {
    // Not enough left to deal a fresh round; end the game early.
    finalizeGame(state);
    return;
  }

  state.round++;
  logMsg(state, `--- Round ${state.round} begins ---`);
  refillBank(state);
  state.players.forEach(p => {
    for (let i = 0; i < 3; i++) {
      ensureTileBag(state);
      if (state.tileDrawPile.length > 0) p.pool.push(state.tileDrawPile.pop());
    }
    for (let i = 0; i < 3; i++) {
      ensureCardDeck(state);
      if (state.deckCardIds.length > 0) p.hand.push(state.deckCardIds.shift());
    }
  });

  state.roundEndTriggered = false;
  state.roundEndTargetTurns = null;
  state.currentPlayerIndex = state.roundStarterIndex;
  startTurnBookkeeping(state);
}

function finalizeGame(state) {
  state.gameOver = true;
  const scores = state.players.map(p => ({
    id: p.id,
    name: p.name,
    points: p.score.reduce((sum, cid) => sum + CARDS_BY_ID[cid].points, 0),
    cardsCompleted: p.score.length
  }));
  let best = scores[0];
  scores.forEach(s => {
    if (s.points > best.points) best = s;
  });
  const topScore = Math.max(...scores.map(s => s.points));
  const tied = scores.filter(s => s.points === topScore);
  let winners;
  if (tied.length === 1) {
    winners = [tied[0].id];
  } else {
    const mostCards = Math.max(...tied.map(s => s.cardsCompleted));
    winners = tied.filter(s => s.cardsCompleted === mostCards).map(s => s.id);
  }
  state.finalScores = scores;
  state.winner = winners;
  logMsg(state, `Game over! Winner(s): ${scores.filter(s => winners.includes(s.id)).map(s => s.name).join(", ")}`);
}

// Call once the active player has completed exactly 2 actions.
function endTurn(state) {
  if (state.turnActionsUsed.length < 2) {
    return { success: false, error: "Turn is not complete (need 2 actions)." };
  }

  // Supply exhaustion overrides normal round-end: once triggered, the game
  // ends outright (no redeal) as soon as everyone's had equal turns.
  if (state.gameEndTriggered && state.gameEndTargetTurns !== null) {
    if (state.players.every(p => p.turnsThisRound >= state.gameEndTargetTurns)) {
      finalizeGame(state);
      return { success: true, roundEnded: false, gameOver: true };
    }
  }

  if (state.roundEndTriggered && state.roundEndTargetTurns !== null) {
    if (allPlayersReachedTarget(state)) {
      const enderIndex = state.currentPlayerIndex;
      doRoundCleanup(state);
      if (!state.gameOver) {
        state.roundStarterIndex = (enderIndex) % state.players.length;
      }
      return { success: true, roundEnded: true, gameOver: state.gameOver };
    }
  }

  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  startTurnBookkeeping(state);
  return { success: true, roundEnded: false, gameOver: false };
}

function initFirstTurn(state) {
  startTurnBookkeeping(state);
}

if (typeof module !== "undefined") {
  module.exports = {
    CARDS_BY_ID, CARD_KEY_TO_ID, ROUND_THRESHOLDS,
    createGame, getLegalSpots, playTiles, claimCard, drawCards, drawTiles,
    canUseAction, endTurn, initFirstTurn, boardMap, findClaimableMatches
  };
}
