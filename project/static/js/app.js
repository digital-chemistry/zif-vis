import { $, updateViewControls } from "./dom.js";
import { displayPhase, formatValShort, normalisePhase } from "./formatters.js";
import { PHASE_COLORS, HIDDEN_USER_PHASE_KEYS } from "./constants.js";
import { readFiltersFromState, filterPoints } from "./filters.js";
import { renderPlot3D } from "./plot3d.js";
import { renderPlot2D } from "./plot2d.js";
import { loadInspector } from "./inspector.js";

let allPoints = [];
const datasetPointsCache = new Map();
let predictedGridCache = new Map();
let predictionRequestToken = 0;
let renderRequestToken = 0;
const ZIF_BASE_PATH = String(window.ZIF_BASE_PATH || "");
const LAYER_SELECTION_STORAGE_KEY = "zifExplorer.visibleLayers";
let scheduledRenderHandle = null;
const viewerState = {
  selectedLayers: [],
  camera3D: null
};

function apiUrl(path) {
  return `${ZIF_BASE_PATH}${path}`;
}

function isCurrentMode3D() {
  return (
    document.querySelector('input[name="viewMode"]:checked')?.value || "3d"
  ) === "3d";
}

function restyleCurrent3DMarkers() {
  const plotDiv = $("plot");
  if (!plotDiv || !isCurrentMode3D() || !plotDiv.data?.length) return false;
  const liveCamera = plotDiv?._fullLayout?.scene?.camera
    ? JSON.parse(JSON.stringify(plotDiv._fullLayout.scene.camera))
    : null;

  const pointIndices = plotDiv.__zif3DPointTraceIndices;
  const pointUpdatesFactory = plotDiv.__zif3DPointMarkerUpdates;
  if (!Array.isArray(pointIndices) || typeof pointUpdatesFactory !== "function") {
    return false;
  }

  const pendingUpdates = [];
  const pointUpdates = pointUpdatesFactory();
  pointIndices.forEach((traceIndex, idx) => {
    const update = pointUpdates[idx];
    if (update) {
      pendingUpdates.push(Plotly.restyle(plotDiv, update, [traceIndex]));
    }
  });

  const searchIndices = plotDiv.__zif3DSearchTraceIndices;
  const searchUpdatesFactory = plotDiv.__zif3DSearchMarkerUpdates;
  if (Array.isArray(searchIndices) && typeof searchUpdatesFactory === "function") {
    const searchUpdates = searchUpdatesFactory();
    searchIndices.forEach((traceIndex, idx) => {
      const update = searchUpdates[idx];
      if (update) {
        pendingUpdates.push(Plotly.restyle(plotDiv, update, [traceIndex]));
      }
    });
  }

  if (liveCamera) {
    Promise.allSettled(pendingUpdates).then(() => {
      Plotly.relayout(plotDiv, { "scene.camera": liveCamera }).catch?.(() => {});
    });
  }

  return true;
}

function readSavedLayerSelection() {
  try {
    const raw = window.localStorage.getItem(LAYER_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  } catch (_err) {
    return null;
  }
}

function saveLayerSelection() {
  try {
    const selected = Array.isArray(viewerState.selectedLayers)
      ? viewerState.selectedLayers
      : [];
    window.localStorage.setItem(
      LAYER_SELECTION_STORAGE_KEY,
      JSON.stringify(selected)
    );
  } catch (_err) {
    // Ignore storage failures and keep the UI working.
  }
}

function setLayerSelectionState(values) {
  viewerState.selectedLayers = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function readLayerSelectionFromDom() {
  return [...document.querySelectorAll(".layer-check")]
    .filter((el) => el.checked)
    .map((el) => Number(el.value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function syncLayerSelectionFromDom() {
  setLayerSelectionState(readLayerSelectionFromDom());
  saveLayerSelection();
}

function applyLayerVisibility(points, filters) {
  if (filters.mode !== "3d") return points;
  if (filters.selectedLayersExplicitlyEmpty) return [];
  if (!filters.selectedLayers.length) return points;

  const sortedSelectedLayers = [...filters.selectedLayers].sort((a, b) => a - b);

  function allowIntermediateLayer(pointConc) {
    for (let i = 0; i < sortedSelectedLayers.length - 1; i++) {
      const lower = sortedSelectedLayers[i];
      const upper = sortedSelectedLayers[i + 1];
      if (pointConc > lower && pointConc < upper) {
        return true;
      }
    }
    return false;
  }

  return points.filter((point) => {
    const conc = Number(point.concentration);
    if (point.is_intermediate_layer) {
      return allowIntermediateLayer(conc);
    }
    return sortedSelectedLayers.includes(conc);
  });
}

function scheduleRender() {
  if (scheduledRenderHandle != null) {
    window.cancelAnimationFrame(scheduledRenderHandle);
  }
  scheduledRenderHandle = window.requestAnimationFrame(() => {
    scheduledRenderHandle = null;
    applyFiltersAndRender();
  });
}

function resetTransientControlsToDefaults() {
  const viewMode = document.querySelector('input[name="viewMode"][value="3d"]');
  if (viewMode) viewMode.checked = true;

  const dataLayer = document.querySelector('input[name="dataLayer"][value="experimental"]');
  if (dataLayer) dataLayer.checked = true;

  const washing = document.querySelector('input[name="washing"][value="ethanol"]');
  if (washing) washing.checked = true;

  const colourBy = $("colourBy");
  if (colourBy) colourBy.value = "phase";

  const layerFocus = $("layerFocus");
  if (layerFocus) layerFocus.value = "";

  const showInterlayerGuides = $("showInterlayerGuides");
  if (showInterlayerGuides) showInterlayerGuides.checked = false;

  const crystBalance = $("crystBalance");
  if (crystBalance) crystBalance.value = 0;

  const proteinThreshold = $("proteinThreshold");
  if (proteinThreshold) proteinThreshold.value = 0;

  const eeThreshold = $("eeThreshold");
  if (eeThreshold) eeThreshold.value = eeThreshold.min || -0.2;

  const spacingScale = $("spacingScale");
  if (spacingScale) spacingScale.value = 0.2;

  const markerScale3D = $("markerScale3D");
  if (markerScale3D) markerScale3D.value = 1.8;

  const amorphousOpacity = $("amorphousOpacity");
  if (amorphousOpacity) amorphousOpacity.value = 0.7;
}

async function fetchDatasetPoints(dataset) {
  const key = String(dataset || "primary");
  if (datasetPointsCache.has(key)) {
    return datasetPointsCache.get(key);
  }

  const res = await fetch(apiUrl(`/api/points?dataset=${encodeURIComponent(key)}`));
  if (!res.ok) {
    throw new Error(`Failed to load ${apiUrl(`/api/points?dataset=${encodeURIComponent(key)}`)} (${res.status})`);
  }

  const payload = await res.json();
  datasetPointsCache.set(key, payload);
  return payload;
}

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  if (window.__zifExplorerLoaded) return;
  window.__zifExplorerLoaded = true;

  resetTransientControlsToDefaults();
  wireControls();
  await loadPoints();
}

function currentExperimentalDatasetKey() {
  const dataLayer =
    document.querySelector('input[name="dataLayer"]:checked')?.value || "experimental";
  return dataLayer === "experimental_xue" ? "manual" : "primary";
}

async function syncControlsToActiveExperimentalDataset() {
  const points = await fetchDatasetPoints(currentExperimentalDatasetKey());
  buildLayerOptions(points);
  buildPhaseFilters(points);
  initSliderRanges(points);
  resetAdvancedPhaseFilters();
}

function wireControls() {
  $("openCompositionPanel")?.addEventListener("click", () => {
    $("compositionPanel")?.classList.remove("is-hidden");
    $("posMetal")?.focus();
  });

  $("closeCompositionPanel")?.addEventListener("click", () => {
    $("compositionPanel")?.classList.add("is-hidden");
  });

  [
    "layerFocus",
    "spacingScale",
    "showInterlayerGuides",
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
      scheduleRender();
    });
  });

  ["markerScale3D", "amorphousOpacity"].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      updateDerivedReadouts();
      updateViewControls();
      toggleModeDependentCards();
      if (!restyleCurrent3DMarkers()) {
        scheduleRender();
      }
    });
  });

  ["posMetal", "posLigand", "posBsa"].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      clearAutoFlags();
      validatePositionInputs();
      updatePositionNote();
      updateCompositionPrediction();
      scheduleRender();
    });

    el.addEventListener("change", () => {
      clearAutoFlags();
      autoFillPosition();
      updateDerivedReadouts();
      updateCompositionPrediction();
      scheduleRender();
    });
  });

  $("posConcentration")?.addEventListener("input", () => {
    updatePositionNote();
    updateCompositionPrediction();
  });

  $("posConcentration")?.addEventListener("change", () => {
    updateDerivedReadouts();
    updateCompositionPrediction();
  });

  $("posWash")?.addEventListener("change", () => {
    updateCompositionPrediction();
  });

  $("clearCompositionBtn")?.addEventListener("click", () => {
    ["posMetal", "posLigand", "posBsa", "posConcentration"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const posWash = $("posWash");
    if (posWash) {
      posWash.value =
        document.querySelector('input[name="washing"]:checked')?.value || "ethanol";
    }

    clearAutoFlags();
    validatePositionInputs();
    updatePositionNote();
    clearCompositionPrediction();
    scheduleRender();
  });

  document.querySelectorAll('input[name="viewMode"]').forEach((el) => {
    el.addEventListener("change", () => {
      updateViewControls();
      toggleModeDependentCards();
      scheduleRender();
    });
  });

  document.querySelectorAll('input[name="dataLayer"]').forEach((el) => {
    el.addEventListener("change", async () => {
      updateViewControls();
      toggleModeDependentCards();
      if (el.value === "experimental" || el.value === "experimental_xue") {
        await syncControlsToActiveExperimentalDataset();
      }
      scheduleRender();
    });
  });

  document.querySelectorAll('input[name="washing"]').forEach((el) => {
    el.addEventListener("change", () => {
      updateDerivedReadouts();
      updateViewControls();
      toggleModeDependentCards();
      if ($("posWash") && !readPositionNumber("posConcentration")) {
        $("posWash").value = el.value;
        updateCompositionPrediction();
      }
      scheduleRender();
    });
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      $("compositionPanel")?.classList.add("is-hidden");
    }
  });
}

async function loadPoints() {
  try {
    allPoints = await fetchDatasetPoints("primary");

    await syncControlsToActiveExperimentalDataset();

    updateDerivedReadouts();
    const posWash = $("posWash");
    if (posWash) {
      posWash.value =
        document.querySelector('input[name="washing"]:checked')?.value || "ethanol";
    }
    updateViewControls();
    toggleModeDependentCards();
    updateCompositionPrediction();
    applyFiltersAndRender();
  } catch (err) {
    console.error("loadPoints failed:", err);

    const plotDiv = $("plot");
    if (plotDiv) {
      showPlotEmptyState(`<div style="padding:24px;color:#a33;">Failed to load point data.</div>`);
    }
  }
}

async function getPredictedGridPoints(wash, includeIntermediateLayers = false) {
  const key = `primary::${String(wash || "ethanol")}::${includeIntermediateLayers ? "mid" : "base"}`;
  if (predictedGridCache.has(key)) {
    return predictedGridCache.get(key);
  }

  const washValue = String(wash || "ethanol");
  const res = await fetch(
    apiUrl(
      `/api/prediction-grid?wash=${encodeURIComponent(washValue)}&intermediate=${includeIntermediateLayers ? "1" : "0"}&dataset=primary`
    )
  );
  if (!res.ok) {
    throw new Error(`Failed to load ${apiUrl("/api/prediction-grid")} (${res.status})`);
  }

  const payload = await res.json();
  predictedGridCache.set(key, payload);
  return payload;
}

async function getDisplayPoints(filters) {
  if (filters.dataLayer === "experimental") {
    return fetchDatasetPoints("primary");
  }
  if (filters.dataLayer === "experimental_xue") {
    return fetchDatasetPoints("manual");
  }

  const includeIntermediateLayers =
    filters.mode === "3d" &&
    filters.dataLayer !== "experimental" &&
    Boolean($("showInterlayerGuides")?.checked);

  const predicted = await getPredictedGridPoints(filters.washing, includeIntermediateLayers);
  if (filters.dataLayer === "predicted") {
    return predicted;
  }

  return [...allPoints, ...predicted];
}

function initSliderRanges(sourcePoints = allPoints) {
  const proteins = sourcePoints
    .map((p) => Number(p.protein_ratio))
    .filter(Number.isFinite);

  const ees = sourcePoints
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

function buildLayerOptions(sourcePoints = allPoints) {
  const layers = [
    ...new Set(
      sourcePoints.map((p) => Number(p.concentration)).filter(Number.isFinite)
    )
  ].sort((a, b) => a - b);
  const savedSelection = readSavedLayerSelection();
  const availableSet = new Set(layers);
  const initialSelection =
    savedSelection == null
      ? [...layers]
      : savedSelection.filter((value) => availableSet.has(Number(value)));

  setLayerSelectionState(initialSelection);
  const selectedSet = new Set(viewerState.selectedLayers);

  const wrap = $("layerCheckboxes");
  const focus = $("layerFocus");

  if (wrap) {
    wrap.innerHTML = layers
      .map(
        (v) => `
      <label class="simple-check">
        <input type="checkbox" class="layer-check" value="${v}" ${selectedSet == null || selectedSet.has(Number(v)) ? "checked" : ""}>
        <span>${formatValShort(v, 1)} mg mL^-1</span>
      </label>
    `
      )
      .join("");

    wrap.querySelectorAll(".layer-check").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        syncLayerSelectionFromDom();
        scheduleRender();
      });
    });
  }

  if (focus) {
    focus.innerHTML =
      `<option value="">Auto</option>` +
      layers
        .map((v) => `<option value="${v}">${formatValShort(v, 1)} mg mL^-1</option>`)
        .join("");
  }

  saveLayerSelection();
}

function buildPhaseFilters(sourcePoints = allPoints) {
  const wrap = $("phaseFilters");
  if (!wrap) return;

  const phaseNames = [
    ...new Set(sourcePoints.flatMap((p) => Object.keys(p.phase_composition || {})))
  ]
    .filter((phase) => !HIDDEN_USER_PHASE_KEYS.includes(normalisePhase(phase)))
    .sort();

  wrap.innerHTML = phaseNames
    .map(
      (phase) => {
        const phaseKey = normalisePhase(phase);
        const phaseColor = PHASE_COLORS[phaseKey] || PHASE_COLORS.unknown || "#8B8B8B";
        const phaseLabel = displayPhase(phase);

        return `
      <div class="phase-filter-row" style="--phase-accent:${phaseColor};">
        <label class="simple-check phase-filter-check">
          <input type="checkbox" class="phase-check" data-phase="${phase}" style="accent-color:${phaseColor};">
          <span class="phase-filter-name">${phaseLabel}</span>
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
            style="accent-color:${phaseColor};"
          >
          <div class="phase-slider-readout" id="phaseReadout_${cssSafe(phase)}">>= 0%</div>
        </div>
      </div>
    `;
      }
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
      scheduleRender();
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
      scheduleRender();
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
      out.textContent = `>= ${slider.value}%`;
    }
  });
}

function resetAdvancedPhaseFilters() {
  document.querySelectorAll(".phase-check").forEach((check) => {
    check.checked = false;
  });

  document.querySelectorAll(".phase-slider").forEach((slider) => {
    slider.value = 0;
  });

  updatePhaseReadouts();
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

function clearCompositionPrediction() {
  const card = $("compositionPrediction");
  if (!card) return;
  card.classList.add("is-hidden");
  card.innerHTML = "";
}

function renderCompositionPrediction(payload) {
  const card = $("compositionPrediction");
  if (!card) return;

  const topPhase = payload?.predictions?.top_phase || "N/A";
  const confidence = payload?.predictions?.phase_probabilities?.[topPhase] ?? null;
  const trust = payload?.trust || {};
  const preds = payload?.predictions || {};
  const neighbors = Array.isArray(payload?.neighbors) ? payload.neighbors.slice(0, 3) : [];

  const neighborHtml = neighbors.length
    ? neighbors
        .map(
          (neighbor) => `
          <div class="prediction-neighbor">
            <strong>${neighbor.point_id}</strong> | ${neighbor.phase} | d=${formatValShort(neighbor.distance, 3)}
          </div>
        `
        )
        .join("")
    : `<div class="prediction-neighbor">No nearby measured samples found.</div>`;

  card.innerHTML = `
    <div class="prediction-eyebrow">Prototype prediction</div>
    <div class="prediction-title">${topPhase}${confidence == null ? "" : ` | ${formatValShort(confidence * 100, 1)}%`}</div>
    <div class="prediction-copy">${payload?.method || "Prediction from nearby measured points."}</div>
    <div class="prediction-grid">
      <div class="prediction-item">
        <div class="prediction-label">Predicted EE</div>
        <div class="prediction-value">${formatValShort(preds.encapsulation_efficiency_mean, 1)}</div>
      </div>
      <div class="prediction-item">
        <div class="prediction-label">EE std</div>
        <div class="prediction-value">${formatValShort(preds.encapsulation_efficiency_std, 2)}</div>
      </div>
      <div class="prediction-item">
        <div class="prediction-label">Crystalline fraction</div>
        <div class="prediction-value">${formatValShort((preds.crystalline_fraction_mean ?? NaN) * 100, 1)}%</div>
      </div>
      <div class="prediction-item">
        <div class="prediction-label">Crystallinity std</div>
        <div class="prediction-value">${formatValShort((preds.crystalline_fraction_std ?? NaN) * 100, 1)}%</div>
      </div>
      <div class="prediction-item">
        <div class="prediction-label">ATR ratio</div>
        <div class="prediction-value">${formatValShort(preds.atr_ratio_mean, 3)}</div>
      </div>
      <div class="prediction-item">
        <div class="prediction-label">Trust</div>
        <div class="prediction-value">${trust.confidence_band || "N/A"}</div>
      </div>
    </div>
    <div class="prediction-copy">Nearest measured points</div>
    <div class="prediction-neighbors">${neighborHtml}</div>
  `;
  card.classList.remove("is-hidden");
}

async function updateCompositionPrediction() {
  const metal = readPositionNumber("posMetal");
  const ligand = readPositionNumber("posLigand");
  const bsa = readPositionNumber("posBsa");
  const concentration = readPositionNumber("posConcentration");
  const wash = $("posWash")?.value || "ethanol";
  const { hasRangeError, hasSumError } = validatePositionInputs();

  if (
    hasRangeError ||
    hasSumError ||
    [metal, ligand, bsa, concentration].some((value) => value === null)
  ) {
    clearCompositionPrediction();
    return;
  }

  const card = $("compositionPrediction");
  if (card) {
    $("compositionPanel")?.classList.remove("is-hidden");
    card.classList.remove("is-hidden");
    card.innerHTML = `<div class="prediction-copy">Calculating prototype prediction...</div>`;
  }

  const token = ++predictionRequestToken;

  try {
    const res = await fetch(apiUrl("/api/predict?dataset=primary"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metal_pct: metal,
        ligand_pct: ligand,
        bsa_pct: bsa,
        concentration,
        wash
      })
    });

    if (!res.ok) {
      let message = `Prediction request failed (${res.status})`;
      try {
        const payload = await res.json();
        if (payload?.error) message = payload.error;
      } catch (_err) {
        // Keep the default message when no JSON body is available.
      }
      throw new Error(message);
    }

    const payload = await res.json();
    if (token !== predictionRequestToken) return;
    renderCompositionPrediction(payload);
  } catch (err) {
    if (token !== predictionRequestToken) return;
    console.error("updateCompositionPrediction failed:", err);
    if (card) {
      card.classList.remove("is-hidden");
      card.innerHTML = `<div class="prediction-copy">${err?.message || "Prediction preview unavailable."}</div>`;
    }
  }
}

function updateDerivedReadouts() {
  const cryst = Number($("crystBalance")?.value ?? 0);
  const protein = Number($("proteinThreshold")?.value ?? 0);
  const ee = Number($("eeThreshold")?.value ?? 0);
  const spacing = Number($("spacingScale")?.value ?? 0.2);
  const markerScale = Number($("markerScale3D")?.value ?? 1.8);
  const amorphousOpacity = Number($("amorphousOpacity")?.value ?? 0.7);

  const crystOut = $("crystBalanceVal");
  const proteinOut = $("proteinThresholdVal");
  const eeOut = $("eeThresholdVal");
  const spacingOut = $("spacingScaleVal");
  const markerScaleOut = $("markerScale3DVal");
  const amorphousOpacityOut = $("amorphousOpacityVal");

  if (crystOut) {
    crystOut.textContent = cryst === 0 ? "Any" : `>= ${cryst}%`;
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
    markerScaleOut.textContent = `${formatValShort(markerScale, 1)}x`;
  }
  if (amorphousOpacityOut) {
    amorphousOpacityOut.textContent = `${Math.round(amorphousOpacity * 100)}%`;
  }

  updatePositionNote();
}

function toggleModeDependentCards() {
  const mode =
    document.querySelector('input[name="viewMode"]:checked')?.value || "3d";

  const spacingCard = $("spacingCard");
  const markerSizeCard = $("markerSizeCard");
  const amorphousOpacityCard = $("amorphousOpacityCard");
  const interlayerGuideCard = $("interlayerGuideCard");
  const colourBy = $("colourBy")?.value || "phase";

  if (spacingCard) {
    spacingCard.style.display = mode === "3d" ? "flex" : "none";
  }
  if (markerSizeCard) {
    markerSizeCard.style.display = mode === "3d" ? "flex" : "none";
  }
  if (amorphousOpacityCard) {
    amorphousOpacityCard.style.display = colourBy === "phase" ? "flex" : "none";
  }
  if (interlayerGuideCard) {
    interlayerGuideCard.style.display = mode === "3d" ? "flex" : "none";
  }
}

function formatRenderDebugFilters(filters) {
  const layers =
    filters.mode === "3d"
      ? filters.selectedLayersExplicitlyEmpty
        ? "none selected"
        : filters.selectedLayers.length
          ? filters.selectedLayers.map((value) => formatValShort(value, 1)).join(", ")
          : "all layers"
      : "2D view";

  const phaseFilters = Object.entries(filters.phaseThresholds || {});
  const phaseSummary = phaseFilters.length
    ? phaseFilters
        .map(([phase, threshold]) => `${phase} >= ${Math.round(Number(threshold || 0) * 100)}%`)
        .join(", ")
    : "none";

  return {
    mode: filters.mode === "3d" ? "3D stacked" : "2D ternary",
    dataLayer: filters.dataLayer,
    wash: filters.washing,
    colourBy: filters.colourBy,
    layers,
    crystallinity: filters.crystBalance > 0 ? `>= ${Math.round(filters.crystBalance * 100)}%` : "Any",
    atrRatio: formatValShort(filters.proteinThreshold, 3),
    ee: formatValShort(filters.eeThreshold, 2),
    phaseSummary
  };
}

function renderNoPointsMarkup(diagnostics) {
  return `
    <div style="padding:24px;color:#555;">
      <div style="font-size:16px;color:#666;">No points match the current filters.</div>
      <div style="margin-top:8px;font-size:13px;color:#7a8393;">Adjust the visible layers or relax one of the filters to see samples again.</div>
    </div>
  `;
}

function renderNoPointsMarkupWithDiagnostics(diagnostics) {
  const debug = diagnostics?.filters || {};
  return `
    <div style="padding:24px;color:#555;display:flex;flex-direction:column;gap:12px;">
      <div style="font-size:16px;color:#666;">No points match the current filters.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;font-size:13px;color:#596273;">
        <div>
          <div><strong>Source points:</strong> ${diagnostics?.sourceCount ?? 0}</div>
          <div><strong>After wash/value filters:</strong> ${diagnostics?.propertyCount ?? 0}</div>
          <div><strong>After layer visibility:</strong> ${diagnostics?.visibleCount ?? 0}</div>
        </div>
        <div>
          <div><strong>Mode:</strong> ${debug.mode || "N/A"}</div>
          <div><strong>Data layer:</strong> ${debug.dataLayer || "N/A"}</div>
          <div><strong>Wash:</strong> ${debug.wash || "N/A"}</div>
          <div><strong>Layers:</strong> ${debug.layers || "N/A"}</div>
        </div>
        <div>
          <div><strong>Color by:</strong> ${debug.colourBy || "N/A"}</div>
          <div><strong>Min crystallinity:</strong> ${debug.crystallinity || "N/A"}</div>
          <div><strong>Estimated ratio min:</strong> ${debug.atrRatio || "N/A"}</div>
          <div><strong>Min EE:</strong> ${debug.ee || "N/A"}</div>
          <div><strong>Phase filters:</strong> ${debug.phaseSummary || "none"}</div>
        </div>
      </div>
    </div>
  `;
}

function clearPlotContainer(plotDiv) {
  if (!plotDiv) return;
  Plotly.purge?.(plotDiv);
  plotDiv.replaceChildren();
  plotDiv.textContent = "";
}

function showPlotEmptyState(markup) {
  const plotDiv = $("plot");
  const emptyState = $("plotEmptyState");
  if (plotDiv) {
    clearPlotContainer(plotDiv);
    plotDiv.style.display = "none";
  }
  if (emptyState) {
    emptyState.innerHTML = markup;
    emptyState.classList.remove("is-hidden");
  }
}

function hidePlotEmptyState() {
  const plotDiv = $("plot");
  const emptyState = $("plotEmptyState");
  if (plotDiv) {
    plotDiv.style.display = "";
  }
  if (emptyState) {
    emptyState.innerHTML = "";
    emptyState.classList.add("is-hidden");
  }
}

async function applyFiltersAndRender() {
  if (document.querySelectorAll(".layer-check").length) {
    syncLayerSelectionFromDom();
  }
  const filters = readFiltersFromState(viewerState);
  const plotDiv = $("plot");
  const token = ++renderRequestToken;

  try {
    const displayPoints = await getDisplayPoints(filters);
    if (token !== renderRequestToken) return;
    const propertyFiltered = filterPoints(displayPoints, filters);
    const filtered = applyLayerVisibility(propertyFiltered, filters);
    if (token !== renderRequestToken) return;

    const diagnostics = {
      sourceCount: displayPoints.length,
      propertyCount: propertyFiltered.length,
      visibleCount: filtered.length,
      filters: formatRenderDebugFilters(filters)
    };
    window.__zifLastRenderDiagnostics = diagnostics;

    if (!filtered.length) {
      showPlotEmptyState(renderNoPointsMarkup(diagnostics));
      return;
    }

    hidePlotEmptyState();

    if (filters.mode === "2d") {
      renderPlot2D(filtered, filters.colourBy, handlePointClick, filters.searchPosition);
    } else {
        renderPlot3D(
          filtered,
          filters.colourBy,
          viewerState.camera3D,
          (camera) => {
            viewerState.camera3D = camera;
          },
          handlePointClick,
          filters.searchPosition
      );
    }
  } catch (err) {
    if (token !== renderRequestToken) return;
    console.error("applyFiltersAndRender failed:", err);
    showPlotEmptyState(`<div style="padding:24px;color:#a33;">Failed to load the selected data layer.</div>`);
  }
}

async function handlePointClick(sampleId) {
  if (!sampleId || String(sampleId).startsWith("pred_")) return;
  const dataset =
    document.querySelector('input[name="dataLayer"]:checked')?.value === "experimental_xue"
      ? "manual"
      : "primary";
  await loadInspector(sampleId, dataset);
}

