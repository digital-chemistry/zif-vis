import {
  PHASE_COLORS,
  AMORPHOUS_BASE_COLOR,
  SAMPLE_MARKER_SIZE_3D,
  CRYSTAL_CORE_MIN_SIZE_3D
} from "./constants.js";
import { $ } from "./dom.js";
import {
  normalisePhase,
  numericOrNull,
  formatValShort,
  escapeHtml,
  ternaryXYFromPoint
} from "./formatters.js";
import { TRI_H, concentrationToInterpolatedZ } from "./plot3d-geometry.js";

function get3DMarkerScale() {
  const v = Number($("markerScale3D")?.value ?? 1.8);
  return Number.isFinite(v) && v > 0 ? v : 1.8;
}

function get3DSearchMarkerScale() {
  return Math.max(1.2, get3DMarkerScale() * 0.8);
}

function crystallinityToCoreSize3D(c) {
  const v = Math.max(0, Math.min(1, Number(c) || 0));
  const baseSize =
    CRYSTAL_CORE_MIN_SIZE_3D +
    (SAMPLE_MARKER_SIZE_3D - CRYSTAL_CORE_MIN_SIZE_3D) * Math.sqrt(v);

  return baseSize * get3DMarkerScale();
}

function blendPhaseColor(p) {
  const phaseComp = p.phase_composition || {};
  const entries = Object.entries(phaseComp)
    .map(([name, obj]) => [normalisePhase(name), Number(obj?.mean ?? obj ?? 0)])
    .filter(([, value]) => Number.isFinite(value) && value > 0);

  if (!entries.length) return PHASE_COLORS.unknown || "#8B8B8B";

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return PHASE_COLORS.unknown || "#8B8B8B";

  let r = 0, g = 0, b = 0;

  for (const [key, value] of entries) {
    const hex = PHASE_COLORS[key] || PHASE_COLORS.unknown || "#8B8B8B";
    const w = value / total;
    const rr = parseInt(hex.slice(1, 3), 16);
    const gg = parseInt(hex.slice(3, 5), 16);
    const bb = parseInt(hex.slice(5, 7), 16);
    r += rr * w;
    g += gg * w;
    b += bb * w;
  }

  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function formatMeanPm(mean, err, digits = 2) {
  const m = numericOrNull(mean);
  const e = numericOrNull(err);

  if (m == null) return "N/A";
  if (e == null) return formatValShort(m, digits);

  return `${formatValShort(m, digits)} ± ${formatValShort(e, digits)}`;
}

function summarizeMaterial(p) {
  const phaseComp = p.phase_composition || {};
  const entries = Object.entries(phaseComp)
    .map(([name, obj]) => {
      const mean = Number(obj?.mean ?? obj);
      const std = numericOrNull(obj?.std);
      return [name, mean, std];
    })
    .filter(([, mean]) => Number.isFinite(mean) && mean > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) return "No crystalline phase assignment";

  return entries
    .slice(0, 2)
    .map(([name, mean, std]) => {
      const pct = mean * 100;
      const pctStd = std == null ? null : std * 100;
      return `${name}: ${formatMeanPm(pct, pctStd, 1)}% of crystalline part`;
    })
    .join("; ");
}

function buildHoverText(p) {
  const m = Number(p.metal);
  const l = Number(p.ligand);
  const b = Number(p.bsa);
  const conc = Number(p.concentration);
  const wash = String(p.washing || p.wash || "N/A");

  const eeMean = numericOrNull(p.ee);
  const eeErr = numericOrNull(p.ee_error ?? p.error_bar ?? p.ee_std);

  const crystMean = numericOrNull(p.crystallinity);
  const crystStd = numericOrNull(p.crystallinity_std);

  const amorphMean = numericOrNull(p.amorphousness);
  const amorphStd = numericOrNull(p.amorphousness_std);

  return (
    `<b>${escapeHtml(p.id)}</b><br>` +
    `Metal: ${formatValShort(m, 1)} %<br>` +
    `Ligand: ${formatValShort(l, 1)} %<br>` +
    `BSA: ${formatValShort(b, 1)} %<br>` +
    `Concentration: ${formatValShort(conc, 1)} mg mL⁻¹<br>` +
    `Wash: ${escapeHtml(wash)}<br>` +
    `EE: ${formatMeanPm(eeMean, eeErr, 2)}<br>` +
    `Crystalline fraction: ${formatMeanPm(crystMean, crystStd, 3)}<br>` +
    `Amorphous fraction: ${formatMeanPm(amorphMean, amorphStd, 3)}<br>` +
    `Material summary: ${escapeHtml(summarizeMaterial(p))}`
  );
}

function getMarkerStyle(points, colourBy) {
  if (colourBy === "phase") {
    return {
      color: points.map((p) => {
        const key = normalisePhase(p.phase);
        return PHASE_COLORS[key] || "#111111";
      }),
      colorscale: undefined,
      showscale: false,
      colorbar: undefined
    };
  }

  if (colourBy === "ee") {
    return {
      color: points.map((p) => numericOrNull(p.ee)),
      colorscale: "RdBu",
      showscale: true,
      colorbar: { title: "EE%" }
    };
  }

  if (colourBy === "crystallinity") {
    return {
      color: points.map((p) => numericOrNull(p.crystallinity)),
      colorscale: "RdBu",
      showscale: true,
      colorbar: { title: "Crystalline fraction" }
    };
  }

  if (colourBy === "protein_ratio") {
    return {
      color: points.map((p) => numericOrNull(p.protein_ratio)),
      colorscale: "RdBu",
      showscale: true,
      colorbar: { title: "Estimated ratio" }
    };
  }

  return {
    color: "#7e7e7e",
    colorscale: undefined,
    showscale: false,
    colorbar: undefined
  };
}

export function buildPointTraces(points, concToZ, colourBy) {
  const markerStyle = getMarkerStyle(points, colourBy);

  const xs = points.map((p) => ternaryXYFromPoint(p).x);
  const ys = points.map((p) => ternaryXYFromPoint(p).y);
  const zs = points.map((p) => concToZ.get(Number(p.concentration)) ?? 0);
  const ids = points.map((p) => p.id);
  const texts = points.map(buildHoverText);

  const baseTrace = {
    type: "scatter3d",
    mode: "markers",
    x: xs,
    y: ys,
    z: zs,
    customdata: ids,
    text: texts,
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: SAMPLE_MARKER_SIZE_3D * get3DMarkerScale(),
      opacity: 0.95,
      color: AMORPHOUS_BASE_COLOR,
      line: { width: 0.25, color: "rgba(70,70,70,0.18)" }
    },
    showlegend: false
  };

  const coreTrace = {
    type: "scatter3d",
    mode: "markers",
    x: xs,
    y: ys,
    z: zs,
    customdata: ids,
    text: texts,
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: points.map((p) => crystallinityToCoreSize3D(p.crystallinity)),
      opacity: 0.95,
      color: colourBy === "phase"
        ? points.map(blendPhaseColor)
        : markerStyle.color,
      colorscale: colourBy === "phase" ? undefined : markerStyle.colorscale,
      showscale: colourBy === "phase" ? false : markerStyle.showscale,
      colorbar: colourBy === "phase" ? undefined : markerStyle.colorbar,
      line: { width: 0 }
    },
    showlegend: false
  };

  return [baseTrace, coreTrace];
}

export function markerForSearchPosition3D(searchPosition, concToZ) {
  if (!searchPosition) return null;

  const metal = Number(searchPosition.metal);
  const ligand = Number(searchPosition.ligand);
  const bsa = Number(searchPosition.bsa);
  const concentration = Number(searchPosition.concentration);

  if (![metal, ligand, bsa, concentration].every(Number.isFinite)) return null;
  if ([metal, ligand, bsa].some((v) => v < 0 || v > 100)) return null;

  const total = metal + ligand + bsa;
  if (!Number.isFinite(total) || Math.abs(total - 100) > 0.25) return null;

  const x = ligand / total + 0.5 * (bsa / total);
  const y = TRI_H * (bsa / total);

  let z = concentrationToInterpolatedZ(concentration, concToZ);
  if (!Number.isFinite(z)) z = 0;

  return {
    type: "scatter3d",
    mode: "markers+text",
    x: [x],
    y: [y],
    z: [z],
    text: ["You are here"],
    textposition: "top center",
    hovertemplate:
      `You are here<br>` +
      `Metal: ${formatValShort(metal, 1)} %<br>` +
      `Ligand: ${formatValShort(ligand, 1)} %<br>` +
      `BSA: ${formatValShort(bsa, 1)} %<br>` +
      `Concentration: ${formatValShort(concentration, 1)} mg mL⁻¹<extra></extra>`,
    marker: {
      size: 9 * get3DSearchMarkerScale(),
      color: "#111111",
      symbol: "diamond",
      line: { width: 2, color: "#ffffff" }
    }
  };
}