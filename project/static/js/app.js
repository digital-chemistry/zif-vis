import { $, updateViewControls } from "./dom.js";
import { formatValShort } from "./formatters.js";
import { readFiltersFromDom, filterPoints } from "./filters.js";
import { renderPlot3D } from "./plot3d.js";
import { renderPlot2D } from "./plot2d.js";
import { loadInspector } from "./inspector.js";

let allPoints = [];
let predictedGridCache = new Map();
let currentCamera = null;
let predictionRequestToken = 0;

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  if (window.__zifExplorerLoaded) return;
  window.__zifExplorerLoaded = true;

  wireControls();
  await loadPoints();
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
    "markerScale3D",
    "amorphousOpacity",
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
      updateCompositionPrediction();
      applyFiltersAndRender();
    });

    el.addEventListener("change", () => {
      clearAutoFlags();
      autoFillPosition();
      updateDerivedReadouts();
      updateCompositionPrediction();
      applyFiltersAndRender();
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
    applyFiltersAndRender();
  });

  document.querySelectorAll('input[name="viewMode"]').forEach((el) => {
    el.addEventListener("change", () => {
      updateViewControls();
      toggleModeDependentCards();
      applyFiltersAndRender();
    });
  });

  document.querySelectorAll('input[name="dataLayer"]').forEach((el) => {
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
      if ($("posWash") && !readPositionNumber("posConcentration")) {
        $("posWash").value = el.value;
        updateCompositionPrediction();
      }
      applyFiltersAndRender();
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
    const res = await fetch("/api/points");
    if (!res.ok) {
      throw new Error(`Failed to load /api/points (${res.status})`);
    }

    allPoints = await res.json();

    buildLayerOptions();
    buildPhaseFilters();
    initSliderRanges();

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
      plotDiv.innerHTML = `<div style="padding:24px;color:#a33;">Failed to load point data.</div>`;
    }
  }
}

async function getPredictedGridPoints(wash, includeIntermediateLayers = false) {
  const key = `${String(wash || "ethanol")}::${includeIntermediateLayers ? "mid" : "base"}`;
  if (predictedGridCache.has(key)) {
    return predictedGridCache.get(key);
  }

  const washValue = String(wash || "ethanol");
  const res = await fetch(
    `/api/prediction-grid?wash=${encodeURIComponent(washValue)}&intermediate=${includeIntermediateLayers ? "1" : "0"}`
  );
  if (!res.ok) {
    throw new Error(`Failed to load /api/prediction-grid (${res.status})`);
  }

  const payload = await res.json();
  predictedGridCache.set(key, payload);
  return payload;
}

async function getDisplayPoints(filters) {
  if (filters.dataLayer === "experimental") {
    return allPoints;
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
        <span>${formatValShort(v, 1)} mg mL^-1</span>
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
        .map((v) => `<option value="${v}">${formatValShort(v, 1)} mg mL^-1</option>`)
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
          <div class="phase-slider-readout" id="phaseReadout_${cssSafe(phase)}">>= 0%</div>
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
      out.textContent = `>= ${slider.value}%`;
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
    const res = await fetch("/api/predict", {
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

async function applyFiltersAndRender() {
  const filters = readFiltersFromDom();
  const plotDiv = $("plot");

  try {
    const displayPoints = await getDisplayPoints(filters);
    const filtered = filterPoints(displayPoints, filters);

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
  } catch (err) {
    console.error("applyFiltersAndRender failed:", err);
    if (plotDiv) {
      plotDiv.innerHTML = `<div style="padding:24px;color:#a33;">Failed to load the selected data layer.</div>`;
    }
  }
}

async function handlePointClick(sampleId) {
  if (!sampleId || String(sampleId).startsWith("pred_")) return;
  await loadInspector(sampleId);
}

