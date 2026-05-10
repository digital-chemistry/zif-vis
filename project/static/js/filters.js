import { $ } from "./dom.js";
import { normalisePhase } from "./formatters.js";

export function finiteValues(points, key) {
  return points
    .map(p => Number(p[key]))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
}

function numericOrZero(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function getPhaseFilterBasis() {
  return getCheckedRadio("phaseFilterBasis", "relative");
}

function getRelativePhaseFraction(point, phase) {
  const obj = point?.phase_composition?.[phase];
  return numericOrZero(obj?.mean ?? obj);
}

function getTotalMaterialPhaseFraction(point, phase) {
  const phaseKey = normalisePhase(phase);

  if (phaseKey === "am") {
    return numericOrZero(
      point?.crystallinity?.fractions?.amorphous?.mean ??
      point?.amorphous_fraction ??
      point?.crystallinity_fractions?.amorphous ??
      point?.amorphousness
    );
  }

  const crystallinity = numericOrZero(
    point?.crystallinity?.fractions?.crystalline?.mean ??
    point?.crystalline_fraction ??
    point?.crystallinity_fractions?.crystalline ??
    point?.crystallinity
  );

  if (crystallinity <= 0) return 0;

  const rawPhases = Object.entries(point?.phase_composition || {})
    .map(([name, obj]) => ({
      key: normalisePhase(name),
      raw: numericOrZero(obj?.mean ?? obj)
    }))
    .filter((phaseEntry) => phaseEntry.raw > 0);

  const rawTotal = rawPhases.reduce((sum, phaseEntry) => sum + phaseEntry.raw, 0);
  if (rawTotal <= 0) return 0;

  const match = rawPhases.find((phaseEntry) => phaseEntry.key === phaseKey);
  if (!match) return 0;

  return crystallinity * (match.raw / rawTotal);
}

function getPhaseFractionForFilter(point, phase, basis) {
  return basis === "total"
    ? getTotalMaterialPhaseFraction(point, phase)
    : getRelativePhaseFraction(point, phase);
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

function getPositionMarkerFromState(uiState = {}) {
  const m = Number(uiState?.searchPosition?.metal);
  const l = Number(uiState?.searchPosition?.ligand);
  const b = Number(uiState?.searchPosition?.bsa);
  const c = Number(uiState?.searchPosition?.concentration);

  if (![m, l, b, c].every(Number.isFinite)) return null;
  if ([m, l, b].some((value) => value < 0 || value > 100)) return null;
  if (Math.abs(m + l + b - 100) > 0.25) return null;

  return { metal: m, ligand: l, bsa: b, concentration: c };
}

export function readFiltersFromState(viewerState = {}, uiState = null) {
  const state = uiState || {};
  const mode = state.mode || document.querySelector('input[name="viewMode"]:checked')?.value || "3d";
  const dataLayer =
    state.dataLayer ||
    document.querySelector('input[name="dataLayer"]:checked')?.value ||
    "experimental";
  const washing =
    state.washing ||
    document.querySelector('input[name="washing"]:checked')?.value ||
    "ethanol";
  const colourBy = state.colourBy || $("colourBy")?.value || "phase";
  const selectedLayers =
    mode === "3d"
      ? (Array.isArray(state.selectedLayers)
          ? state.selectedLayers
          : Array.isArray(viewerState.selectedLayers)
            ? viewerState.selectedLayers
            : []
        )
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
  const layerCheckboxCount =
    state.layerCheckboxCount ?? document.querySelectorAll(".layer-check").length;

  return {
    mode,
    dataLayer,
    washing,
    colourBy,
    searchPosition: uiState ? getPositionMarkerFromState(state) : getPositionMarker(),
    selectedLayers,
    selectedLayersExplicitlyEmpty:
      state.selectedLayersExplicitlyEmpty ??
      (mode === "3d" && layerCheckboxCount > 0 && selectedLayers.length === 0),
    crystBalance: Number(state.crystBalance ?? $("crystBalance")?.value ?? 0) / 100,
    proteinThreshold: Number(state.proteinThreshold ?? $("proteinThreshold")?.value ?? 0),
    eeThreshold: Number(state.eeThreshold ?? $("eeThreshold")?.value ?? 0),
    phaseFilterBasis: state.phaseFilterBasis || getPhaseFilterBasis(),
    phaseThresholds: state.phaseThresholds || getPhase