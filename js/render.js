// Rendering helpers: hex board SVG + card/tile widgets, using real terrain
// artwork (flat-top hexagons) clipped via SVG <clipPath>.

const HEX_SIZE = 42; // pixel "radius" (center-to-vertex) of each board hex
const CARD_HEX_SIZE = 19; // radius for the small hex icons on Nature Cards

// --- Pointy-top axial <-> pixel ---
function axialToPixel(q, r, size = HEX_SIZE) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * 1.5 * r;
  return { x, y };
}

function hexPoints(cx, cy, size = HEX_SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function ensureHexClipPath(defs, size) {
  const id = "hexClip" + Math.round(size);
  if (defs.querySelector(`#${id}`)) return id;
  const clip = svgEl("clipPath", { id });
  clip.appendChild(svgEl("polygon", { points: hexPoints(0, 0, size) }));
  defs.appendChild(clip);
  return id;
}

function terrainHexGroup(cx, cy, terrain, size, defs, extraClass) {
  const g = svgEl("g", { transform: `translate(${cx},${cy})`, class: extraClass || "" });
  const clipId = ensureHexClipPath(defs, size);
  const img = svgEl("image", {
    x: -size * (Math.sqrt(3) / 2), y: -size,
    width: size * Math.sqrt(3), height: size * 2,
    preserveAspectRatio: "xMidYMid slice",
    "clip-path": `url(#${clipId})`
  });
  img.setAttributeNS(XLINK_NS, "href", TERRAIN_IMAGES[terrain]);
  img.setAttribute("href", TERRAIN_IMAGES[terrain]);
  img.addEventListener("error", () => {
    // Fallback if the image asset didn't load: colored hex + emoji
    img.remove();
    const poly = svgEl("polygon", { points: hexPoints(0, 0, size), fill: TERRAIN_COLORS[terrain] });
    g.insertBefore(poly, g.firstChild);
    const label = svgEl("text", { x: 0, y: size * 0.3, "text-anchor": "middle", class: "hex-emoji" });
    label.textContent = TERRAIN_EMOJI[terrain];
    g.appendChild(label);
  });
  g.appendChild(img);
  // Inset the outline so its stroke sits entirely inside this hex's own
  // boundary instead of being centered on the shared edge — a centered
  // stroke bleeds half its width into the neighboring tile, and whichever
  // tile is drawn later paints over the earlier tile's edge color, so only
  // one color ever showed at a shared border. Insetting means both tiles'
  // colors meet exactly at the edge instead of one overwriting the other.
  const strokeWidth = Math.max(2.5, size * 0.11);
  const outline = svgEl("polygon", {
    points: hexPoints(0, 0, size - strokeWidth / 2),
    class: "hex-outline",
    fill: "none",
    stroke: TERRAIN_COLORS[terrain],
    "stroke-width": strokeWidth
  });
  g.appendChild(outline);
  return g;
}

// Renders the full board into the given <svg>. `legalSpots` is an array of
// "q,r" keys; `onSpotClick(qr)` fires when a legal empty spot is clicked.
function renderBoard(svg, state, legalSpots, onSpotClick) {
  svg.innerHTML = "";
  const defs = svgEl("defs", {});
  svg.appendChild(defs);

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
    svg.appendChild(terrainHexGroup(x, y, terrain, HEX_SIZE, defs, "hex-tile"));
  });

  // Legal empty spots (dashed highlight, clickable)
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

// ---------- Card shape layout ----------
// Canonical direction offsets (see hexgrid.js HEX_DIRS ordering) chosen so
// each shape renders recognizably: Line = horizontal chain, Elbow = bent
// chain, Triangle = tight mutually-touching cluster.
const CARD_SHAPE_DIRS = {
  line: { a: 0, c: 3 },    // pure left / pure right -> straight horizontal chain
  elbow: { a: 0, c: 2 },   // right / up-left -> bent chain
  triangle: { a: 0, c: 1 } // adjacent directions -> touching cluster
};

function cardHexPositions(shape, size = CARD_HEX_SIZE) {
  const dirs = CARD_SHAPE_DIRS[shape];
  const dA = HEX_DIRS[dirs.a], dC = HEX_DIRS[dirs.c];
  const pivot = { x: 0, y: 0 };
  const a = axialToPixel(dA.q, dA.r, size);
  const c = axialToPixel(dC.q, dC.r, size);
  return { pivot, a, c };
}

function renderCard(cardId, { claimable, onClick, faceDown } = {}) {
  const card = CARDS_BY_ID[cardId];
  const div = document.createElement("div");
  div.className = "nature-card" + (claimable ? " claimable" : "");
  if (faceDown) {
    div.innerHTML = `<div class="nc-title">NATURE</div><div style="font-size:30px;padding:16px 0;">🂠</div>`;
    return div;
  }

  const { pivot, a, c } = cardHexPositions(card.shape);
  const pts = [a, pivot, c];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = CARD_HEX_SIZE + 4;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const vbW = maxX - minX, vbH = maxY - minY;

  const svg = svgEl("svg", { viewBox: `${minX} ${minY} ${vbW} ${vbH}`, width: "100%", height: "92" });
  const defs = svgEl("defs", {});
  svg.appendChild(defs);

  // terrains = [end1, pivot, end2] for elbow/line; for triangle, order is
  // just [a,b,c] (any assignment is visually equivalent since all 3 mutually
  // touch and rotation/mirror is unrestricted).
  const [tEnd1, tPivot, tEnd2] = card.terrains;
  svg.appendChild(terrainHexGroup(a.x, a.y, tEnd1, CARD_HEX_SIZE, defs));
  svg.appendChild(terrainHexGroup(pivot.x, pivot.y, tPivot, CARD_HEX_SIZE, defs));
  svg.appendChild(terrainHexGroup(c.x, c.y, tEnd2, CARD_HEX_SIZE, defs));

  div.innerHTML = `<div class="nc-title">NATURE</div>`;
  div.appendChild(svg);
  const foot = document.createElement("div");
  foot.innerHTML = `
    <div class="nc-shapelabel">${SHAPE_LABELS[card.shape]}</div>
    <div class="nc-points">${card.points} pt${card.points > 1 ? "s" : ""}</div>
  `;
  div.appendChild(foot);

  if (onClick) div.addEventListener("click", () => onClick(cardId));
  return div;
}

// Small standalone hex icon (used for pool/market/other-players' chips) —
// same SVG clip-path technique as the board tiles, so there's no square
// image bleeding through around the hexagon (no more "white border").
const POOL_HEX_SIZE = 24;
const MARKET_HEX_SIZE = 26;
function terrainHexSvg(terrain, size) {
  const pad = 3;
  const svg = svgEl("svg", {
    viewBox: `${-size - pad} ${-size - pad} ${2 * (size + pad)} ${2 * (size + pad)}`,
    width: size * 2, height: size * 2
  });
  const defs = svgEl("defs", {});
  svg.appendChild(defs);
  svg.appendChild(terrainHexGroup(0, 0, terrain, size, defs));
  return svg;
}

function renderTileChip(terrain, { selected, disabled, onClick } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "hex-chip" + (selected ? " selected" : "") + (disabled ? " disabled" : "");
  wrap.appendChild(terrainHexSvg(terrain, POOL_HEX_SIZE));
  wrap.title = TERRAIN_LABELS[terrain];
  if (onClick && !disabled) wrap.addEventListener("click", () => onClick());
  return wrap;
}

function renderMarketTile(terrain, { selected, onClick } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "hex-chip market-hex-chip" + (selected ? " selected" : "");
  wrap.appendChild(terrainHexSvg(terrain, MARKET_HEX_SIZE));
  wrap.title = TERRAIN_LABELS[terrain];
  if (onClick) wrap.addEventListener("click", () => onClick());
  return wrap;
}

if (typeof module !== "undefined") {
  module.exports = { axialToPixel, hexPoints, renderBoard, renderCard, renderTileChip, renderMarketTile, cardHexPositions };
}
