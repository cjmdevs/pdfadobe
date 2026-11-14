// Spotlight (B8): the command search shows where a tool, button or menu item is instead
// of running it. The element scrolls into view and pulses for a few seconds.

/** Finds the element (it may appear a moment later, e.g. a tool toolbar opening). */
export function spotlight(find: () => Element | null | undefined, wait = 1500): void {
  const start = performance.now();
  const tick = () => {
    const el = find();
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.classList.remove("spotlight");
      void el.offsetWidth; // restart the animation
      el.classList.add("spotlight");
      el.focus({ preventScroll: true });
      window.setTimeout(() => el.classList.remove("spotlight"), 4000);
      return;
    }
    if (performance.now() - start < wait) requestAnimationFrame(tick);
  };
  tick();
}

/** Opens a menu of the menu bar with one item (in a submenu if need be) highlighted. */
export function showMenuItem(menu: string, id: string): void {
  document.dispatchEvent(new CustomEvent("pdfwb:show-menu-item", { detail: { menu, id } }));
}
