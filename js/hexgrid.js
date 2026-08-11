// Axial hex-grid utilities.
// Coordinates are {q, r}. Six neighbor directions, indexed 0-5 around the hex.

const HEX_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

function key(q, r) { return `${q},${r}`; }
function parseKey(k) { const [q, r] = k.split(",").map(Number); return { q, r }; }

function neighborsOf(q, r) {
  return HEX_DIRS.map(d => ({ q: q + d.q, r: r + d.r }));
}

function isAdjacent(a, b) {
  return HEX_DIRS.some(d => a.q + d.q === b.q && a.r + d.r === b.r);
}

function dirIndexFromTo(from, to) {
  const dq = to.q - from.q, dr = to.r - from.r;
  return HEX_DIRS.findIndex(d => d.q === dq && d.r === dr);
}

// Given board (Map of "q,r" -> terrain) and a set of tile keys placed this
// action, find every valid 3-tile pattern (triangle/elbow/line) that
// includes at least one newly placed tile. Returns array of:
// { shape, tiles: [{q,r,terrain}, {q,r,terrain}, {q,r,terrain}] }
// For triangle, tiles order is arbitrary. For elbow/line, tiles = [end, pivot, end].
function findPatternsIncluding(board, newTileKeys) {
  const results = [];
  const seen = new Set();

  function tileAt(k) {
    const t = board.get(k);
    if (!t) return null;
    const { q, r } = parseKey(k);
    return { q, r, terrain: t, k };
  }

  function addResult(shape, tiles) {
    const idKey = shape + ":" + tiles.map(t => t.k).sort().join("|");
    if (seen.has(idKey)) return;
    seen.add(idKey);
    results.push({ shape, tiles });
  }

  for (const nk of newTileKeys) {
    const M = tileAt(nk);
    if (!M) continue;
    const neighborKeys = neighborsOf(M.q, M.r)
      .map(p => key(p.q, p.r))
      .filter(k => board.has(k));

    // Pairs of neighbors of M => M is the pivot/center
    for (let i = 0; i < neighborKeys.length; i++) {
      for (let j = i + 1; j < neighborKeys.length; j++) {
        const A = tileAt(neighborKeys[i]);
        const C = tileAt(neighborKeys[j]);
        if (!A || !C) continue;

        if (isAdjacent(A, C)) {
          // Mutually touching trio => Triangle
          addResult("triangle", [A, M, C]);
        } else {
          const dirA = dirIndexFromTo(M, A);
          const dirC = dirIndexFromTo(M, C);
          const opposite = (dirA + 3) % 6 === dirC;
          addResult(opposite ? "line" : "elbow", [A, M, C]);
        }
      }
    }

    // M could also be an END of a chain (not the pivot): for each neighbor P
    // of M, check P's other neighbors to see if M-P-Q forms a valid chain
    // with M as an end. This is covered by iterating P as the pivot in its
    // own pass above only if P is also a "new tile" or we check explicitly.
    for (const pk of neighborKeys) {
      const P = tileAt(pk);
      const pNeighborKeys = neighborsOf(P.q, P.r)
        .map(p2 => key(p2.q, p2.r))
        .filter(k2 => board.has(k2) && k2 !== M.k);
      for (const qk of pNeighborKeys) {
        const Q = tileAt(qk);
        if (Q.k === M.k) continue;
        if (isAdjacent(M, Q)) {
          addResult("triangle", [M, P, Q]);
        } else {
          const dirM = dirIndexFromTo(P, M);
          const dirQ = dirIndexFromTo(P, Q);
          const opposite = (dirM + 3) % 6 === dirQ;
          addResult(opposite ? "line" : "elbow", [M, P, Q]);
        }
      }
    }
  }

  return results;
}

// Placement legality: does candidate {q,r} touch at least `minTouch`
// existing tiles (board plus any tiles already placed earlier this turn)?
function touchCount(board, q, r) {
  return neighborsOf(q, r).filter(p => board.has(key(p.q, p.r))).length;
}

if (typeof module !== "undefined") {
  module.exports = {
    HEX_DIRS, key, parseKey, neighborsOf, isAdjacent,
    dirIndexFromTo, findPatternsIncluding, touchCount
  };
}
