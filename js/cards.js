// Generates the 216-card Nature Card deck.
//
// NOTE ON DATA: the physical card sheets show 216 hand-illustrated cards,
// but the rulebook only specifies the *distribution* (72 cards per shape;
// 24 "built around" each of the 8 terrains + 24 mixed), not each card's
// exact terrain combo. Rather than guess-transcribe 216 individual cards
// from images, this file *generates* a deck that satisfies the documented
// distribution exactly, with deterministic, unique, non-overlapping combos.
// If you have (or make) an authoritative card list, replace generateDeck()
// with a hard-coded array — every other module only depends on each card
// having { id, shape, terrains: [end, pivot, end] | [a,b,c], points }.

function cardCanonicalKey(shape, terrains) {
  if (shape === "triangle") {
    return "triangle:" + [...terrains].sort().join(",");
  }
  const ends = [terrains[0], terrains[2]].sort();
  return shape + ":" + terrains[1] + ":" + ends.join(",");
}

function generateDeck() {
  const cards = [];
  let idCounter = 1;
  const usedKeys = new Set();

  function addCard(shape, terrains, owner) {
    const k = cardCanonicalKey(shape, terrains);
    if (usedKeys.has(k)) return false;
    usedKeys.add(k);
    cards.push({
      id: "C" + String(idCounter++).padStart(3, "0"),
      shape,
      terrains: terrains.slice(),
      points: SHAPE_POINTS[shape],
      owner: owner || "mixed"
    });
    return true;
  }

  // --- Built-around-terrain cards: 24 per terrain (8 per shape) ---
  TERRAINS.forEach(T => {
    const others = TERRAINS.filter(t => t !== T);
    SHAPES.forEach(shape => {
      addCard(shape, [T, T, T], T); // the "all one terrain" card
      others.forEach((comp, idx) => {
        if (shape === "triangle") {
          addCard("triangle", [T, T, comp], T);
        } else if (idx % 2 === 0) {
          addCard(shape, [T, T, comp], T); // companion is an end
        } else {
          addCard(shape, [T, comp, T], T); // companion is the pivot
        }
      });
    });
  });

  // --- Mixed cards: 24 total, all-distinct terrains (8 per shape) ---
  SHAPES.forEach((shape, sIdx) => {
    let made = 0;
    let offset = 0;
    while (made < 8 && offset < 500) {
      const i = offset;
      const a = TERRAINS[i % 8];
      const b = TERRAINS[(i + 3 + sIdx) % 8];
      const c = TERRAINS[(i + 5 + sIdx * 2) % 8];
      offset++;
      if (a === b || b === c || a === c) continue;
      if (addCard(shape, [a, b, c], "mixed")) made++;
    }
  });

  return cards;
}

if (typeof module !== "undefined") {
  module.exports = { generateDeck, cardCanonicalKey };
}
