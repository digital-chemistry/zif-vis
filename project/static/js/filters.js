import { $ } from "./dom.js";

export function finiteValues(points, key) {
  return points
    .map(p => Number(p[key]))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
}

function getCheckedRadio(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function getCheckedLayers() {
  const domSelected = [...document.querySelectorAll(".layer-check")]
    .filter(el => el.checked)
    .map(el => Number(el.value))
    .filter(value => Number.isFinite(value));

  const fromState = window.__zifLayerSelectionState;
  if (Array.isArray(fromState)) {
    if (domSelected.length !== fromState.length) {
      return domSelected;
    }
    return fromState
      .map(value => Number(value))
      .filter(value => Number.isFinite(value));
  }

  return domSelected;
}

function getPhaseThresholds() {
  const result = {};
  document.querySelectorAll(".phase-slider").forEach((slider) => {
    const phase = slider.dataset.phase;
    const checked = document.querySelector(`.phase-check[data-phase="${phase}"]`)?.checked;
    const threshold = Number(slider.value || 0);
    if (checked) result[phase] = threshold / 100;
  });
  return result;
}

function getPositionMarker() {
  const metal = $("posMetal")?.value;
  const ligand = $("posLigand")?.value;
  const bsa = $("posBsa")?.value;
  const concentration = $("posConcentration")?.value;

  const m = Number(metal);
  const l = Number(ligand);
  const b = Number(bsa);
  const c = Number(concentration);

  if (![m, l, b, c].every(Number.isFinite)) return null;
  if ([m, l, b].some(v => v < 0 || v > 100)) return null;
  if (Math.abs((m + l + b) - 100) > 0.25) return null;

  return { metal: m, ligand: l, bsa: b, concentration: c };
}

export function readFiltersFromDom() {
  const mode = getCheckedRadio("viewMode", "3d");
  const dataLayer = getCheckedRadio("dataLayer", "experimental");
  
  // UPDATED: Now uses the radio button helper instead of looking for an ID
  const washing = getCheckedRadio("washing", "ethanol"); 
  
  const colourBy = $("colourBy")?.value || "phase";
  const selectedLayers = mode === "3d" ? getCheckedLayers() : [];
  const layerCheckboxCount = document.querySelectorAll(".layer-check").length;
  const layerState = Array.isArray(window.__zifLayerSelectionState)
    ? window.__zifLayerSelectionState
    : null;

  return {
    mode,
    dataLayer,
    washing,
    colourBy,
    searchPosition: getPositionMarker(),
    selectedLayers,
    selectedLayersExplicitlyEmpty:
      mode === "3d" &&
      layerCheckboxCount > 0 &&
      (layerState ? layerState.length === 0 : selectedLayers.length === 0),
    crystBalance: Number($("crystBalance")?.value ?? 0) / 100,
    proteinThreshold: Number($("proteinThreshold")?.value ?? 0),
    eeThreshold: Number($("eeThreshold")?.value ?? 0),
    phaseThresholds: getPhaseThresholds(),
  };
}

export function filterPoints(points, filters) {
  return points.filter((p) => {
    const wash = String(p.wash_code || p.wash || "").toUpperCase();
    const cryst = Number(p.crystallinity);
    const protein = Number(p.protein_ratio);
    const ee = Number(p.encapsulation_efficiency ?? p.ee);
    const phaseComp = p.phase_composition || {};

    if (filters.washing === "ethanol" && wash !== "EW") return false;
    if (filters.washing === "water" && wash !== "WW") return false;

    if (filters.crystBalance > 0 && Number.isFinite(cryst) && cryst < filters.crystBalance) return false;
    if (Number.isFinite(protein) && protein < filters.proteinThreshold) return false;
    if (Number.isFinite(ee) && ee < filters.eeThreshold) return false;

    for (const [phase, minFrac] of Object.entries(filters.phaseThresholds)) {
      const obj = phaseComp?.[phase];
      const frac = Number(obj?.mean ?? obj ?? 0);
      if (!Number.isFinite(frac) || frac < minFrac) return false;
    }

    return true;
  });
}
