import { PHASE_COLORS, PHASE_LABELS, OFFICIAL_PHASE_ORDER } from "./constants.js";
import { $ } from "./dom.js";
import { escapeHtml } from "./formatters.js";

export function updatePhaseLegend(colourBy) {
  const el = $("plotPhaseLegend");
  if (!el) return;

  if (colourBy !== "phase") {
    el.classList.add("is-hidden");
    el.innerHTML = "";
    return;
  }

  /* Keep collapsed state across colour-by changes */
  const wasCollapsed = el.classList.contains("is-collapsed");

  const entries = OFFICIAL_PHASE_ORDER
    .filter((key) => PHASE_COLORS[key])
    .map((key) => {
      const color = PHASE_COLORS[key];
      const label = PHASE_LABELS?.[key] || key;
      return `
        <div class="plot-phase-legend-row">
          <span class="plot-phase-legend-swatch" style="background:${color};"></span>
          <span class="plot-phase-legend-label">${escapeHtml(label)}</span>
        </div>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="plot-phase-legend-header">
      <span class="plot-phase-legend-title">Phase</span>
      <button type="button" class="plot-phase-legend-toggle" aria-label="Toggle phase legend">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline class="legend-chevron" points="4,6 8,10 12,6"/>
        </svg>
      </button>
    </div>
    <div class="plot-phase-legend-body">
      ${entries}
    </div>
  `;

  if (wasCollapsed) el.classList.add("is-collapsed");
  el.classList.remove("is-hidden");

  el.querySelector(".plot-phase-legend-toggle").addEventListener("click", () => {
    el.classList.toggle("is-collapsed");
  });
}

export function updateTernaryInset() {
  const el = $("ternaryInset");
  if (!el) return;
  el.style.display = "none";
}
