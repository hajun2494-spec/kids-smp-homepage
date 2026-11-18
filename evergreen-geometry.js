/* Decorative only: no navigation, player data, downloads, or video behavior. */
(() => {
  "use strict";
  if (!document.body.classList.contains("liquid-home")) return;
  const main = document.querySelector("main#top");
  const images = [...document.querySelectorAll(".geometry-section > .geometry-side-art")];
  if (!main || !images.length) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const records = images.map(image => ({
    image, section: image.closest(".geometry-section"),
    offset: 0, top: 0, left: 0, width: 0, height: 0
  }));
  // A slow sculpture can pass behind the next section, so protect all readable
  // areas together instead of only the text belonging to its original section.
  const candidates = [...main.querySelectorAll(
    ".geometry-section h1, .geometry-section h2, .geometry-section h3, " +
    ".geometry-section p, .geometry-section summary, " +
    ".geometry-section .claim-commands > div, " +
    ".geometry-section .claim-steps > article, .geometry-section .client-download-card"
  )];
  const selected = new Set(candidates);
  const targets = candidates.filter(node => {
    let parent = node.parentElement;
    while (parent && parent !== main) {
      if (selected.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  }).map(node => ({ node, active: false }));
  let frame = 0;
  let needsMeasure = true;
  const clear = target => {
    if (!target.active) return;
    target.node.classList.remove("geometry-under-art");
    target.active = false;
  };
  function measure(scrollY) {
    for (const item of records) {
      const box = item.image.getBoundingClientRect();
      item.top = box.top + scrollY - item.offset;
      item.left = box.left;
      item.width = box.width;
      item.height = box.height;
    }
    for (const target of targets) {
      const rect = target.node.getBoundingClientRect();
      target.left = rect.left;
      target.top = rect.top + scrollY;
      target.width = rect.width;
      target.height = rect.height;
    }
  }
  function render() {
    frame = 0;
    const scrollY = window.scrollY;
    const viewportHeight = window.innerHeight;
    const viewportWidth = document.documentElement.clientWidth;
    if (needsMeasure) { measure(scrollY); needsMeasure = false; }
    const visibleArt = [];
    // Document-space anchor + 62% scroll compensation = 38% viewport speed.
    // The generous limit is reached only beyond the visible screen: no small
    // 130px plateau makes a visible sculpture suddenly follow the page again.
    for (const item of records) {
      const limit = 0.95 * (viewportHeight + item.height);
      const offset = reducedMotion.matches ? 0 : clamp(
        (scrollY + viewportHeight * 0.5 - item.top - item.height * 0.5) * 0.62,
        -limit, limit
      );
      item.offset = offset;
      item.image.style.setProperty("--geometry-scroll-y", `${offset.toFixed(2)}px`);
      const art = {
        left: Math.max(0, item.left),
        right: Math.min(viewportWidth, item.left + item.width),
        top: item.top + offset,
        bottom: item.top + offset + item.height,
        width: item.width
      };
      if (art.bottom >= scrollY && art.top <= scrollY + viewportHeight) visibleArt.push(art);
    }
    // Scroll frames read only cached bounds. Round frosted halos are calculated
    // from actual overlap, and their radial masks never filter the text itself.
    for (const target of targets) {
      if (!target.width || !target.height || target.top + target.height < scrollY - 220 ||
          target.top > scrollY + viewportHeight + 220) { clear(target); continue; }
      const circles = [];
      for (const art of visibleArt) {
        const left = Math.max(art.left, target.left - 8);
        const right = Math.min(art.right, target.left + target.width + 8);
        const top = Math.max(art.top, target.top - 6);
        const bottom = Math.min(art.bottom, target.top + target.height + 6);
        if (right <= left || bottom <= top) continue;
        circles.push({
          x: (left + right) * 0.5 - target.left,
          y: (top + bottom) * 0.5 - target.top,
          radius: Math.max(30, Math.min(art.width * 0.62, Math.max(right - left, bottom - top) * 0.6 + 18))
        });
      }
      if (!circles.length) { clear(target); continue; }
      const left = Math.min(...circles.map(circle => circle.x - circle.radius));
      const right = Math.max(...circles.map(circle => circle.x + circle.radius));
      const top = Math.min(...circles.map(circle => circle.y - circle.radius));
      const bottom = Math.max(...circles.map(circle => circle.y + circle.radius));
      const mask = circles.map(circle =>
        `radial-gradient(circle ${circle.radius.toFixed(2)}px at ${(circle.x - left).toFixed(2)}px ${(circle.y - top).toFixed(2)}px, #000 0%, #000 34%, rgb(0 0 0 / 90%) 52%, rgb(0 0 0 / 48%) 74%, transparent 100%)`
      ).join(", ");
      const style = target.node.style;
      style.setProperty("--geometry-frost-left", `${left.toFixed(2)}px`);
      style.setProperty("--geometry-frost-top", `${top.toFixed(2)}px`);
      style.setProperty("--geometry-frost-width", `${(right - left).toFixed(2)}px`);
      style.setProperty("--geometry-frost-height", `${(bottom - top).toFixed(2)}px`);
      style.setProperty("--geometry-frost-mask", mask);
      if (!target.active) {
        target.node.classList.add("geometry-under-art");
        target.active = true;
      }
    }
  }
  function requestFrame(remeasure = false) {
    needsMeasure ||= remeasure;
    if (!frame) frame = window.requestAnimationFrame(render);
  }
  window.addEventListener("scroll", () => requestFrame(), { passive: true });
  window.addEventListener("resize", () => requestFrame(true), { passive: true });
  reducedMotion.addEventListener("change", () => {
    for (const item of records) {
      item.offset = 0;
      item.image.style.setProperty("--geometry-scroll-y", "0px");
    }
    requestFrame(true);
  });
  for (const image of images) image.addEventListener("load", () => requestFrame(true), { once: true });
  if (document.fonts) document.fonts.ready.then(() => requestFrame(true));
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => requestFrame(true));
    records.forEach(item => observer.observe(item.section));
    observer.observe(main);
  }
  window.addEventListener("pageshow", () => requestFrame(true), { passive: true });
  requestFrame(true);
})();
