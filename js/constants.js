// Core constants for the Nature game

const TERRAINS = [
  "volcano", "forest", "ocean", "desert",
  "glacier", "meadow", "pond", "mountain"
];

const TERRAIN_LABELS = {
  volcano: "Volcano",
  forest: "Forest",
  ocean: "Ocean",
  desert: "Desert",
  glacier: "Glacier",
  meadow: "Meadow",
  pond: "Pond",
  mountain: "Mountain"
};

// Real artwork (flat-top hex crops). Falls back to emoji/color if an image
// fails to load (see render.js).
const TERRAIN_IMAGES = {
  volcano: "assets/terrain/volcano.png",
  forest: "assets/terrain/forest.png",
  ocean: "assets/terrain/ocean.png",
  desert: "assets/terrain/desert.png",
  glacier: "assets/terrain/glacier.png",
  meadow: "assets/terrain/meadow.png",
  pond: "assets/terrain/pond.png",
  mountain: "assets/terrain/mountain.png"
};

// Emoji fallback art (used only if an image asset fails to load).
const TERRAIN_EMOJI = {
  volcano: "🌋",
  forest: "🌲",
  ocean: "🌊",
  desert: "🏜️",
  glacier: "🧊",
  meadow: "🌸",
  pond: "🪷",
  mountain: "⛰️"
};

const TERRAIN_COLORS = {
  volcano: "#c0532a",   // red/orange
  forest: "#3d6b35",    // dark green/brown
  ocean: "#153e7a",     // dark blue
  desert: "#d8c17a",    // tan/yellow
  glacier: "#cfeaf5",   // white/ice
  meadow: "#e9739a",    // pink
  pond: "#4fc3a1",      // light blue/light green
  mountain: "#787d82"   // grey
};

const SHAPES = ["triangle", "elbow", "line"];

const SHAPE_POINTS = {
  triangle: 1,
  elbow: 2,
  line: 3
};

const SHAPE_LABELS = {
  triangle: "Triangle",
  elbow: "Elbow",
  line: "Straight Line"
};

// Component counts per the rulebook
const TILE_COUNT_PER_TERRAIN = 14; // 112 total / 8 terrains
const TOTAL_TILES = TILE_COUNT_PER_TERRAIN * TERRAINS.length; // 112

const TOTAL_CARDS = 216;
const CARDS_PER_TERRAIN = 24; // "built around" each terrain
const MIXED_CARDS = 24;

if (typeof module !== "undefined") {
  module.exports = {
    TERRAINS, TERRAIN_LABELS, TERRAIN_IMAGES, TERRAIN_EMOJI, TERRAIN_COLORS,
    SHAPES, SHAPE_POINTS, SHAPE_LABELS,
    TILE_COUNT_PER_TERRAIN, TOTAL_TILES,
    TOTAL_CARDS, CARDS_PER_TERRAIN, MIXED_CARDS
  };
}
