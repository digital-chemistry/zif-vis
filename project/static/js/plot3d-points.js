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

const WARM_SCALAR_SCALE = [
  [0, "#ffffff"],
  [0.5, "#f2c75c"],
  [1, "#c72222"]
];

const SEARCH_MARKER_COLOR = "#d85b72";
const SEARCH_MARKER_CORE_COLOR = "#111111";
const PREDICTED_MARKER_SCALE = 0.72;

const PHASE_PROBABILITY_MODES = {
  phase_prob_amorphous: { title: "Amorphous probability", key: "Amorphous" },
  phase_prob_sodalite: { title: "Sodalite probability", key: "Sodalite" },
  phase_prob_diamondoid: { title: "Diamondoid probability", key: "Diamondoid" },
  phase_prob_u12: { title: "U12 probability", key: "U12" },
  phase_prob_u13: { title: "U13 probability", key: "U13" },
  phase_prob_zif_ec_1: { title: "ZIF-EC-1 probability", key: "ZIF-EC-1" },
  phase_prob_zif_c: { title: "ZIF-C probability", key: "ZIF-C" },
  phase_prob_zif_l: { title: "ZIF-L probability", key: "ZIF-L" }
};

function getAmorphousBaseOpacity() {
  const v = Number($("amorphousOpacity")?.value ?? 0.7);
  return Number.isFinite(v) ? Math.max(0.1, Math.min(1, v)) : 0.7;
}

function get3DMarkerScale() {
  const v = Number($("markerScale3D")?.value ?? 1.8);
  return Number.isFinite(v) && v > 0 ? v : 1.8;
}

function get3DSearchMarkerScale() {
  return Math.max(1.2, get3DMarkerScale() * 0.8);
}

function pointScaleFactor(point) {
  if (!point?.is_predicted) return 1;
  if (point?.is_intermediate_layer) return PREDICTED_MARKER_SCALE * 1.18;
  return PREDICTED_MARKER_SCALE;
}

function baseMarkerSize3D(point) {
  return SAMPLE_MARKER_SIZE_3D * get3DMarkerScale() * pointScaleFactor(point);
}

function coreMarkerSize3D(point) {
  return crystallinityToCoreSize3D(point.crystallinity) * pointScaleFactor(point);
}

function pointOpacity3D(point, isPhaseBase = false) {
  if (!point?.is_predicted) {
    return isPhaseBase ? getAmorphousBaseOpacity() : 0.95;
  }

  if (point?.is_intermediate_layer) {
    return isPhaseBase ? 0.6 : 0.92;
  }

  return isPhaseBase ? 0.42 : 0.8;
}

function scalarValueForMode(point, colourBy) {
  const phaseMode = PHASE_PROBABILITY_MODES[colourBy];
  if (phaseMode) {
    if (phaseMode.key === "Amorphous") {
      return numericOrNull(
        point.amorphousness ??
        point.phase_probabilities?.Amorphous
      );
    }

    const phaseComp = point.phase_composition?.[phaseMode.key];
    return numericOrNull(
      phaseComp?.mean ??
      phaseComp ??
      point.phase_probabilities?.[phaseMode.key]
    );
  }

  return null;
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

  let r = 0;
  let g = 0;
  let b = 0;

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

  return `${formatValShort(m, digits)} +/- ${formatValShort(e, digits)}`;
}

function formatHoverLine(label, value) {
  return `<span style="color:#7a8594;">${escapeHtml(label)}</span> ${escapeHtml(value)}`;
}

function buildHoverText(p) {
  const m = Number(p.metal);
  const l = Number(p.ligand);
  const b = Number(p.bsa);
  const conc = Number(p.concentration);
  const wash = String(p.washing || p.wash || "N/A");
  const phase = String(p.primary_phase || p.phase || "N/A");

  const eeMean = numericOrNull(p.ee);
  const eeErr = numericOrNull(p.ee_error ?? p.error_bar ?? p.ee_std);

  const composition = `M ${formatValShort(m, 1)}% | L ${formatValShort(l, 1)}% | BSA ${formatValShort(b, 1)}%`;
  const concentrationLabel = `${formatValShort(conc, 1)} mg mL^-1`;
  const eeLabel = eeMean == null ? "N/A" : formatMeanPm(eeMean, eeErr, 2);
  const sourceLabel = p.is_predicted
    ? `Predicted grid | ${escapeHtml(p.trust_band || "prototype")}`
    : "Measured sample";

  return (
    `<span style="font-size:14px;"><b>${escapeHtml(p.id)}</b></span><br>` +
    `<span style="color:#7a8594;">${sourceLabel}</span><br>` +
    `<span style="color:#20242a;">${escapeHtml(composition)}</span><br>` +
    `${formatHoverLine("Layer", concentrationLabel)}<br>` +
    `${formatHoverLine("Wash", wash)}<br>` +
    `${formatHoverLine("Phase", phase)}<br>` +
    `${formatHoverLine("EE", eeLabel)}`
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
      colorbar: undefined,
      cmin: undefined,
      cmax: undefined
    };
  }

  const phaseMode = PHASE_PROBABILITY_MODES[colourBy];
  if (phaseMode) {
    return {
      color: points.map((p) => scalarValueForMode(p, colourBy)),
      colorscale: WARM_SCALAR_SCALE,
      showscale: true,
      colorbar: { title: phaseMode.title },
      cmin: 0,
      cmax: 1
    };
  }

  if (colourBy === "ee") {
    return {
      color: points.map((p) => numericOrNull(p.ee)),
      colorscale: WARM_SCALAR_SCALE,
      showscale: true,
      colorbar: { title: "Encapsulation efficiency" },
      cmin: undefined,
      cmax: undefined
    };
  }

  if (colourBy === "ee_error") {
    return {
      color: points.map((p) => numericOrNull(p.ee_error ?? p.ee_std)),
      colorscale: WARM_SCALAR_SCALE,
      showscale: true,
      colorbar: { title: "EE standard deviation" },
      cmin: 0,
      cmax: undefined
    };
  }

  if (colourBy === "crystallinity") {
    return {
      color: points.map((p) => numericOrNull(p.crystallinity)),
      colorscale: WARM_SCALAR_SCALE,
      showscale: true,
      colorbar: { title: "Crystalline fraction" },
      cmin: 0,
      cmax: 1
    };
  }

  if (colourBy === "crystallinity_uncertainty") {
    return {
      color: points.map((p) =>
        numericOrNull(
          p.crystallinity_uncertainty ??
          p.crystallinity_std ??
          p.amorphousness_std
        )
      ),
      colorscale: WARM_SCALAR_SCALE,
      showscale: true,
      colorbar: { title: "Crystallinity standard deviation" },
      cmin: 0,
      cmax: 1
    };
  }

  if (colourBy === "protein_ratio") {
    return {
      color: points.map((p) => numericOrNull(p.protein_ratio)),
      colorscale: WARM_SCALAR_SCALE,
      showscale: true,
      colorbar: { title: "Estimated ATR ratio" },
      cmin: 0,
      cmax: 1
    };
  }

  return {
    color: "#7e7e7e",
    colorscale: undefined,
    showscale: false,
    colorbar: undefined,
    cmin: undefined,
    cmax: undefined
  };
}

const hoverLabelStyle = {
  bgcolor: "rgba(255,255,255,0.96)",
  bordercolor: "#d9dde3",
  font: { color: "#20242a", size: 13 }
};

export function buildPointTraces(points, concToZ, colourBy) {
  const markerStyle = getMarkerStyle(points, colourBy);
  const isPhaseView = colourBy === "phase";
  const amorphousBaseOpacity = getAmorphousBaseOpacity();

  const xs = points.map((p) => ternaryXYFromPoint(p).x);
  const ys = points.map((p) => ternaryXYFromPoint(p).y);
  const zs = points.map((p) => concToZ.get(Number(p.concentration)) ?? 0);
  const ids = points.map((p) => (p.is_predicted ? null : p.id));
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
    hoverlabel: hoverLabelStyle,
    marker: {
      size: points.map(baseMarkerSize3D),
      opacity: points.map((p) => p?.is_predicted ? pointOpacity3D(p, true) : amorphousBaseOpacity),
      color: AMORPHOUS_BASE_COLOR,
      line: { width: 0.25, color: "rgba(70,70,70,0.18)" }
    },
    showlegend: false
  };

  const colorTrace = {
    type: "scatter3d",
    mode: "markers",
    x: xs,
    y: ys,
    z: zs,
    customdata: ids,
    text: texts,
    hovertemplate: "%{text}<extra></extra>",
    hoverlabel: hoverLabelStyle,
    marker: {
      size: isPhaseView
        ? points.map(coreMarkerSize3D)
        : points.map(baseMarkerSize3D),
      opacity: points.map((p) => pointOpacity3D(p, false)),
      color: isPhaseView
        ? points.map(blendPhaseColor)
        : markerStyle.color,
      colorscale: isPhaseView ? undefined : markerStyle.colorscale,
      showscale: isPhaseView ? false : markerStyle.showscale,
      colorbar: isPhaseView ? undefined : markerStyle.colorbar,
      cmin: isPhaseView ? undefined : markerStyle.cmin,
      cmax: isPhaseView ? undefined : markerStyle.cmax,
      line: { width: isPhaseView ? 0 : 0.25, color: "rgba(70,70,70,0.18)" }
    },
    showlegend: false
  };

  return isPhaseView ? [baseTrace, colorTrace] : [colorTrace];
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

  const hovertemplate =
    `You are here<br>` +
    `Metal: ${formatValShort(metal, 1)} %<br>` +
    `Ligand: ${formatValShort(ligand, 1)} %<br>` +
    `BSA: ${formatValShort(bsa, 1)} %<br>` +
    `Concentration: ${formatValShort(concentration, 1)} mg mL^-1<extra></extra>`;

  return [
    {
      type: "scatter3d",
      mode: "markers",
      x: [x],
      y: [y],
      z: [z],
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 22 * get3DSearchMarkerScale(),
        color: "rgba(216, 91, 114, 0.12)",
        line: { width: 0, color: "rgba(0,0,0,0)" }
      }
    },
    {
      type: "scatter3d",
      mode: "markers",
      x: [x],
      y: [y],
      z: [z],
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 15 * get3DSearchMarkerScale(),
        color: "rgba(216, 91, 114, 0.22)",
        line: { width: 0, color: "rgba(0,0,0,0)" }
      }
    },
    {
      type: "scatter3d",
      mode: "markers+text",
      x: [x],
      y: [y],
      z: [z],
      text: ["You are here"],
      textposition: "top center",
      hovertemplate,
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.96)",
        bordercolor: SEARCH_MARKER_COLOR,
        font: { color: "#20242a", size: 13 }
      },
      marker: {
        size: 8.5 * get3DSearchMarkerScale(),
        color: SEARCH_MARKER_CORE_COLOR,
        symbol: "circle",
        line: { width: 2, color: "#ffffff" }
      },
      textfont: { size: 13, color: "#2e3947" },
      showlegend: false
    }
  ];
}
