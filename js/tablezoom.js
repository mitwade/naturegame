// Turns #table-surface into a pannable/zoomable "tabletop" inside
// #table-viewport — drag to pan, scroll (or +/-/reset buttons) to zoom,
// like a virtual tabletop app (Tabletopia-style). Self-contained: doesn't
// touch game state, just CSS transforms on a wrapper div.
(function () {
  const viewport = document.getElementById("table-viewport");
  const surface = document.getElementById("table-surface");
  if (!viewport || !surface) return;

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 2.25;
  let scale = 1;
  let panX = 0;
  let panY = 0;

  function apply() {
    surface.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  // Zoom while keeping the point under (clientX, clientY) visually fixed —
  // same behavior as Google Maps / Tabletopia scroll-zoom.
  function setScale(nextScale, clientX, clientY) {
    nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const rect = viewport.getBoundingClientRect();
    const originX = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    const originY = clientY !== undefined ? clientY - rect.top : rect.height / 2;
    const worldX = (originX - panX) / scale;
    const worldY = (originY - panY) / scale;
    scale = nextScale;
    panX = originX - worldX * scale;
    panY = originY - worldY * scale;
    apply();
  }

  function resetView() {
    scale = 1;
    panX = 0;
    panY = 0;
    apply();
  }

  // Scroll to zoom — but let scrollable panels (log, other-players' pools)
  // keep their native scroll instead of hijacking the wheel event.
  viewport.addEventListener("wheel", (e) => {
    if (e.target.closest(".log-box, .other-pool-tray, #board-scroll")) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setScale(scale * factor, e.clientX, e.clientY);
  }, { passive: false });

  // Drag to pan. We only start "panning" once the pointer has actually
  // moved a few pixels, so ordinary clicks on hexes/buttons/tiles underneath
  // still register normally.
  let dragging = false;
  let moved = false;
  let dragStart = null;
  let panStart = null;

  viewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    moved = false;
    dragStart = { x: e.clientX, y: e.clientY };
    panStart = { x: panX, y: panY };
  });

  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!moved && Math.hypot(dx, dy) > 4) {
      moved = true;
      viewport.classList.add("dragging");
    }
    if (moved) {
      panX = panStart.x + dx;
      panY = panStart.y + dy;
      apply();
    }
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("dragging");
    if (moved) {
      // Swallow the click that follows a real drag so releasing the mouse
      // over a hex/button doesn't also fire its click handler.
      const suppressNextClick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", suppressNextClick, true);
      };
      window.addEventListener("click", suppressNextClick, true);
    }
  }
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  document.getElementById("btn-zoom-in")?.addEventListener("click", () => setScale(scale * 1.25));
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => setScale(scale / 1.25));
  document.getElementById("btn-zoom-reset")?.addEventListener("click", resetView);

  apply();
})();
