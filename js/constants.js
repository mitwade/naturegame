// Core constants for the Nature game

const TERRAINS = [
  "volcano", "forest", "ocean", "desert",
  "iceberg", "meadow", "pond", "mountain"
];

const TERRAIN_LABELS = {
  volcano: "Volcano",
  forest: "Forest",
  ocean: "Ocean",
  desert: "Desert",
  iceberg: "Iceberg",
  meadow: "Meadow",
  pond: "Pond",
  mountain: "Mountain"
};

// Emoji fallback art so the game renders with zero image assets.
const TERRAIN_EMOJI = {
  volcano: "🌋",
  forest: "🌲",
  ocean: "🌊",
  desert: "🏜️",
  iceberg: "🧊",
  meadow: "🌸",
  pond: "🪷",
  mountain: "⛰️"
};

const TERRAIN_COLORS = {
  volcano: "#c0532a",
  forest: "#2f6b2f",
  ocean: "#12768a",
  desert: "#d8c17a",
  iceberg: "#1651c9",
  meadow: "#e9a8b4",
  pond: "#2fb0c9",
  mountain: "#4b4f54"
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
    TERRAINS, TERRAIN_LABELS, TERRAIN_EMOJI, TERRAIN_COLORS,
    SHAPES, SHAPE_POINTS, SHAPE_LABELS,
    TILE_COUNT_PER_TERRAIN, TOTAL_TILES,
    TOTAL_CARDS, CARDS_PER_TERRAIN, MIXED_CARDS
  };
}
