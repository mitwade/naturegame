// Rendering helpers: hex board SVG + card/tile widgets. No framework —
// small direct DOM/SVG builders.

const HEX_SIZE = 34; // pixel "radius" of each hex

function axialToPixel(q, r) {
  const x = HEX_SIZE * Math.sqrt(3) * (q + r / 2);
  const y = HEX_SIZE * 1.5 * r;
  return { x, y };
}

function hexPoints(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + HEX_SIZE * Math.cos(angle)},${cy + HEX_SIZE * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

// Renders the full board into the given <svg>. `legalSpots` is an array of
// "q,r" keys; `onSpotClick(qr)` fires when a legal empty spot is clicked.
function renderBoard(svg, state, legalSpots, onSpotClick) {
  svg.innerHTML = "";
  const boardKeys = Object.keys(state.board);
  const legalSet = new Set(legalSpots || []);
  const allKeys = new Set([...boardKeys, ...legalSet]);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const positions = {};
  allKeys.forEach(k => {
    const { q, r } = parseKey(k);
    const { x, y } = axialToPixel(q, r);
    positions[k] = { x, y };
    minX = Math.min(minX, x - HEX_SIZE); maxX = Math.max(maxX, x + HEX_SIZE);
    minY = Math.min(minY, y - HEX_SIZE); maxY = Math.max(maxY, y + HEX_SIZE);
  });
  const pad = 30;
  const w = (maxX - minX) + pad * 2;
  const h = (maxY - minY) + pad * 2;
  svg.setAttribute("viewBox", `${minX - pad} ${minY - pad} ${w} ${h}`);
  svg.setAttribute("width", Math.max(w, 300));
  svg.setAttribute("height", Math.max(h, 300));

  // Occupied tiles
  boardKeys.forEach(k => {
    const terrain = state.board[k];
    const { x, y } = positions[k];
    const g = svgEl("g", {});
    const poly = svgEl("polygon", {
      points: hexPoints(x, y),
      class: "hex",
      fill: TERRAIN_COLORS[terrain]
    });
    g.appendChild(poly);
    const label = svgEl("text", {
      x, y: y + 8, "text-anchor": "middle", class: "hex-emoji"
    });
    label.textContent = TERRAIN_EMOJI[terrain];
    g.appendChild(label);
    svg.appendChild(g);
  });

  // Legal empty spots
  legalSet.forEach(k => {
    if (state.board[k]) return;
    const { x, y } = positions[k];
    const poly = svgEl("polygon", {
      points: hexPoints(x, y),
      class: "hex legal hex-empty"
    });
    poly.addEventListener("click", () => onSpotClick && onSpotClick(k));
    svg.appendChild(poly);
  });
}

function renderCard(cardId, { claimable, onClick, faceDown } = {}) {
  const card = CARDS_BY_ID[cardId];
  const div = document.createElement("div");
  div.className = "nature-card" + (claimable ? " claimable" : "");
  if (faceDown) {
    div.innerHTML = `<div class="nc-title">NATURE</div><div style="font-size:30px;padding:16px 0;">🂠</div>`;
    return div;
  }
  const shapeRow = card.terrains.map(t => `<div class="nc-hex">${TERRAIN_EMOJI[t]}</div>`).join("");
  div.innerHTML = `
    <div class="nc-title">NATURE</div>
    <div class="nc-shape-row">${shapeRow}</div>
    <div class="nc-shapelabel">${SHAPE_LABELS[card.shape]}</div>
    <div class="nc-points">${card.points} pt${card.points > 1 ? "s" : ""}</div>
  `;
  if (onClick) div.addEventListener("click", () => onClick(cardId));
  return div;
}

function renderTileChip(terrain, { selected, disabled, onClick } = {}) {
  const div = document.createElement("div");
  div.className = "tile-chip" + (selected ? " selected" : "") + (disabled ? " disabled" : "");
  div.textContent = TERRAIN_EMOJI[terrain];
  div.title = TERRAIN_LABELS[terrain];
  if (onClick && !disabled) div.addEventListener("click", () => onClick());
  return div;
}

function renderMarketTile(terrain, { selected, onClick } = {}) {
  const div = document.createElement("div");
  div.className = "market-tile" + (selected ? " selected" : "");
  div.textContent = TERRAIN_EMOJI[terrain];
  div.title = TERRAIN_LABELS[terrain];
  if (onClick) div.addEventListener("click", () => onClick());
  return div;
}

if (typeof module !== "undefined") {
  module.exports = { axialToPixel, hexPoints, renderBoard, renderCard, renderTileChip, renderMarketTile };
}
