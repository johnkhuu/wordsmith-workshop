/* The method tabs. Without JavaScript every method shows, one after another. */
(function () {
  "use strict";
  const root = document.querySelector(".methods");
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
  root.classList.add("is-tabbed");

  function select(i, focus) {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (focus) {
      tabs[i].focus();
      tabs[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i, false));
    t.addEventListener("keydown", (e) => {
      const last = tabs.length - 1;
      let next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = i === last ? 0 : i + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i === 0 ? last : i - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      if (next !== null) { e.preventDefault(); select(next, true); }
    });
  });

  select(Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true")), false);
})();
