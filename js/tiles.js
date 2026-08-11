// Generates the 112-tile bag: 14 of each of the 8 terrains.

function generateTileBag() {
  const bag = [];
  TERRAINS.forEach(t => {
    for (let i = 0; i < TILE_COUNT_PER_TERRAIN; i++) bag.push(t);
  });
  return bag;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  const rand = rng || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (typeof module !== "undefined") {
  module.exports = { generateTileBag, shuffle };
}
