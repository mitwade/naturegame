// Bot AI for Nature. Plans its Play Tiles action by searching for the
// highest-value pattern(s) it can complete this turn (checking both
// single- and double-tile placements, since a card can be finished by
// laying 2 of its 3 tiles in one turn if the board already holds the
// third). Behavior is tuned per-bot by `player.botLevel`:
//   easy   - young-kid level: mostly goes for the easy 1pt Triangle
//            matches, occasionally stumbles onto an Elbow/Line; searches a
//            small sample of spots so it doesn't "see" everything available.
//   medium - recognizes all pattern types, but usually plays the 2nd or 3rd
//            best option instead of the best one (sometimes gets it right).
//   hard   - strategic: takes the best move ~75% of the time, and leans
//            toward racing for Bank cards (which anyone could grab) over
//            its own hidden hand, since those are the ones opponents might
//            beat it to.
//   expert - always takes the statistically best move, searches the full
//            board (no sampling), never leaves points on the table.

function evaluatePlacementValue(state, playerIndex, tempBoard, newKeys) {
  const player = state.players[playerIndex];
  const bankSet = new Set(state.bank);
  const availableIds = new Set([...state.bank, ...player.hand]);
  const patterns = findPatternsIncluding(tempBoard, newKeys);
  let points = 0;
  let bankPoints = 0; // subset of points that come from contested Bank cards
  const matchedCardIds = [];
  const seen = new Set();
  for (const pattern of patterns) {
    const k = cardCanonicalKey(pattern.shape, pattern.tiles.map(t => t.terrain));
    const cardId = CARD_KEY_TO_ID[k];
    if (!cardId || !availableIds.has(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);
    points += SHAPE_POINTS[pattern.shape];
    if (bankSet.has(cardId)) bankPoints += SHAPE_POINTS[pattern.shape];
    matchedCardIds.push(cardId);
  }
  const shapes = matchedCardIds.map(cid => CARDS_BY_ID[cid].shape);
  return { points, bankPoints, matchedCardIds, shapes };
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

const BOT_SPOT_SAMPLE_CAP = { easy: 10, medium: 20, hard: 30, expert: Infinity };

// Returns a ranked list of candidates: [{ placements, points, bankPoints,
// matchedCardIds, shapes }, ...] sorted best-first (ties broken randomly so
// bots don't always prefer the same spot/terrain ordering).
function rankPlacementCandidates(state, playerIndex, botLevel) {
  const player = state.players[playerIndex];
  if (player.pool.length === 0) return [];
  const legalSpots = getLegalSpots(state);
  if (legalSpots.length === 0) return [];

  const board = boardMap(state.board);
  const uniqueTerrains = [...new Set(player.pool)];
  const cap = BOT_SPOT_SAMPLE_CAP[botLevel] ?? 30;
  const spotsSample = legalSpots.length > cap
    ? shuffle(legalSpots).slice(0, cap)
    : legalSpots;

  const candidates = [];

  for (const terrain of uniqueTerrains) {
    for (const spotKey of spotsSample) {
      const { q, r } = parseKey(spotKey);
      const b1 = new Map(board);
      b1.set(spotKey, terrain);
      const ev1 = evaluatePlacementValue(state, playerIndex, b1, [spotKey]);
      candidates.push({ placements: [{ terrain, q, r }], ...ev1 });

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
          candidates.push({
            placements: [{ terrain, q, r }, { terrain: t2, q: q2, r: r2 }],
            ...ev2
          });
        }
      }
    }
  }

  // Rank: raw points first; hard/expert additionally favor claiming
  // contested Bank cards over hidden-hand cards when points tie, since a
  // Bank card is something an opponent could grab first ("beat them to it").
  const favorBank = botLevel === "hard" || botLevel === "expert";
  candidates.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (favorBank && b.bankPoints !== a.bankPoints) return b.bankPoints - a.bankPoints;
    return 0;
  });
  return candidates;
}

// Picks a placement from the ranked candidate list according to difficulty.
function choosePlacementByDifficulty(candidates, botLevel) {
  if (!candidates.length) return null;

  if (botLevel === "easy") {
    // Mostly goes for pure-Triangle matches (the "obvious" 1pt play a kid
    // would spot), only occasionally noticing an Elbow/Line opportunity —
    // and sometimes just doesn't take the best available move at all.
    const triangleOnly = candidates.filter(c => c.points === 0 || c.shapes.every(s => s === "triangle"));
    const pool = triangleOnly.length && Math.random() < 0.8 ? triangleOnly : candidates;
    // 25% of the time, ignore points entirely and just pick something
    // reasonable-looking (simulates "doesn't always recognize what's available").
    if (Math.random() < 0.25) {
      const zeroOrLow = candidates.filter(c => c.points <= 1);
      if (zeroOrLow.length) return zeroOrLow[Math.floor(Math.random() * zeroOrLow.length)];
    }
    return pool[0] || candidates[0];
  }

  // Group by distinct point value to get "1st best / 2nd best / 3rd best" tiers.
  const tiers = [];
  const seenPoints = new Set();
  for (const c of candidates) {
    if (!seenPoints.has(c.points)) { seenPoints.add(c.points); tiers.push(c.points); }
    if (tiers.length >= 3) break;
  }
  const byTier = (pts) => candidates.filter(c => c.points === pts);

  if (botLevel === "medium") {
    // Usually 2nd/3rd best, sometimes the actual best.
    const weights = [0.25, 0.4, 0.35].slice(0, tiers.length);
    const totalW = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalW;
    let idx = 0;
    for (; idx < weights.length; idx++) {
      if (roll < weights[idx]) break;
      roll -= weights[idx];
    }
    const tierCandidates = byTier(tiers[idx] ?? tiers[0]);
    return tierCandidates[Math.floor(Math.random() * tierCandidates.length)];
  }

  if (botLevel === "hard") {
    // Best move 75% of the time, otherwise 2nd best.
    if (Math.random() < 0.75 || tiers.length < 2) return byTier(tiers[0])[0];
    const secondTier = byTier(tiers[1]);
    return secondTier[Math.floor(Math.random() * secondTier.length)];
  }

  // expert: always the best (searched the full board, no sampling).
  return candidates[0];
}

function planBestPlacement(state, playerIndex, botLevelOverride) {
  const player = state.players[playerIndex];
  const botLevel = botLevelOverride || player.botLevel || "medium";
  const candidates = rankPlacementCandidates(state, playerIndex, botLevel);
  return choosePlacementByDifficulty(candidates, botLevel);
}

// Pick which terrains to draw for the Draw Tiles action: prefer terrains
// that appear in the bot's own hand cards or the bank (so pool stays useful).
// Hard/expert bots also weigh terrains opponents are visibly stockpiling in
// their public tile pools, to deny them useful tiles.
function pickTileDrawPicks(state, playerIndex, count) {
  const player = state.players[playerIndex];
  const botLevel = player.botLevel || "medium";
  const wanted = {};
  [...player.hand, ...state.bank].forEach(cardId => {
    const card = CARDS_BY_ID[cardId];
    card.terrains.forEach(t => { wanted[t] = (wanted[t] || 0) + 1; });
  });

  if (botLevel === "hard" || botLevel === "expert") {
    state.players.forEach((opp, i) => {
      if (i === playerIndex) return;
      opp.pool.forEach(t => { wanted[t] = (wanted[t] || 0) + 0.4; }); // denial bonus, weighted below self-interest
    });
  }

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
  const botLevel = player.botLevel || "medium";

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
    const fallbackPlan = planBestPlacement(state, playerIndex, botLevel === "expert" ? "expert" : "hard");
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
