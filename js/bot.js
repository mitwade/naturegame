// Bot AI for Nature. Plans its Play Tiles action by searching for the
// highest-value pattern(s) it can complete this turn (checking both
// single- and double-tile placements, since a card can be finished by
// laying 2 of its 3 tiles in one turn if the board already holds the
// third). Falls back to sensible drawing behavior otherwise.

function evaluatePlacementValue(state, playerIndex, tempBoard, newKeys) {
  const player = state.players[playerIndex];
  const availableIds = new Set([...state.bank, ...player.hand]);
  const patterns = findPatternsIncluding(tempBoard, newKeys);
  let points = 0;
  const matchedCardIds = [];
  const seen = new Set();
  for (const pattern of patterns) {
    const k = cardCanonicalKey(pattern.shape, pattern.tiles.map(t => t.terrain));
    const cardId = CARD_KEY_TO_ID[k];
    if (!cardId || !availableIds.has(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);
    points += SHAPE_POINTS[pattern.shape];
    matchedCardIds.push(cardId);
  }
  return { points, matchedCardIds };
}

function localCandidateSpots(board, aroundKey) {
  const spots = new Set();
  const addNeighbors = (k) => {
    const { q, r } = parseKey(k);
    neighborsOf(q, r).forEach(n => {
      const nk = key(n.q, n.r);
      if (!board.has(nk)) spots.add(nk);
    });
  };
  addNeighbors(aroundKey);
  // also expand from the tile at aroundKey's existing neighbors, to catch
  // spots that become part of a chain through it
  const { q, r } = parseKey(aroundKey);
  neighborsOf(q, r).forEach(n => {
    const nk = key(n.q, n.r);
    if (board.has(nk)) addNeighbors(nk);
  });
  return [...spots];
}

// Returns { placements:[{terrain,q,r}, ...(1 or 2)], points, matchedCardIds } or null
function planBestPlacement(state, playerIndex, spotSampleCap = 30) {
  const player = state.players[playerIndex];
  if (player.pool.length === 0) return null;
  const legalSpots = getLegalSpots(state);
  if (legalSpots.length === 0) return null;

  const board = boardMap(state.board);
  const uniqueTerrains = [...new Set(player.pool)];
  const spotsSample = legalSpots.length > spotSampleCap
    ? shuffle(legalSpots).slice(0, spotSampleCap)
    : legalSpots;

  let best = null;
  const consider = (candidate) => {
    if (!best || candidate.points > best.points) best = candidate;
  };

  for (const terrain of uniqueTerrains) {
    for (const spotKey of spotsSample) {
      const { q, r } = parseKey(spotKey);
      const b1 = new Map(board);
      b1.set(spotKey, terrain);
      const ev1 = evaluatePlacementValue(state, playerIndex, b1, [spotKey]);
      consider({ placements: [{ terrain, q, r }], points: ev1.points, matchedCardIds: ev1.matchedCardIds });

      const remainingPool = player.pool.slice();
      remainingPool.splice(remainingPool.indexOf(terrain), 1);
      const uniqueRemaining = [...new Set(remainingPool)];
      if (uniqueRemaining.length === 0) continue;

      const localSpots = localCandidateSpots(b1, spotKey);
      for (const t2 of uniqueRemaining) {
        for (const spotKey2 of localSpots) {
          if (spotKey2 === spotKey) continue;
          const { q: q2, r: r2 } = parseKey(spotKey2);
          let touch = 0;
          neighborsOf(q2, r2).forEach(n => { if (b1.has(key(n.q, n.r))) touch++; });
          if (touch < 2) continue; // second tile of the turn always needs >=2 by this point
          const b2 = new Map(b1);
          b2.set(spotKey2, t2);
          const ev2 = evaluatePlacementValue(state, playerIndex, b2, [spotKey, spotKey2]);
          consider({
            placements: [{ terrain, q, r }, { terrain: t2, q: q2, r: r2 }],
            points: ev2.points,
            matchedCardIds: ev2.matchedCardIds
          });
        }
      }
    }
  }
  return best;
}

// Pick which terrains to draw for the Draw Tiles action: prefer terrains
// that appear in the bot's own hand cards or the bank (so pool stays useful).
function pickTileDrawPicks(state, playerIndex, count) {
  const player = state.players[playerIndex];
  const wanted = {};
  [...player.hand, ...state.bank].forEach(cardId => {
    const card = CARDS_BY_ID[cardId];
    card.terrains.forEach(t => { wanted[t] = (wanted[t] || 0) + 1; });
  });

  const picks = [];
  const marketCopy = state.tileMarket.map((t, i) => ({ t, i }));
  for (let n = 0; n < count; n++) {
    if (marketCopy.length > 0) {
      marketCopy.sort((a, b) => (wanted[b.t] || 0) - (wanted[a.t] || 0));
      const choice = marketCopy.shift();
      picks.push({ source: "market", marketIndex: choice.i });
      // reindex remaining market entries after splice-equivalent removal
      marketCopy.forEach(m => { if (m.i > choice.i) m.i -= 1; });
    } else {
      picks.push({ source: "draw" });
    }
  }
  return picks;
}

// Executes a full bot turn (2 actions) directly against the real state via
// the engine functions, then calls endTurn. Returns a short description
// array of what happened (useful for UI/logging).
function runBotTurn(state, playerIndex) {
  const events = [];
  const player = state.players[playerIndex];

  const plan = planBestPlacement(state, playerIndex);
  const shouldPlaceForPoints = plan && plan.points > 0;
  const shouldPlaceToUnload = !shouldPlaceForPoints && plan && player.pool.length >= 5;

  let placedThisTurn = false;

  if ((shouldPlaceForPoints || shouldPlaceToUnload) && canUseAction(state, playerIndex, "playTiles")) {
    const res = playTiles(state, playerIndex, plan.placements);
    if (res.success) {
      placedThisTurn = true;
      events.push(`${player.name} placed ${plan.placements.length} tile(s).`);
      if (res.claimable && res.claimable.length) {
        res.claimable.forEach(m => {
          const cr = claimCard(state, playerIndex, m.cardId);
          if (cr.success) events.push(`${player.name} claimed a ${cr.card.shape} card (${cr.card.points} pt).`);
        });
      }
    }
  }

  // Second (or first, if we didn't place) action: choose between drawing
  // cards and drawing tiles based on current needs.
  const wantsCards = player.hand.length < 4;
  const poolRoom = 7 - player.pool.length;

  function tryDrawCards() {
    if (canUseAction(state, playerIndex, "drawCards")) {
      drawCards(state, playerIndex);
      events.push(`${player.name} drew 2 cards.`);
      return true;
    }
    return false;
  }
  function tryDrawTiles() {
    if (canUseAction(state, playerIndex, "drawTiles") && poolRoom > 0) {
      const count = Math.min(2, poolRoom);
      const picks = pickTileDrawPicks(state, playerIndex, count);
      drawTiles(state, playerIndex, picks);
      events.push(`${player.name} drew ${count} tile(s).`);
      return true;
    }
    return false;
  }
  function tryPlaceFallback() {
    if (!canUseAction(state, playerIndex, "playTiles")) return false;
    const fallbackPlan = planBestPlacement(state, playerIndex, 15);
    if (!fallbackPlan) return false;
    const res = playTiles(state, playerIndex, fallbackPlan.placements);
    if (res.success) {
      events.push(`${player.name} placed ${fallbackPlan.placements.length} tile(s).`);
      if (res.claimable && res.claimable.length) {
        res.claimable.forEach(m => {
          const cr = claimCard(state, playerIndex, m.cardId);
          if (cr.success) events.push(`${player.name} claimed a ${cr.card.shape} card (${cr.card.points} pt).`);
        });
      }
      return true;
    }
    return false;
  }

  if (!placedThisTurn) {
    // We haven't used playTiles yet this turn; decide the two actions fresh.
    if (wantsCards) {
      if (!tryDrawCards()) tryDrawTiles();
    } else {
      if (!tryDrawTiles()) tryDrawCards();
    }
    if (state.turnActionsUsed.length < 2) {
      if (!tryPlaceFallback()) {
        if (!tryDrawCards()) tryDrawTiles();
      }
    }
  } else {
    // We already placed; pick the complementary second action.
    if (wantsCards) {
      if (!tryDrawCards()) tryDrawTiles();
    } else {
      if (!tryDrawTiles()) tryDrawCards();
    }
  }

  // Absolute safety net: never leave a turn stuck (shouldn't happen given
  // the rules guarantee at least one legal action combo exists).
  let guard = 0;
  while (state.turnActionsUsed.length < 2 && guard < 5) {
    guard++;
    if (!tryDrawCards() && !tryDrawTiles() && !tryPlaceFallback()) break;
  }

  const er = endTurn(state);
  return { events, endTurnResult: er };
}

if (typeof module !== "undefined") {
  module.exports = { planBestPlacement, runBotTurn, pickTileDrawPicks };
}
