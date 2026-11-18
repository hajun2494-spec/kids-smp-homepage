/* Decorative only: no navigation, player data, downloads, or video behavior. */
(() => {
  "use strict";
  if (!document.body.classList.contains("liquid-home")) return;
  const images = [...document.querySelectorAll(".geometry-section > .geometry-side-art")];
  if (!images.length) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const records = images.map(image => {
    const section = image.closest(".geometry-section");
    const candidates = [...section.querySelectorAll(
      "h1, h2, h3, p, summary, .claim-commands > div, .claim-steps > article, .client-download-card"
    )];
    const selected = new Set(candidates);
    const targets = candidates.filter(node => {
      let parent = node.parentElement;
      while (parent && parent !== section) {
        if (selected.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    }).map(node => ({ node, active: false }));
    return { image, section, targets, offset: 0, top: 0, left: 0, width: 0, height: 0 };
  });
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
      for (const target of item.targets) {
        const rect = target.node.getBoundingClientRect();
        target.left = rect.left;
        target.top = rect.top + scrollY;
        target.width = rect.width;
        target.height = rect.height;
      }
    }
  }
  function render() {
    frame = 0;
    const scrollY = window.scrollY;
    const viewportHeight = window.innerHeight;
    const viewportWidth = document.documentElement.clientWidth;
    if (needsMeasure) { measure(scrollY); needsMeasure = false; }
    // Cache all geometry during measure; scroll frames only write styles.
    for (const item of records) {
      const limit = Math.min(130, item.width * 0.7);
      const offset = reducedMotion.matches ? 0 : clamp(
        (scrollY + viewportHeight * 0.5 - item.top - item.height * 0.5) * 0.2,
        -limit, limit
      );
      item.offset = offset;
      item.image.style.setProperty("--geometry-scroll-y", `${offset.toFixed(2)}px`);
      const art = {
        left: Math.max(0, item.left),
        right: Math.min(viewportWidth, item.left + item.width),
        top: item.top + offset,
        bottom: item.top + offset + item.height
      };
      const visible = art.bottom >= scrollY && art.top <= scrollY + viewportHeight;
      for (const target of item.targets) {
        if (!visible || !target.width || !target.height) { clear(target); continue; }
        const left = Math.max(art.left, target.left - 8);
        const right = Math.min(art.right, target.left + target.width + 8);
        const top = Math.max(art.top, target.top - 6);
        const bottom = Math.min(art.bottom, target.top + target.height + 6);
        if (right <= left || bottom <= top) { clear(target); continue; }
        // The frosted pseudo-element is restricted to this exact overlap rectangle.
        const style = target.node.style;
        style.setProperty("--geometry-frost-left", `${(left - target.left).toFixed(2)}px`);
        style.setProperty("--geometry-frost-top", `${(top - target.top).toFixed(2)}px`);
        style.setProperty("--geometry-frost-width", `${(right - left).toFixed(2)}px`);
        style.setProperty("--geometry-frost-height", `${(bottom - top).toFixed(2)}px`);
        if (!target.active) {
          target.node.classList.add("geometry-under-art");
          target.active = true;
        }
      }
    }
  }
  function requestFrame(remeasure = false) {
    needsMeasure ||= remeasure;
    if (!frame) frame = window.requestAnimationFrame(render);
  }
  window.addEventListener("scroll", () => requestFrame(), { passive: true });
  window.addEventListener("resize", () => requestFrame(true), { passive: true });
  // Reset transforms before measuring after a motion preference change.
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
    observer.observe(document.querySelector("main#top"));
  }
  window.addEventListener("pageshow", () => requestFrame(true), { passive: true });
  requestFrame(true);
})();
