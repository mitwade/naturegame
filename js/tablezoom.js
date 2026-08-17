// Lets the tabletop surface be zoomed in/out to fit the screen, while
// panning is just normal scrolling (native touch scroll works properly on
// mobile this way — a custom drag-to-pan gesture was fighting the browser's
// own scroll/swipe handling). Uses the CSS `zoom` property rather than a
// transform: scale(), since `zoom` participates in normal layout/scrolling
// (the viewport's scrollable area updates correctly as you zoom), whereas
// a transformed element's visual size and its layout size diverge and
// scrolling stops reaching the true edges once scaled up.
(function () {
  const viewport = document.getElementById("table-viewport");
  const surface = document.getElementById("table-surface");
  if (!viewport || !surface) return;

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2;
  let zoomLevel = 1;

  function apply() {
    surface.style.zoom = zoomLevel;
  }

  function setZoom(next) {
    zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    apply();
  }

  document.getElementById("btn-zoom-in")?.addEventListener("click", () => setZoom(zoomLevel * 1.15));
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => setZoom(zoomLevel / 1.15));
  document.getElementById("btn-zoom-reset")?.addEventListener("click", () => setZoom(1));

  apply();
})();
