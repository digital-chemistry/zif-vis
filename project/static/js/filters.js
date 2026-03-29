import { $, getSelectedMulti } from "./dom.js";
import { normaliseWash } from "./formatters.js";

export function finiteValues(points, key) {
  return points
    .map(p => Number(p[key]))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
}

export function setRangePair(minId, maxId, minLabelId, maxLabelId, values, formatValShort) {
  if (!values.length) return;

  const minEl = $(minId);
  const maxEl = $(maxId);
  const minLabel = $(minLabelId);
  const maxLabel = $(maxLabelId);

  if (!minEl || !maxEl) return;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = Math.max((hi - lo) / 200, 0.01);

  minEl.min = lo;
  minEl.max = hi;
  minEl.step = step;
  minEl.value = lo;

  maxEl.min = lo;
  maxEl.max = hi;
  maxEl.step = step;
  maxEl.value = hi;

  if (minLabel) minLabel.textContent = formatValShort(lo);
  if (maxLabel) maxLabel.textContent = formatValShort(hi);
}

export function syncOneRangePair(minId, maxId, minLabelId, maxLabelId, formatValShort) {
  const minEl = $(minId);
  const maxEl = $(maxId);
  const minLabel = $(minLabelId);
  const maxLabel = $(maxLabelId);

  if (!minEl || !maxEl) return;

  let lo = Number(minEl.value);
  let hi = Number(maxEl.value);

  if (lo > hi) {
    if (document.activeElement === minEl) {
      hi = lo;
      maxEl.value = hi;
    } else {
      lo = hi;
      minEl.value = lo;
    }
  }

  if (minLabel) minLabel.textContent = formatValShort(lo);
  if (maxLabel) maxLabel.textContent = formatValShort(hi);
}

export function syncRangePairs(formatValShort) {
  syncOneRangePair("crystMin", "crystMax", "crystMinVal", "crystMaxVal", formatValShort);
  syncOneRangePair("protMin", "protMax", "protMinVal", "protMaxVal", formatValShort);
}

export function readFiltersFromDom() {
  const mode = $("viewMode")?.value || "3d";

  return {
    mode,
    search: ($("searchBox")?.value || "").trim().toLowerCase(),
    selectedPhases: getSelectedMulti("phaseMulti"),
    selectedLayers: mode === "3d" ? getSelectedMulti("layerMulti").map(Number) : [],
    washEW: $("washEW")?.checked ?? true,
    washWW: $("washWW")?.checked ?? true,
    colourBy: $("colourBy")?.value || "phase",
    crystMin: Number($("crystMin")?.value ?? -Infinity),
    crystMax: Number($("crystMax")?.value ?? Infinity),
    protMin: Number($("protMin")?.value ?? -Infinity),
    protMax: Number($("protMax")?.value ?? Infinity)
  };
}

export function filterPoints(points, filters) {
  return points.filter((p) => {
    const sid = String(p.id || "").toLowerCase();
    const phaseRaw = String(p.phase || "").trim();
    const phaseLower = phaseRaw.toLowerCase();
    const detectedLower = String(p.detected_phases || "").toLowerCase();
    const conc = Number(p.concentration);
    const cryst = Number(p.crystallinity);
    const prot = Number(p.protein_ratio);
    const wash = normaliseWash(p);

    if (
      filters.search &&
      !sid.includes(filters.search) &&
      !phaseLower.includes(filters.search) &&
      !detectedLower.includes(filters.search)
    ) return false;

    if (filters.selectedPhases.length && !filters.selectedPhases.includes(phaseRaw)) return false;
    if (filters.selectedLayers.length && !filters.selectedLayers.includes(conc)) return false;

    if (filters.washEW || filters.washWW) {
      if (wash === "EW" && !filters.washEW) return false;
      if (wash === "WW" && !filters.washWW) return false;
    }

    if (Number.isFinite(cryst) && (cryst < filters.crystMin || cryst > filters.crystMax)) return false;
    if (Number.isFinite(prot) && (prot < filters.protMin || prot > filters.protMax)) return false;

    return true;
  });
}