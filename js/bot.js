// Bot AI for Nature. Plans its Play Tiles action by searching for the
// highest-value pattern(s) it can complete this turn (checking both
// single- and double-tile placements), AND — this is what separates a
// strong bot from a weak one — looks one move further: when nothing
// completes *this* turn, it scores candidate placements by how good a
// "setup" they create (a 2-of-3 partial pattern one tile away from a
// card it can claim), and it deliberately draws the exact terrain that
// would finish that setup. Difficulty controls how thorough/accurate all
// of this is:
//   easy   - young-kid level: small search sample, mostly goes for the
//            easy 1pt Triangle matches, frequently just doesn't act on
//            what's available, no lookahead/setup planning, often skips
//            placing tiles altogether even when it could.
//   medium - full pattern recognition, a modest amount of setup lookahead,
//            but picks the 2nd/3rd best option more often than the best.
//   hard   - strong lookahead, takes the best move ~75% of the time,
//            prioritizes racing for contestable Bank cards, and actively
//            denies opponents tiles they're visibly collecting.
//   expert - full-strength search every turn (no sampling), always takes
//            the best move, plays tiles proactively almost every turn to
//            keep building toward its hand, and hunts down the exact
//            tiles needed to finish "one-away" setups. Built to almost
//            never lose.

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
  const { q, r } = parseKey(aroundKey);
  neighborsOf(q, r).forEach(n => {
    const nk = key(n.q, n.r);
    if (board.has(nk)) addNeighbors(nk);
  });
  return [...spots];
}

function emptyNeighborSpots(board) {
  const spots = new Set();
  for (const k of board.keys()) {
    const { q, r } = parseKey(k);
    neighborsOf(q, r).forEach(n => {
      const nk = key(n.q, n.r);
      if (!board.has(nk)) spots.add(nk);
    });
  }
  return [...spots];
}

// One-tile-ahead lookahead: given a hypothetical resulting board and the
// terrains still available to place (pool after this turn's placement,
// roughly), what's the best score achievable by adding just ONE more tile?
// This is what lets the bot recognize "this placement sets me up to score
// big next turn" even when it scores 0 points right now.
function bestSingleTileFollowUp(state, playerIndex, board, availableTerrains, sampleCap) {
  if (!availableTerrains.length) return 0;
  const spots = emptyNeighborSpots(board);
  if (!spots.length) return 0;
  const minTouch = state.firstTilePlacedEver ? 2 : 1;
  const sample = spots.length > sampleCap ? shuffle(spots).slice(0, sampleCap) : spots;
  const uniqueTerrains = [...new Set(availableTerrains)];
  let best = 0;
  for (const spotKey of sample) {
    const { q, r } = parseKey(spotKey);
    let touch = 0;
    neighborsOf(q, r).forEach(n => { if (board.has(key(n.q, n.r))) touch++; });
    if (touch < minTouch) continue;
    for (const terrain of uniqueTerrains) {
      const b2 = new Map(board);
      b2.set(spotKey, terrain);
      const ev = evaluatePlacementValue(state, playerIndex, b2, [spotKey]);
      if (ev.points > best) best = ev.points;
    }
  }
  return best;
}

const BOT_SPOT_SAMPLE_CAP = { easy: 10, medium: 16, hard: 30, expert: 100 };
const BOT_LOOKAHEAD_CAP = { easy: 0, medium: 4, hard: 12, expert: 30 };

// Returns a ranked list of candidates, best first. Each candidate:
// { placements, points, bankPoints, matchedCardIds, shapes, rankScore }
// rankScore = points*1000 + lookaheadSetupValue*10 + bankPoints — immediate
// points always dominate; lookahead only breaks ties (mainly among the
// very common case of "nothing completes this turn").
function rankPlacementCandidates(state, playerIndex, botLevel) {
  const player = state.players[playerIndex];
  if (player.pool.length === 0) return [];
  const legalSpots = getLegalSpots(state);
  if (legalSpots.length === 0) return [];

  const board = boardMap(state.board);
  const uniqueTerrains = [...new Set(player.pool)];
  const cap = BOT_SPOT_SAMPLE_CAP[botLevel] ?? 30;
  const lookaheadCap = BOT_LOOKAHEAD_CAP[botLevel] ?? 0;
  const spotsSample = legalSpots.length > cap
    ? shuffle(legalSpots).slice(0, cap)
    : legalSpots;

  const candidates = [];

  const pushCandidate = (placements, ev, remainingPoolTerrains, resultBoard) => {
    let lookahead = 0;
    if (ev.points === 0 && lookaheadCap > 0) {
      lookahead = bestSingleTileFollowUp(state, playerIndex, resultBoard, remainingPoolTerrains, lookaheadCap);
    }
    const rankScore = ev.points * 1000 + lookahead * 10 + ev.bankPoints;
    candidates.push({ placements, ...ev, lookahead, rankScore });
  };

  for (const terrain of uniqueTerrains) {
    for (const spotKey of spotsSample) {
      const { q, r } = parseKey(spotKey);
      const b1 = new Map(board);
      b1.set(spotKey, terrain);
      const ev1 = evaluatePlacementValue(state, playerIndex, b1, [spotKey]);
      const poolAfter1 = player.pool.slice();
      poolAfter1.splice(poolAfter1.indexOf(terrain), 1);
      pushCandidate([{ terrain, q, r }], ev1, poolAfter1, b1);

      const uniqueRemaining = [...new Set(poolAfter1)];
      if (uniqueRemaining.length === 0) continue;

      const localSpots = localCandidateSpots(b1, spotKey);
      for (const t2 of uniqueRemaining) {
        for (const spotKey2 of localSpots) {
          if (spotKey2 === spotKey) continue;
          const { q: q2, r: r2 } = parseKey(spotKey2);
          let touch = 0;
          neighborsOf(q2, r2).forEach(n => { if (b1.has(key(n.q, n.r))) touch++; });
          if (touch < 2) continue;
          const b2 = new Map(b1);
          b2.set(spotKey2, t2);
          const ev2 = evaluatePlacementValue(state, playerIndex, b2, [spotKey, spotKey2]);
          const poolAfter2 = poolAfter1.slice();
          poolAfter2.splice(poolAfter2.indexOf(t2), 1);
          pushCandidate([{ terrain, q, r }, { terrain: t2, q: q2, r: r2 }], ev2, poolAfter2, b2);
        }
      }
    }
  }

  const favorBank = botLevel === "hard" || botLevel === "expert";
  candidates.sort((a, b) => {
    if (favorBank) return b.rankScore - a.rankScore;
    // Lower difficulties don't get the Bank-racing tiebreak.
    if (b.points !== a.points) return b.points - a.points;
    return b.lookahead - a.lookahead;
  });
  return candidates;
}

// Picks a placement from the ranked candidate list according to difficulty.
// Important: "usually 2nd/3rd best" should mean picking among comparable
// options (e.g. an Elbow instead of a Line when both score this turn), not
// randomly falling all the way from a scoring move to a zero-point one —
// that would make a "so-so" bot worse than a bot that never scores at all.
// So we tier separately within scoring candidates vs. non-scoring
// (setup-only) candidates, and only drop to the non-scoring pool when
// nothing on the board scores at all this turn.
function choosePlacementByDifficulty(candidates, botLevel) {
  if (!candidates.length) return null;

  if (botLevel === "easy") {
    const triangleOnly = candidates.filter(c => c.points === 0 || c.shapes.every(s => s === "triangle"));
    const pool = triangleOnly.length && Math.random() < 0.8 ? triangleOnly : candidates;
    if (Math.random() < 0.25) {
      const zeroOrLow = candidates.filter(c => c.points <= 1);
      if (zeroOrLow.length) return zeroOrLow[Math.floor(Math.random() * zeroOrLow.length)];
    }
    return pool[0] || candidates[0];
  }

  const scoring = candidates.filter(c => c.points > 0);
  const pool = scoring.length ? scoring : candidates;

  // Group by distinct rankScore tiers ("1st best / 2nd best / 3rd best")
  // within whichever pool we're choosing from.
  const tiers = [];
  const seenScores = new Set();
  for (const c of pool) {
    if (!seenScores.has(c.rankScore)) { seenScores.add(c.rankScore); tiers.push(c.rankScore); }
    if (tiers.length >= 3) break;
  }
  const byTier = (score) => pool.filter(c => c.rankScore === score);

  if (botLevel === "medium") {
    const weights = [0.3, 0.4, 0.3].slice(0, tiers.length);
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
    if (Math.random() < 0.74 || tiers.length < 2) return byTier(tiers[0])[0];
    const secondTier = byTier(tiers[1]);
    return secondTier[Math.floor(Math.random() * secondTier.length)];
  }

  // expert: always the best (full search, no sampling).
  return candidates[0];
}

function planBestPlacement(state, playerIndex, botLevelOverride) {
  const player = state.players[playerIndex];
  const botLevel = botLevelOverride || player.botLevel || "medium";
  const candidates = rankPlacementCandidates(state, playerIndex, botLevel);
  return choosePlacementByDifficulty(candidates, botLevel);
}

// How often a bot places tiles proactively even when nothing completes
// *this* turn (pure board-building/setup, betting on a future turn). Weak
// bots sit around waiting for pool pressure; strong bots almost always
// keep building.
const PLACEMENT_AGGRESSION = { easy: 0.3, medium: 0.65, hard: 0.85, expert: 1.0 };

// Finds terrains that would IMMEDIATELY complete a card the bot can claim
// (hand or Bank) if placed at some currently-empty legal-ish spot — i.e.
// "one tile away" needs. Used to make Draw Tiles purposeful instead of
// generic, and to make denial (hard/expert) target the right terrain.
function computeUrgentTerrainNeeds(state, playerIndex, lookaheadCap) {
  const player = state.players[playerIndex];
  const availableIds = new Set([...state.bank, ...player.hand]);
  const board = boardMap(state.board);
  const spots = emptyNeighborSpots(board);
  const minTouch = state.firstTilePlacedEver ? 2 : 1;
  const sample = spots.length > lookaheadCap ? shuffle(spots).slice(0, lookaheadCap) : spots;
  const wanted = {};
  for (const spotKey of sample) {
    const { q, r } = parseKey(spotKey);
    let touch = 0;
    neighborsOf(q, r).forEach(n => { if (board.has(key(n.q, n.r))) touch++; });
    if (touch < minTouch) continue;
    for (const terrain of TERRAINS) {
      const b2 = new Map(board);
      b2.set(spotKey, terrain);
      const patterns = findPatternsIncluding(b2, [spotKey]);
      for (const pattern of patterns) {
        const k = cardCanonicalKey(pattern.shape, pattern.tiles.map(t => t.terrain));
        const cardId = CARD_KEY_TO_ID[k];
        if (cardId && availableIds.has(cardId)) {
          wanted[terrain] = (wanted[terrain] || 0) + SHAPE_POINTS[pattern.shape] * 3;
        }
      }
    }
  }
  return wanted;
}

// Pick which terrains to draw for the Draw Tiles action: strongly prefers
// terrains that would immediately complete a "one-away" setup, then
// terrains that appear in the bot's hand/bank cards generally. Hard/expert
// bots also weigh terrains opponents are visibly stockpiling in their
// public tile pools, to deny them useful tiles.
function pickTileDrawPicks(state, playerIndex, count) {
  const player = state.players[playerIndex];
  const botLevel = player.botLevel || "medium";
  const wanted = {};
  [...player.hand, ...state.bank].forEach(cardId => {
    const card = CARDS_BY_ID[cardId];
    card.terrains.forEach(t => { wanted[t] = (wanted[t] || 0) + 1; });
  });

  const urgentCap = botLevel === "expert" ? 25 : botLevel === "hard" ? 16 : botLevel === "medium" ? 8 : 0;
  if (urgentCap > 0) {
    const urgent = computeUrgentTerrainNeeds(state, playerIndex, urgentCap);
    Object.keys(urgent).forEach(t => { wanted[t] = (wanted[t] || 0) + urgent[t]; });
  }

  if (botLevel === "hard" || botLevel === "expert") {
    state.players.forEach((opp, i) => {
      if (i === playerIndex) return;
      opp.pool.forEach(t => { wanted[t] = (wanted[t] || 0) + 0.4; }); // denial bonus, below self-interest
    });
  }

  const picks = [];
  const marketCopy = state.tileMarket.map((t, i) => ({ t, i }));
  for (let n = 0; n < count; n++) {
    if (marketCopy.length > 0) {
      marketCopy.sort((a, b) => (wanted[b.t] || 0) - (wanted[a.t] || 0));
      const choice = marketCopy.shift();
      picks.push({ source: "market", marketIndex: choice.i });
      marketCopy.forEach(m => { if (m.i > choice.i) m.i -= 1; });
    } else {
      picks.push({ source: "draw" });
    }
  }
  return picks;
}

// Executes a full bot turn (2 actions) directly against the real state via
// the engine functions, then calls endTurn.
function runBotTurn(state, playerIndex) {
  const events = [];
  const player = state.players[playerIndex];
  const botLevel = player.botLevel || "medium";

  const plan = planBestPlacement(state, playerIndex);
  const aggression = PLACEMENT_AGGRESSION[botLevel] ?? 0.65;
  let shouldPlace = false;
  if (plan) {
    if (plan.points > 0) {
      shouldPlace = true; // always take free points
    } else {
      const poolPressure = player.pool.length >= 5;
      shouldPlace = poolPressure || Math.random() < aggression;
    }
  }

  let placedThisTurn = false;

  if (shouldPlace && canUseAction(state, playerIndex, "playTiles")) {
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

  // Expert manages its hand a little tighter than the other tiers: it
  // keeps drawing cards until it has a healthy buffer of options (5+)
  // rather than stopping at 4, since more hand cards means more chances to
  // spot a claimable pattern when a good board position comes up.
  const handTarget = botLevel === "expert" ? 5 : 4;
  const wantsCards = player.hand.length < handTarget;
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
    if (wantsCards) {
      if (!tryDrawCards()) tryDrawTiles();
    } else {
      if (!tryDrawTiles()) tryDrawCards();
    }
  }

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
