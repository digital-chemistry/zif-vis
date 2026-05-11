import { $, getThemeTokens, readAllState, updateViewControls } from "./dom.js";
import { displayPhase, formatValShort, normalisePhase } from "./formatters.js";
import { PHASE_COLORS, HIDDEN_USER_PHASE_KEYS } from "./constants.js";
import { readFiltersFromState, filterPoints } from "./filters.js";
import { renderPlot3D } from "./plot3d.js";
import { renderPlot2D } from "./plot2d.js";
import { loadInspector } from "./inspector.js";
import { applyCompositionSlice } from "./plot3d-slices.js";

let allPoints = [];
const datasetPointsCache = new Map();
let predictedGridCache = new Map();
let predictionRequestToken = 0;
let renderRequestToken = 0;
const ZIF_BASE_PATH = String(window.ZIF_BASE_PATH || "");
const LAYER_SELECTION_STORAGE_KEY = "zifExplorer.visibleLayers";
const THEME_STORAGE_KEY = "zifExplorer.theme";
const RENDER_DEBOUNCE_MS = 60;
const MOBILE_LAYOUT_QUERY = "(max-width: 1024px)";
let scheduledRenderHandle = null;
let scheduledRenderTimeout = null;
let phaseFilterSignature = "";
const SPACING_UI_MIN = 0;
const SPACING_UI_MAX = 1;
const SPACING_ACTUAL_MIN = 0.02;
const SPACING_ACTUAL_MAX = 0.2;
const PHASE_FILTER_BASIS_COPY = {
  relative:
    "Use these controls to require a minimum amount of specific crystalline phases in the selected samples.",
  total:
    "Use these controls to require a minimum amount of a phase in the total material composition. In this mode, amorphous content is included and crystalline phases are weighted by the overall crystallinity."
};
const SLICE_AXIS_LABELS = {
  metal: "Metal",
  ligand: "Ligand",
  bsa: "BSA"
};
const viewerState = {
  selectedLayers: [],
  camera3D: null
};

function isMobileLayout() {
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

function getStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
  } catch (_err) {
    return "light";
  }
}

function getCurrentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function setThemeToggleState() {
  const toggle = $("themeToggleBtn");
  if (!toggle) return;

  const isDark = getCurrentTheme() === "dark";
  toggle.setAttribute("aria-pressed", String(isDark));
  toggle.setAttribute(
    "aria-label",
    isDark ? "Switch to light mode" : "Switch to dark mode"
  );
}

function syncBrandLogo() {
  const logo = $("plotBrandLogo");
  if (!logo) return;

  const isDark = getCurrentTheme() === "dark";
  const nextSrc = isDark ? logo.dataset.logoDark : logo.dataset.logoLight;
  if (nextSrc) logo.src = nextSrc;
}

function buildThemedAnnotations(plotDiv, theme) {
  const currentAnnotations =
    plotDiv?.layout?.annotations || plotDiv?._fullLayout?.annotations || [];
  if (!Array.isArray(currentAnnotations) || !currentAnnotations.length) {
    return null;
  }

  return currentAnnotations.map((annotation, index) => ({
    ...annotation,
    font: {
      ...(annotation.font || {}),
      color: index === 0 ? theme.text : theme.muted
    }
  }));
}

function syncPlotTheme() {
  const plotDiv = $("plot");
  if (!plotDiv?.data?.length) return;

  const theme = getThemeTokens();
  const relayout = {
    paper_bgcolor: theme.card,
    plot_bgcolor: theme.card,
    font: { color: theme.text }
  };
  const annotations = buildThemedAnnotations(plotDiv, theme);
  if (annotations) relayout.annotations = annotations;

  Promise.resolve(Plotly.relayout(plotDiv, relayout)).catch(() => {});
}

function applyTheme(themeName, { persist = true } = {}) {
  if (themeName === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, getCurrentTheme());
    } catch (_err) {
      // Ignore storage failures and keep the UI responsive.
    }
  }

  setThemeToggleState();
  syncBrandLogo();
  syncPlotTheme();
}

function toggleTheme() {
  applyTheme(getCurrentTheme() === "dark" ? "light" : "dark");
}

function updateSidebarToggleState() {
  const leftOpen = $("leftSidebar")?.classList.contains("sidebar-open");
  const rightOpen = $("rightSidebar")?.classList.contains("sidebar-open");
  $("openLeftSidebarBtn")?.setAttribute("aria-expanded", String(Boolean(leftOpen)));
  $("openRightSidebarBtn")?.setAttribute("aria-expanded", String(Boolean(rightOpen)));
}

function closeMobileSidebars() {
  $("leftSidebar")?.classList.remove("sidebar-open");
  $("rightSidebar")?.classList.remove("sidebar-open");

  const backdrop = $("mobileSidebarBackdrop");
  if (backdrop) {
    backdrop.classList.remove("is-visible");
    backdrop.hidden = true;
  }

  updateSidebarToggleState();
}

function toggleMobileSidebar(side) {
  if (!isMobileLayout()) return;

  const target = $(side === "left" ? "leftSidebar" : "rightSidebar");
  const other = $(side === "left" ? "rightSidebar" : "leftSidebar");
  const backdrop = $("mobileSidebarBackdrop");
  if (!target || !backdrop) return;

  const shouldOpen = !target.classList.contains("sidebar-open");
  target.classList.toggle("sidebar-open", shouldOpen);
  other?.classList.remove("sidebar-open");

  backdrop.hidden = !shouldOpen;
  backdrop.classList.toggle("is-visible", shouldOpen);
  updateSidebarToggleState();
}

function openMobileSidebar(side) {
  if (!isMobileLayout()) return;
  const target = $(side === "left" ? "leftSidebar" : "rightSidebar");
  const other = $(side === "left" ? "rightSidebar" : "leftSidebar");
  const backdrop = $("mobileSidebarBackdrop");
  if (!target || !backdrop) return;

  target.classList.add("sidebar-open");
  other?.classList.remove("sidebar-open");
  backdrop.hidden = false;
  backdrop.classList.add("is-visible");
  updateSidebarToggleState();
}

function syncMobileSidebarLayout() {
  if (!isMobileLayout()) {
    closeMobileSidebars();
  } else {
    updateSidebarToggleState();
  }
}

function refreshUiChrome(uiState = readAllState(viewerState)) {
  updateDerivedReadouts(uiState);
  updateViewControls(uiState);
  toggleModeDependentCards(uiState);
  syncRangeAccessibility();
  return uiState;
}

function syncRangeAccessibility() {
  document.querySelectorAll('input[type="range"]').forEach((input) => {
    const min = Number(input.min ?? 0);
    const max = Number(input.max ?? 100);
    const value = Number(input.value ?? 0);
    input.setAttribute("aria-valuemin", String(Number.isFinite(min) ? min : 0));
    input.setAttribute("aria-valuemax", String(Number.isFinite(max) ? max : 100));
    input.setAttribute("aria-valuenow", String(Number.isFinite(value) ? value : 0));

    const legendText =
      input.closest("fieldset")?.querySelector("legend")?.textContent?.trim() || "";
    if (legendText && !input.getAttribute("aria-label")) {
      input.setAttribute("aria-label", legendText);
    }
  });
}

function initialiseInfoTips() {
  document.querySelectorAll(".info-tip").forEach((tip, index) => {
    const popover = tip.querySelector(".info-tip-popover");
    if (!popover) return;

    const tooltipId = popover.id || `infoTipPopover${index + 1}`;
    popover.id = tooltipId;
    popover.setAttribute("role", "tooltip");

    tip.setAttribute("role", "button");
    tip.setAttribute("aria-describedby", tooltipId);
    tip.setAttribute("aria-expanded", "false");

    const labelHost = [...(tip.parentElement?.children || [])].find(
      (child) => child !== tip
    );
    const labelText = labelHost?.textContent?.replace(/\?/g, "").trim() || "More information";
    tip.setAttribute("aria-label", `More information about ${labelText}`);

    const setExpanded = (expanded) =>
      tip.setAttribute("aria-expanded", String(Boolean(expanded)));

    tip.addEventListener("focus", () => setExpanded(true));
    tip.addEventListener("blur", () => setExpanded(false));
    tip.addEventListener("mouseenter", () => setExpanded(true));
    tip.addEventListener("mouseleave", () => setExpanded(false));
    tip.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setExpanded(false);
        tip.blur();
      }
    });
  });
}

function createEmptyStateIcon(kind = "empty") {
  if (kind === "error") {
    return `
      <svg class="empty-state-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `;
  }

  return `
    <svg class="empty-state-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 7h16"></path>
      <path d="M7 7v10"></path>
      <path d="M17 7v6"></path>
      <path d="m9.5 15.5 5-5"></path>
      <path d="m14.5 15.5-5-5"></path>
    </svg>
  `;
}

function setPlotAccessibility(filters, visiblePoints) {
  const plotDiv = $("plot");
  if (!plotDiv) return;

  const pointCount = Array.isArray(visiblePoints) ? visiblePoints.length : 0;
  const layerCount =
    filters.mode === "3d"
      ? new Set(visiblePoints.map((point) => Number(point.concentration)).filter(Number.isFinite)).size
      : 1;
  const layerLabel =
    filters.mode === "3d"
      ? `${layerCount} layers`
      : `layer ${filters.searchPosition?.concentration ?? $("layerFocus")?.value ?? "auto"}`;
  const label =
    filters.mode === "3d"
      ? `3D stacked phase map, ${layerLabel}, ${pointCount} points visible`
      : `2D ternary phase map, ${layerLabel}, ${pointCount} points visible`;

  plotDiv.setAttribute("role", "img");
  plotDiv.setAttribute("aria-label", label);
}

function apiUrl(path) {
  return `${ZIF_BASE_PATH}${path}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentPhaseFilterBasis() {
  return (
    document.querySelector('input[name="phaseFilterBasis"]:checked')?.value ||
    "relative"
  );
}

function getNormalizedSpacingValue() {
  const raw = Number($("spacingScale")?.value ?? 1);
  return Number.isFinite(raw) ? clamp(raw, SPACING_UI_MIN, SPACING_UI_MAX) : 1;
}

function isCurrentMode3D() {
  return (
    document.querySelector('input[name="viewMode"]:checked')?.value || "3d"
  ) === "3d";
}

function cloneCamera(camera) {
  return camera ? JSON.parse(JSON.stringify(camera)) : null;
}

function queueGroupedRestyle(plotDiv, actualTraceIndices, groupedUpdate) {
  if (
    !plotDiv ||
    !Array.isArray(actualTraceIndices) ||
    !groupedUpdate ||
    !Array.isArray(groupedUpdate.indices) ||
    !groupedUpdate.update
  ) {
    return null;
  }

  const traceIndices = groupedUpdate.indices
    .map((index) => actualTraceIndices[index])
    .filter((value) => Number.isInteger(value));

  if (!traceIndices.length) return null;
  return Plotly.restyle(plotDiv, groupedUpdate.update, traceIndices);
}

function begin3DMutation(plotDiv) {
  if (!plotDiv) return 0;
  const nextToken = Number(plotDiv.__zif3DLatestMutationToken || 0) + 1;
  plotDiv.__zif3DLatestMutationToken = nextToken;
  return nextToken;
}

function finalize3DTraceUpdates(plotDiv, pendingUpdates, liveCamera, mutationToken) {
  if (!pendingUpdates.length) return false;

  const cameraToRestore = cloneCamera(liveCamera);
  Promise.allSettled(pendingUpdates).then(() => {
    if (!plotDiv || !cameraToRestore) return;
    if (plotDiv.__zif3DLatestMutationToken !== mutationToken) return;

    plotDiv.__zif3DSuppressCameraEvents =
      Number(plotDiv.__zif3DSuppressCameraEvents || 0) + 1;

    Promise.resolve(
      Plotly.relayout(plotDiv, { "scene.camera": cameraToRestore })
    )
      .catch(() => {})
      .finally(() => {
        plotDiv.__zif3DSuppressCameraEvents = Math.max(
          0,
          Number(plotDiv.__zif3DSuppressCameraEvents || 1) - 1
        );
      });
  });

  return true;
}

function restyleCurrent3DMarkerSize() {
  const plotDiv = $("plot");
  if (!plotDiv || !isCurrentMode3D() || !plotDiv.data?.length) return false;
  const liveCamera = cloneCamera(plotDiv?._fullLayout?.scene?.camera);
  const mutationToken = begin3DMutation(plotDiv);

  const pointIndices = plotDiv.__zif3DPointTraceIndices;
  const pointUpdateFactory = plotDiv.__zif3DPointSizeUpdate;
  if (!Array.isArray(pointIndices) || typeof pointUpdateFactory !== "function") {
    return false;
  }

  const pendingUpdates = [];
  const pointUpdate = pointUpdateFactory();
  const pointRestyle = queueGroupedRestyle(plotDiv, pointIndices, pointUpdate);
  if (pointRestyle) pendingUpdates.push(pointRestyle);

  return finalize3DTraceUpdates(
    plotDiv,
    pendingUpdates,
    liveCamera,
    mutationToken
  );
}

function restyleCurrent3DAmorphousOpacity() {
  const plotDiv = $("plot");
  if (!plotDiv || !isCurrentMode3D() || !plotDiv.data?.length) return false;
  const liveCamera = cloneCamera(plotDiv?._fullLayout?.scene?.camera);
  const mutationToken = begin3DMutation(plotDiv);

  const pointIndices = plotDiv.__zif3DPointTraceIndices;
  const pointUpdateFactory = plotDiv.__zif3DAmorphousOpacityUpdate;
  if (!Array.isArray(pointIndices) || typeof pointUpdateFactory !== "function") {
    return false;
  }

  const pendingUpdates = [];
  const pointUpdate = pointUpdateFactory();
  const pointRestyle = queueGroupedRestyle(plotDiv, pointIndices, pointUpdate);
  if (pointRestyle) pendingUpdates.push(pointRestyle);

  return finalize3DTraceUpdates(
    plotDiv,
    pendingUpdates,
    liveCamera,
    mutationToken
  );
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

function applySliceVisibility(points, filters, sliceState) {
  if (filters.mode !== "3d") return points;
  return applyCompositionSlice(points, sliceState);
}

function requestAnimationFrameRender() {
  if (scheduledRenderHandle != null) return;
  scheduledRenderHandle = window.requestAnimationFrame(() => {
    scheduledRenderHandle = null;
    applyFiltersAndRender();
  });
}

function scheduleRender({ strategy = "immediate" } = {}) {
  if (strategy === "debounce") {
    if (scheduledRenderTimeout != null) return;
    scheduledRenderTimeout = window.setTimeout(() => {
      scheduledRenderTimeout = null;
      requestAnimationFrameRender();
    }, RENDER_DEBOUNCE_MS);
    return;
  }

  if (scheduledRenderTimeout != null) {
    window.clearTimeout(scheduledRenderTimeout);
    scheduledRenderTimeout = null;
  }

  requestAnimationFrameRender();
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

  const phaseFilterBasis = document.querySelector(
    'input[name="phaseFilterBasis"][value="relative"]'
  );
  if (phaseFilterBasis) phaseFilterBasis.checked = true;

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
  if (spacingScale) spacingScale.value = 1;

  const markerScale3D = $("markerScale3D");
  if (markerScale3D) markerScale3D.value = 1.8;

  const amorphousOpacity = $("amorphousOpacity");
  if (amorphousOpacity) amorphousOpacity.value = 0.7;

  const sliceMode = $("sliceMode");
  if (sliceMode) sliceMode.value = "off";

  const sliceAxisA = $("sliceAxisA");
  if (sliceAxisA) sliceAxisA.value = "metal";

  const sliceValueA = $("sliceValueA");
  if (sliceValueA) sliceValueA.value = 50;

  const sliceAxisB = $("sliceAxisB");
  if (sliceAxisB) sliceAxisB.value = "ligand";

  const sliceValueB = $("sliceValueB");
  if (sliceValueB) sliceValueB.value = 20;
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

  applyTheme(getStoredTheme(), { persist: false });
  resetTransientControlsToDefaults();
  initialiseInfoTips();
  syncRangeAccessibility();
  wireControls();
  syncMobileSidebarLayout();
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
  syncRangeAccessibility();
}

function wireControls() {
  $("themeToggleBtn")?.addEventListener("click", toggleTheme);
  $("openLeftSidebarBtn")?.addEventListener("click", () => toggleMobileSidebar("left"));
  $("openRightSidebarBtn")?.addEventListener("click", () => toggleMobileSidebar("right"));
  $("mobileSidebarBackdrop")?.addEventListener("click", closeMobileSidebars);
  window.addEventListener("resize", syncMobileSidebarLayout);

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
    "posConcentration",
    "sliceMode",
    "sliceValueA",
    "sliceValueB"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, () => {
      refreshUiChrome();
      scheduleRender({
        strategy: el.matches('input[type="range"]') ? "debounce" : "immediate"
      });
    });
  });

  ["sliceAxisA", "sliceAxisB"].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("change", () => {
      ensureDistinctSliceAxes();
      refreshUiChrome();
      scheduleRender();
    });
  });

  const markerScale3D = $("markerScale3D");
  if (markerScale3D) {
    markerScale3D.addEventListener("input", () => {
      refreshUiChrome();
      if (!restyleCurrent3DMarkerSize()) {
        scheduleRender({ strategy: "debounce" });
      }
    });
  }

  const amorphousOpacity = $("amorphousOpacity");
  if (amorphousOpacity) {
    amorphousOpacity.addEventListener("input", () => {
      refreshUiChrome();
      if (!restyleCurrent3DAmorphousOpacity()) {
        scheduleRender({ strategy: "debounce" });
      }
    });
  }

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
      refreshUiChrome();
      updateCompositionPrediction();
      scheduleRender();
    });
  });

  $("posConcentration")?.addEventListener("input", () => {
    updatePositionNote();
    updateCompositionPrediction();
  });

  $("posConcentration")?.addEventListener("change", () => {
    refreshUiChrome();
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
      refreshUiChrome();
      scheduleRender();
    });
  });

  document.querySelectorAll('input[name="dataLayer"]').forEach((el) => {
    el.addEventListener("change", async () => {
      refreshUiChrome();
      if (el.value === "experimental" || el.value === "experimental_xue") {
        await syncControlsToActiveExperimentalDataset();
        refreshUiChrome();
      }
      scheduleRender();
    });
  });

  document.querySelectorAll('input[name="washing"]').forEach((el) => {
    el.addEventListener("change", () => {
      refreshUiChrome();
      if ($("posWash") && !readPositionNumber("posConcentration")) {
        $("posWash").value = el.value;
        updateCompositionPrediction();
      }
      scheduleRender();
    });
  });

  document.querySelectorAll('input[name="phaseFilterBasis"]').forEach((el) => {
    el.addEventListener("change", async () => {
      const preservedState = capturePhaseFilterState();
      const sourcePoints = await fetchDatasetPoints(currentExperimentalDatasetKey());
      buildPhaseFilters(sourcePoints, preservedState);
      syncRangeAccessibility();
      scheduleRender();
    });
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      $("compositionPanel")?.classList.add("is-hidden");
      closeMobileSidebars();
    }
  });
}

function showLoadingSpinner() {
  $("plotLoading")?.classList.remove("is-hidden");
}

function hideLoadingSpinner() {
  $("plotLoading")?.classList.add("is-hidden");
}

async function loadPoints() {
  showLoadingSpinner();
  try {
    allPoints = await fetchDatasetPoints("primary");

    await syncControlsToActiveExperimentalDataset();

    refreshUiChrome();
    const posWash = $("posWash");
    if (posWash) {
      posWash.value =
        document.querySelector('input[name="washing"]:checked')?.value || "ethanol";
    }
    updateCompositionPrediction();
    applyFiltersAndRender();
  } catch (err) {
    console.error("loadPoints failed:", err);
    showPlotEmptyState(
      renderEmptyState({
        kind: "error",
        title: "Failed to load point data.",
        body: "The dataset could not be loaded. Please retry or refresh the page."
      })
    );
  } finally {
    hideLoadingSpinner();
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

function buildPhaseFilters(sourcePoints = allPoints, preservedState = {}) {
  const wrap = $("phaseFilters");
  if (!wrap) return;

  const phaseFilterBasis = currentPhaseFilterBasis();
  const help = $("phaseFiltersHelp");
  if (help) {
    help.textContent =
      PHASE_FILTER_BASIS_COPY[phaseFilterBasis] ||
      PHASE_FILTER_BASIS_COPY.relative;
  }

  const phaseNames = [
    ...new Set(sourcePoints.flatMap((p) => Object.keys(p.phase_composition || {})))
  ]
    .filter((phase) => !HIDDEN_USER_PHASE_KEYS.includes(normalisePhase(phase)))
    .sort();

  if (
    phaseFilterBasis === "total" &&
    !phaseNames.some((phase) => normalisePhase(phase) === "am")
  ) {
    phaseNames.unshift("Amorphous");
  }

  const nextSignature = `${phaseFilterBasis}::${phaseNames
    .map((phase) => normalisePhase(phase))
    .join("|")}`;
  if (phaseFilterSignature === nextSignature && wrap.childElementCount) {
    updatePhaseReadouts();
    return;
  }
  phaseFilterSignature = nextSignature;

  wrap.innerHTML = phaseNames
    .map(
      (phase) => {
        const phaseKey = normalisePhase(phase);
        const phaseColor = PHASE_COLORS[phaseKey] || PHASE_COLORS.unknown || "#8B8B8B";
        const phaseLabel = displayPhase(phase);
        const saved = preservedState?.[phase] || null;
        const sliderValue = Number.isFinite(Number(saved?.value))
          ? Number(saved.value)
          : 0;
        const isChecked = Boolean(saved?.checked) || sliderValue > 0;

        return `
      <div class="phase-filter-row" style="--phase-accent:${phaseColor};">
        <label class="simple-check phase-filter-check">
          <input type="checkbox" class="phase-check" data-phase="${phase}" style="accent-color:${phaseColor};" ${isChecked ? "checked" : ""}>
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
            value="${sliderValue}"
            style="accent-color:${phaseColor};"
          >
          <div class="phase-slider-readout" id="phaseReadout_${cssSafe(phase)}">>= ${sliderValue}%</div>
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
      syncRangeAccessibility();
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
      syncRangeAccessibility();
      scheduleRender({ strategy: "debounce" });
    });
  });

  updatePhaseReadouts();
  syncRangeAccessibility();
}

function capturePhaseFilterState() {
  const wrap = $("phaseFilters");
  if (!wrap) return {};

  const result = {};
  wrap.querySelectorAll(".phase-slider").forEach((slider) => {
    const phase = slider.dataset.phase;
    if (!phase) return;

    const check = wrap.querySelector(`.phase-check[data-phase="${phase}"]`);
    result[phase] = {
      checked: Boolean(check?.checked),
      value: Number(slider.value || 0)
    };
  });

  return result;
}

function ensureDistinctSliceAxes() {
  const axisA = $("sliceAxisA");
  const axisB = $("sliceAxisB");
  if (!axisA || !axisB) return;

  if (axisA.value !== axisB.value) return;

  const fallback = ["metal", "ligand", "bsa"].find((value) => value !== axisA.value);
  if (fallback) {
    axisB.value = fallback;
  }
}

function readCompositionSliceState(uiState = readAllState(viewerState)) {
  const mode = uiState.sliceMode || "off";
  if (mode === "off") return { mode: "off" };

  const axisA = uiState.sliceAxisA || "metal";
  const valueA = Number(uiState.sliceValueA ?? 50);

  if (mode !== "line") {
    return {
      mode: "plane",
      axisA,
      valueA: Number.isFinite(valueA) ? valueA : 50
    };
  }

  let axisB = uiState.sliceAxisB || "ligand";
  if (axisB === axisA) {
    axisB = ["metal", "ligand", "bsa"].find((value) => value !== axisA) || "ligand";
  }

  const valueB = Number(uiState.sliceValueB ?? 20);
  return {
    mode: "line",
    axisA,
    valueA: Number.isFinite(valueA) ? valueA : 50,
    axisB,
    valueB: Number.isFinite(valueB) ? valueB : 20
  };
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
  el.classList.toggle("is-error", hasError);
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
    note.style.color = "var(--danger)";
    return;
  }

  if ([m, l, b].every((v) => v !== null) && hasSumError) {
    note.textContent = "Metal + Ligand + BSA must equal 100.";
    note.style.color = "var(--danger)";
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
          <div class="prediction-label">ATR-IR bands ratio</div>
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

function updateDerivedReadouts(uiState = readAllState(viewerState)) {
  const cryst = Number(uiState.crystBalance ?? 0);
  const protein = Number(uiState.proteinThreshold ?? 0);
  const ee = Number(uiState.eeThreshold ?? 0);
  const spacing = Number.isFinite(Number(uiState.spacingScale))
    ? clamp(Number(uiState.spacingScale), SPACING_UI_MIN, SPACING_UI_MAX)
    : getNormalizedSpacingValue();
  const markerScale = Number(uiState.markerScale3D ?? 1.8);
  const amorphousOpacity = Number(uiState.amorphousOpacity ?? 0.7);

  const crystOut = $("crystBalanceVal");
  const proteinOut = $("proteinThresholdVal");
  const eeOut = $("eeThresholdVal");
  const spacingOut = $("spacingScaleVal");
  const markerScaleOut = $("markerScale3DVal");
  const amorphousOpacityOut = $("amorphousOpacityVal");
  const sliceValueAOut = $("sliceValueAVal");
  const sliceValueBOut = $("sliceValueBVal");
  const sliceSummary = $("sliceSummary");
  const sliceState = readCompositionSliceState(uiState);

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
  if (sliceValueAOut) {
    sliceValueAOut.textContent = `${Math.round(Number(uiState.sliceValueA ?? 50))}%`;
  }
  if (sliceValueBOut) {
    sliceValueBOut.textContent = `${Math.round(Number(uiState.sliceValueB ?? 20))}%`;
  }
  if (sliceSummary) {
    if (sliceState.mode === "off") {
      sliceSummary.textContent = "No composition slice is applied.";
    } else if (sliceState.mode === "line") {
      sliceSummary.textContent =
        `${SLICE_AXIS_LABELS[sliceState.axisA] || sliceState.axisA} = ${Math.round(sliceState.valueA)}%, ` +
        `${SLICE_AXIS_LABELS[sliceState.axisB] || sliceState.axisB} = ${Math.round(sliceState.valueB)}% only across layers.`;
    } else {
      sliceSummary.textContent =
        `${SLICE_AXIS_LABELS[sliceState.axisA] || sliceState.axisA} = ${Math.round(sliceState.valueA)}% only across layers.`;
    }
  }

  updatePositionNote();
}

function toggleModeDependentCards(uiState = readAllState(viewerState)) {
  const mode = uiState.mode || "3d";
  const spacingCard = $("spacingCard");
  const markerSizeCard = $("markerSizeCard");
  const amorphousOpacityCard = $("amorphousOpacityCard");
  const interlayerGuideCard = $("interlayerGuideCard");
  const sliceFiltersBlock = $("sliceFiltersBlock");
  const sliceAxisBRow = $("sliceAxisBRow");
  const colourBy = uiState.colourBy || "phase";
  const sliceMode = uiState.sliceMode || "off";

  if (spacingCard) {
    spacingCard.style.display = mode === "3d" ? "flex" : "none";
  }
  if (markerSizeCard) {
    markerSizeCard.style.display = mode === "3d" ? "flex" : "none";
  }
  if (amorphousOpacityCard) {
    amorphousOpacityCard.style.display =
      mode === "2d" && colourBy === "phase" ? "flex" : "none";
  }
  if (interlayerGuideCard) {
    interlayerGuideCard.style.display = mode === "3d" ? "flex" : "none";
  }
  if (sliceFiltersBlock) {
    sliceFiltersBlock.style.display = mode === "3d" ? "flex" : "none";
  }
  if (sliceAxisBRow) {
    sliceAxisBRow.style.display =
      mode === "3d" && sliceMode === "line" ? "grid" : "none";
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
  const phaseBasis =
    filters.phaseFilterBasis === "total" ? "Total material" : "Relative phase";
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
    phaseBasis,
    phaseSummary
  };
}

function renderEmptyState({
  kind = "empty",
  title,
  body,
  diagnosticMarkup = ""
}) {
  return `
    <div class="empty-state-wrap${kind === "error" ? " empty-state-error" : ""}">
      ${createEmptyStateIcon(kind)}
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-body">${body}</div>
      ${diagnosticMarkup}
    </div>
  `;
}

function renderNoPointsMarkup() {
  return renderEmptyState({
    title: "No points match the current filters.",
    body: "Adjust the visible layers or relax one of the filters to see samples again."
  });
}

function renderNoPointsMarkupWithDiagnostics(diagnostics) {
  const debug = diagnostics?.filters || {};
  return renderEmptyState({
    title: "No points match the current filters.",
    body: "The current filter combination leaves no visible samples. Relax one or more constraints to repopulate the plot.",
    diagnosticMarkup: `
      <div class="empty-state-diagnostic-grid">
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
          <div><strong>ATR-IR bands ratio min:</strong> ${debug.atrRatio || "N/A"}</div>
          <div><strong>Min EE:</strong> ${debug.ee || "N/A"}</div>
          <div><strong>Phase filter basis:</strong> ${debug.phaseBasis || "Relative phase"}</div>
          <div><strong>Phase filters:</strong> ${debug.phaseSummary || "none"}</div>
        </div>
      </div>
    `
  });
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

async function applyFiltersAndRender(uiState = readAllState(viewerState)) {
  if (document.querySelectorAll(".layer-check").length) {
    syncLayerSelectionFromDom();
  }
  const filters = readFiltersFromState(viewerState, uiState);
  const sliceState = readCompositionSliceState(uiState);
  const token = ++renderRequestToken;
  const renderStartedAt = performance.now();
  const theme = getThemeTokens();

  try {
    const displayPoints = await getDisplayPoints(filters);
    if (token !== renderRequestToken) return;
    const propertyFiltered = filterPoints(displayPoints, filters);
    const layerVisiblePoints = applyLayerVisibility(propertyFiltered, filters);
    const filtered =
      filters.mode === "3d"
        ? applySliceVisibility(layerVisiblePoints, filters, sliceState)
        : layerVisiblePoints;
    if (token !== renderRequestToken) return;

    const diagnostics = {
      sourceCount: displayPoints.length,
      propertyCount: propertyFiltered.length,
      visibleCount: filtered.length,
      filters: formatRenderDebugFilters(filters)
    };
    window.__zifLastRenderDiagnostics = diagnostics;

    if (!filtered.length) {
      showPlotEmptyState(renderNoPointsMarkupWithDiagnostics(diagnostics));
      return;
    }

    hidePlotEmptyState();

    if (filters.mode === "2d") {
      renderPlot2D(
        filtered,
        filters.colourBy,
        handlePointClick,
        filters.searchPosition,
        { theme }
      );
    } else {
      renderPlot3D(
        filtered,
        filters.colourBy,
        viewerState.camera3D,
        (camera) => {
          viewerState.camera3D = camera;
        },
        handlePointClick,
        filters.searchPosition,
        layerVisiblePoints,
        { theme }
      );
    }
    setPlotAccessibility(filters, filtered);
    console.debug("[zif-vis] render", {
      points: filtered.length,
      ms: Number((performance.now() - renderStartedAt).toFixed(1)),
      mode: filters.mode,
      dataLayer: filters.dataLayer
    });
  } catch (err) {
    if (token !== renderRequestToken) return;
    console.error("applyFiltersAndRender failed:", err);
    showPlotEmptyState(
      renderEmptyState({
        kind: "error",
        title: "Failed to load the selected data layer.",
        body: "The requested view could not be rendered. Please try a different data layer or refresh the page."
      })
    );
  }
}

async function handlePointClick(sampleId) {
  if (!sampleId || String(sampleId).startsWith("pred_")) return;
  const dataset =
    document.querySelector('input[name="dataLayer"]:checked')?.value === "experimental_xue"
      ? "manual"
      : "primary";
  await loadInspector(sampleId,