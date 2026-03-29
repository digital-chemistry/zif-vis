import { $, updateViewControls } from "./dom.js";
import { formatValShort, escapeHtml, displayPhase } from "./formatters.js";
import {
  finiteValues,
  setRangePair,
  syncRangePairs,
  readFiltersFromDom,
  filterPoints
} from "./filters.js";
import { renderPlot3D } from "./plot3d.js";
import { renderPlot2D } from "./plot2d.js";
import { loadInspector } from "./inspector.js";

let allPoints = [];
let currentCamera = null;

console.log("module app.js loaded");

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  if (window.__zifExplorerLoaded) return;
  window.__zifExplorerLoaded = true;

  wireControls();
  await loadPoints();
}

function wireControls() {
  [
    "searchBox",
    "colourBy",
    "viewMode",
    "phaseMulti",
    "layerMulti",
    "layerFocus",
    "washEW",
    "washWW",
    "spacingScale",
    "crystMin",
    "crystMax",
    "protMin",
    "protMax"
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;

    const evt =
      el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";

    el.addEventListener(evt, () => {
      syncRangePairs(formatValShort);
      updateViewControls();
      applyFiltersAndRender();
    });
  });
}

async function loadPoints() {
  try {
    const res = await fetch("/api/points");
    if (!res.ok) throw new Error(`Failed to load /api/points (${res.status})`);

    allPoints = await res.json();
    console.log("points loaded", allPoints.length, allPoints[0]);

    buildPhaseOptions();
    buildLayerOptions();

    const crystValues = finiteValues(allPoints, "crystallinity");
    if (crystValues.length) {
      setRangePair(
        "crystMin",
        "crystMax",
        "crystMinVal",
        "crystMaxVal",
        crystValues,
        formatValShort
      );
    }

    const protValues = finiteValues(allPoints, "protein_ratio");
    if (protValues.length) {
      setRangePair(
        "protMin",
        "protMax",
        "protMinVal",
        "protMaxVal",
        protValues,
        formatValShort
      );
    }

    updateViewControls();
    console.log("about to render");
    applyFiltersAndRender();
  } catch (err) {
    console.error("loadPoints failed:", err);
    const plotDiv = $("plot");
    if (plotDiv) {
      plotDiv.innerHTML = `<div style="padding:24px;color:#a33;">Failed to load point data.</div>`;
    }
  }
}

function buildPhaseOptions() {
  const sel = $("phaseMulti");
  if (!sel) return;

  const phases = [...new Set(allPoints.map(p => String(p.phase || "").trim()).filter(Boolean))].sort();
  sel.innerHTML = phases
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(displayPhase(p))}</option>`)
    .join("");
}

function buildLayerOptions() {
  const layers = [...new Set(allPoints.map(p => Number(p.concentration)).filter(v => Number.isFinite(v)))]
    .sort((a, b) => a - b);

  const multi = $("layerMulti");
  const focus = $("layerFocus");

  if (multi) {
    multi.innerHTML = layers.map(v => `<option value="${v}">${v}</option>`).join("");
  }

  if (focus) {
    focus.innerHTML =
      `<option value="">Auto</option>` +
      layers.map(v => `<option value="${v}">${v}</option>`).join("");
  }
}

function applyFiltersAndRender() {
  const filters = readFiltersFromDom();
  const filtered = filterPoints(allPoints, filters);
  renderPlot(filtered, filters);
}

function renderPlot(points, filters) {
  if (filters.mode === "2d") {
    renderPlot2D(points, filters.colourBy, loadInspector);
  } else {
    const plotDiv = $("plot");
    if (plotDiv?._fullLayout?.scene?.camera) {
      currentCamera = plotDiv._fullLayout.scene.camera;
    }

    renderPlot3D(
      points,
      filters.colourBy,
      currentCamera,
      (camera) => { currentCamera = camera; },
      loadInspector
    );
  }
}