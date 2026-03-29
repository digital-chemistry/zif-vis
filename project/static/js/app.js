import { $, updateViewControls } from "./dom.js";
import { formatValShort } from "./formatters.js";
import { readFiltersFromDom, filterPoints } from "./filters.js";
import { renderPlot3D } from "./plot3d.js";
import { renderPlot2D } from "./plot2d.js";
import { loadInspector } from "./inspector.js";

let allPoints = [];
let currentCamera = null;

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  if (window.__zifExplorerLoaded) return;
  window.__zifExplorerLoaded = true;

  wireControls();
  await loadPoints();
}

function wireControls() {
  [
    "layerFocus",
    "spacingScale",
    "markerScale3D", // Added here
    "crystBalance",
    "proteinThreshold",
    "eeThreshold",
    "colourBy",
    "posConcentration"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, () => {
      updateDerivedReadouts();
      updateViewControls();
      toggleModeDependentCards();
      applyFiltersAndRender();
    });
  });

  ["posMetal", "posLigand", "posBsa"].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      clearAutoFlags();
      validatePositionInputs();
      updatePositionNote();
      applyFiltersAndRender();
    });

    el.addEventListener("change", () => {
      clearAutoFlags();
      autoFillPosition();
      updateDerivedReadouts();
      applyFiltersAndRender();
    });
  });

  $("clearCompositionBtn")?.addEventListener("click", () => {
    ["posMetal", "posLigand", "posBsa", "posConcentration"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });

    clearAutoFlags();
    validatePositionInputs();
    updatePositionNote();
    applyFiltersAndRender();
  });

  document.querySelectorAll('input[name="viewMode"]').forEach((el) => {
    el.addEventListener("change", () => {
      updateViewControls();
      toggleModeDependentCards();
      applyFiltersAndRender();
    });
  });

  document.querySelectorAll('input[name="washing"]').forEach((el) => {
    el.addEventListener("change", () => {
      updateDerivedReadouts();
      updateViewControls();
      toggleModeDependentCards();
      applyFiltersAndRender();
    });
  });
}

async function loadPoints() {
  try {
    const res = await fetch("/api/points");
    if (!res.ok) {
      throw new Error(`Failed to load /api/points (${res.status})`);
    }

    allPoints = await res.json();

    buildLayerOptions();
    buildPhaseFilters();
    initSliderRanges();

    updateDerivedReadouts();
    updateViewControls();
    toggleModeDependentCards();
    applyFiltersAndRender();
  } catch (err) {
    console.error("loadPoints failed:", err);

    const plotDiv = $("plot");
    if (plotDiv) {
      plotDiv.innerHTML = `<div style="padding:24px;color:#a33;">Failed to load point data.</div>`;
    }
  }
}

function initSliderRanges() {
  const proteins = allPoints
    .map((p) => Number(p.protein_ratio))
    .filter(Number.isFinite);

  const ees = allPoints
    .map((p) => Number(p.encapsulation_efficiency ?? p.ee))
    .filter(Number.isFinite);

  const proteinMin = proteins.length ? Math.min(...proteins) : 0;
  const proteinMax = proteins.length ? Math.max(...proteins) : 1;

  const eeMin = ees.length ? Math.min(...ees) : 0;
  const eeMax = ees.length ? Math.max(...ees) : 100;

  const proteinSlider = $("proteinThreshold");
  const eeSlider = $("eeThreshold");

  if (proteinSlider) {
    proteinSlider.min = proteinMin;
    proteinSlider.max = proteinMax;
    proteinSlider.step = Math.max((proteinMax - proteinMin) / 500, 0.001);
    proteinSlider.value = proteinMin;
  }

  if (eeSlider) {
    eeSlider.min = eeMin;
    eeSlider.max = eeMax;
    eeSlider.step = Math.max((eeMax - eeMin) / 500, 0.1);
    eeSlider.value = eeMin;
  }
}

function buildLayerOptions() {
  const layers = [
    ...new Set(
      allPoints.map((p) => Number(p.concentration)).filter(Number.isFinite)
    )
  ].sort((a, b) => a - b);

  const wrap = $("layerCheckboxes");
  const focus = $("layerFocus");

  if (wrap) {
    wrap.innerHTML = layers
      .map(
        (v) => `
      <label class="simple-check">
        <input type="checkbox" class="layer-check" value="${v}" checked>
        <span>${formatValShort(v, 1)} mg mL⁻¹</span>
      </label>
    `
      )
      .join("");

    wrap.querySelectorAll(".layer-check").forEach((el) => {
      el.addEventListener("change", applyFiltersAndRender);
    });
  }

  if (focus) {
    focus.innerHTML =
      `<option value="">Auto</option>` +
      layers
        .map((v) => `<option value="${v}">${formatValShort(v, 1)} mg mL⁻¹</option>`)
        .join("");
  }
}

function buildPhaseFilters() {
  const wrap = $("phaseFilters");
  if (!wrap) return;

  const phaseNames = [
    ...new Set(allPoints.flatMap((p) => Object.keys(p.phase_composition || {})))
  ].sort();

  wrap.innerHTML = phaseNames
    .map(
      (phase) => `
      <div class="phase-filter-row">
        <label class="simple-check">
          <input type="checkbox" class="phase-check" data-phase="${phase}">
          <span>${phase}</span>
        </label>
        <div class="phase-slider-wrap">
          <input
            type="range"
            class="phase-slider"
            data-phase="${phase}"
            min="0"
            max="100"
            step="1"
            value="0"
          >
          <div class="phase-slider-readout" id="phaseReadout_${cssSafe(phase)}">≥ 0%</div>
        </div>
      </div>
    `
    )
    .join("");

  wrap.querySelectorAll(".phase-check").forEach((el) => {
    el.addEventListener("change", () => {
      const phase = el.dataset.phase;
      const slider = wrap.querySelector(`.phase-slider[data-phase="${phase}"]`);
      if (slider && !el.checked) {
        slider.value = 0;
      }
      updatePhaseReadouts();
      applyFiltersAndRender();
    });
  });

  wrap.querySelectorAll(".phase-slider").forEach((el) => {
    el.addEventListener("input", () => {
      const phase = el.dataset.phase;
      const check = wrap.querySelector(`.phase-check[data-phase="${phase}"]`);
      if (check && Number(el.value) > 0) {
        check.checked = true;
      }
      updatePhaseReadouts();
      applyFiltersAndRender();
    });
  });

  updatePhaseReadouts();
}

function cssSafe(text) {
  return String(text).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function updatePhaseReadouts() {
  document.querySelectorAll(".phase-slider").forEach((slider) => {
    const phase = slider.dataset.phase;
    const out = $(`phaseReadout_${cssSafe(phase)}`);
    if (out) {
      out.textContent = `≥ ${slider.value}%`;
    }
  });
}

function readPositionNumber(id) {
  const raw = ($(id)?.value ?? "").trim();
  if (raw === "") return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  return n;
}

function setPositionFieldError(id, hasError) {
  const el = $(id);
  if (!el) return;

  el.style.borderColor = hasError ? "#c84b31" : "";
  el.style.background = hasError ? "#fff4f1" : "";
}

function clearAutoFlags() {
  ["posMetal", "posLigand", "posBsa"].forEach((id) => {
    $(id)?.classList.remove("is-auto");
  });
}

function markAutoField(id) {
  $(id)?.classList.add("is-auto");
}

function validatePositionInputs() {
  const ids = ["posMetal", "posLigand", "posBsa"];
  const values = ids.map((id) => readPositionNumber(id));

  ids.forEach((id) => setPositionFieldError(id, false));

  let hasRangeError = false;
  values.forEach((v, i) => {
    if (v !== null && (v < 0 || v > 100)) {
      setPositionFieldError(ids[i], true);
      hasRangeError = true;
    }
  });

  const filled = values.filter((v) => v !== null);

  let hasSumError = false;
  if (filled.length === 3) {
    const sum = values[0] + values[1] + values[2];
    if (Math.abs(sum - 100) > 0.25) {
      ids.forEach((id) => setPositionFieldError(id, true));
      hasSumError = true;
    }
  }

  return {
    values,
    hasRangeError,
    hasSumError,
    isValid: !hasRangeError && !hasSumError
  };
}

function autoFillPosition() {
  const ids = ["posMetal", "posLigand", "posBsa"];
  const values = ids.map((id) => readPositionNumber(id));

  const filledIdx = values
    .map((v, i) => (v === null ? null : i))
    .filter((i) => i !== null);

  if (filledIdx.length !== 2) {
    validatePositionInputs();
    updatePositionNote();
    return;
  }

  const missingIdx = values.findIndex((v) => v === null);
  if (missingIdx === -1) {
    validatePositionInputs();
    updatePositionNote();
    return;
  }

  const otherIdx = [0, 1, 2].filter((i) => i !== missingIdx);
  const a = values[otherIdx[0]];
  const b = values[otherIdx[1]];

  if (a === null || b === null) {
    validatePositionInputs();
    updatePositionNote();
    return;
  }

  const missingValue = 100 - a - b;

  if (missingValue < 0 || missingValue > 100) {
    validatePositionInputs();
    updatePositionNote();
    return;
  }

  const targetId = ids[missingIdx];
  const target = $(targetId);
  if (!target) {
    validatePositionInputs();
    updatePositionNote();
    return;
  }

  target.value = formatValShort(missingValue, 1);
  markAutoField(targetId);

  validatePositionInputs();
  updatePositionNote();
}

function updatePositionNote() {
  const note = $("positionNote");
  if (!note) return;

  const m = readPositionNumber("posMetal");
  const l = readPositionNumber("posLigand");
  const b = readPositionNumber("posBsa");
  const c = readPositionNumber("posConcentration");

  const { hasRangeError, hasSumError } = validatePositionInputs();

  if (hasRangeError) {
    note.textContent = "Values must stay between 0 and 100.";
    note.style.color = "#c84b31";
    return;
  }

  if ([m, l, b].every((v) => v !== null) && hasSumError) {
    note.textContent = "Metal + Ligand + BSA must equal 100.";
    note.style.color = "#c84b31";
    return;
  }

  if ([m, l, b, c].every((v) => v !== null) && Math.abs(m + l + b - 100) <= 0.25) {
    note.textContent = `Marker active at M ${formatValShort(m, 1)} / L ${formatValShort(l, 1)} / BSA ${formatValShort(b, 1)} on layer ${formatValShort(c, 1)}.`;
    note.style.color = "";
    return;
  }

  note.textContent =
    "Enter any two of Metal, Ligand, and BSA. The third will be filled automatically.";
  note.style.color = "";
}

function updateDerivedReadouts() {
  const cryst = Number($("crystBalance")?.value ?? 0);
  const protein = Number($("proteinThreshold")?.value ?? 0);
  const ee = Number($("eeThreshold")?.value ?? 0);
  const spacing = Number($("spacingScale")?.value ?? 0.2);
  const markerScale = Number($("markerScale3D")?.value ?? 1.8);

  const crystOut = $("crystBalanceVal");
  const proteinOut = $("proteinThresholdVal");
  const eeOut = $("eeThresholdVal");
  const spacingOut = $("spacingScaleVal");
  const markerScaleOut = $("markerScale3DVal");

  if (crystOut) {
    crystOut.textContent = cryst === 0 ? "Any" : `≥ ${cryst}%`;
  }
  if (proteinOut) {
    proteinOut.textContent = formatValShort(protein, 3);
  }
  if (eeOut) {
    eeOut.textContent = formatValShort(ee, 1);
  }
  if (spacingOut) {
    spacingOut.textContent = formatValShort(spacing, 2);
  }
  if (markerScaleOut) {
    markerScaleOut.textContent = `${formatValShort(markerScale, 1)}×`;
  }

  updatePositionNote();
}

function toggleModeDependentCards() {
  const mode =
    document.querySelector('input[name="viewMode"]:checked')?.value || "3d";

  const spacingCard = $("spacingCard");
  const markerSizeCard = $("markerSizeCard");

  if (spacingCard) {
    spacingCard.style.display = mode === "3d" ? "flex" : "none";
  }
  if (markerSizeCard) {
    markerSizeCard.style.display = mode === "3d" ? "flex" : "none";
  }
}

function applyFiltersAndRender() {
  const filters = readFiltersFromDom();
  const filtered = filterPoints(allPoints, filters);

  if (filters.mode === "2d") {
    renderPlot2D(filtered, filters.colourBy, handlePointClick, filters.searchPosition);
  } else {
    renderPlot3D(
      filtered,
      filters.colourBy,
      currentCamera,
      (camera) => {
        currentCamera = camera;
      },
      handlePointClick,
      filters.searchPosition
    );
  }
}

async function handlePointClick(sampleId) {
  await loadInspector(sampleId);
}