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
    <div class="plot-phase-legend-title">Phase</div>
    ${entries}
  `;

  el.classList.remove("is-hidden");
}

export function updateTernaryInset() {
  const el = $("ternaryInset");
  if (!el) return;
  el.style.display = "none";
}
