/** Keep a native, keyboard-accessible range control visible independently of OS scrollbars. */
export function attachPlotScrollbar(viewport, label) {
  const bar = document.createElement("div");
  bar.className = "plot-scrollbar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", `${label} horizontal scrolling`);
  const back = document.createElement("button");
  const forward = document.createElement("button");
  for (const [button, direction, symbol] of [[back, "left", "◀"], [forward, "right", "▶"]]) {
    button.type = "button";
    button.textContent = symbol;
    button.setAttribute("aria-label", `Scroll ${label.toLowerCase()} ${direction}`);
    button.title = `Scroll ${direction}`;
  }
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "0";
  slider.step = "1";
  slider.value = "0";
  slider.setAttribute("aria-label", `Scroll ${label.toLowerCase()} horizontally`);
  bar.append(back, slider, forward);
  viewport.after(bar);
  viewport.dataset.customScrollbar = "";

  function sync() {
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const position = Math.max(0, Math.min(maximum, viewport.scrollLeft));
    slider.max = String(maximum);
    slider.value = String(position);
    slider.disabled = maximum === 0;
    back.disabled = position <= 1;
    forward.disabled = position >= maximum - 1;
    const thumb = Math.min(slider.clientWidth, Math.max(28,
      slider.clientWidth * viewport.clientWidth / Math.max(1, viewport.scrollWidth)));
    slider.style.setProperty("--scroll-thumb-width", `${thumb}px`);
    slider.setAttribute("aria-valuetext", maximum === 0 ? "All dates visible"
      : position <= 1 ? "Start of dates" : position >= maximum - 1 ? "End of dates"
        : `${Math.round(position / maximum * 100)}% through dates`);
  }
  function moveTo(position) {
    viewport.scrollLeft = position;
    sync();
  }
  slider.addEventListener("input", () => moveTo(Number(slider.value)));
  slider.addEventListener("keydown", (event) => {
    const page = Math.max(40, viewport.clientWidth * .8);
    const target = { ArrowLeft: viewport.scrollLeft - 40, ArrowRight: viewport.scrollLeft + 40,
      ArrowUp: viewport.scrollLeft + 40, ArrowDown: viewport.scrollLeft - 40,
      PageUp: viewport.scrollLeft - page, PageDown: viewport.scrollLeft + page,
      Home: 0, End: Number(slider.max) }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveTo(target);
  });
  back.addEventListener("click", () => moveTo(viewport.scrollLeft - Math.max(40, viewport.clientWidth * .8)));
  forward.addEventListener("click", () => moveTo(viewport.scrollLeft + Math.max(40, viewport.clientWidth * .8)));
  viewport.addEventListener("scroll", sync, { passive: true });
  const observer = new ResizeObserver(sync);
  observer.observe(viewport);
  observer.observe(slider);
  if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
  sync();
}
