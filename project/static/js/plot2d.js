import {
  PHASE_COLORS,
  AMORPHOUS_BASE_COLOR,
  SAMPLE_MARKER_SIZE_2D,
  CRYSTAL_CORE_MIN_SIZE_2D
} from "./constants.js";
import { $ } from "./dom.js";
import {
  normalisePhase,
  displayPhase,
  numericOrNull,
  formatValShort,
  escapeHtml
} from "./formatters.js";

const WARM_SCALAR_SCALE = [
  [0, "#ffffff"],
  [0.5, "#f2c75c"],
  [1, "#c72222"]
];

const SEARCH_MARKER_COLOR = "#d85b72";
const SEARCH_MARKER_CORE_COLOR = "#111111";
const PREDICTED_MARKER_SCALE = 0.76;

function clearPlotContainer(plotDiv) {
  if (!plotDiv) return;
  Plotly.purge?.(plotDiv);
  plotDiv.replaceChildren();
  plotDiv.textContent = "";
}

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

function pointScaleFactor(point) {
  if (!point?.is_predicted) return 1;
  if (point?.is_intermediate_layer) return PREDICTED_MARKER_SCALE * 1.18;
  return PREDICTED_MARKER_SCALE;
}

function baseMarkerSize2D(point) {
  return SAMPLE_MARKER_SIZE_2D * pointScaleFactor(point);
}

function coreMarkerSize2D(point) {
  return crystallinityToCoreSize2D(point.crystallinity) * pointScaleFactor(point);
}

function pointOpacity2D(point, isPhaseBase = false) {
  if (!point?.is_predicted) {
    return isPhaseBase ? getAmorphousBaseOpacity() : 0.95;
  }

  if (point?.is_intermediate_layer) {
    return isPhaseBase ? 0.6 : 0.92;
  }

  return isPhaseBase ? 0.42 : 0.8;
}

function ternaryCartesianCoords(point) {
  const rawX = point?.x;
  const rawY = point?.y;
  const hasStoredCoords =
    rawX !== null &&
    rawX !== undefined &&
    rawX !== "" &&
    rawY !== null &&
    rawY !== undefined &&
    rawY !== "";

  const storedX = Number(rawX);
  const storedY = Number(rawY);
  if (hasStoredCoords && Number.isFinite(storedX) && Number.isFinite(storedY)) {
    return { x: storedX, y: storedY };
  }

  const metal = Number(point?.metal);
  const ligand = Number(point?.ligand);
  const bsa = Number(point?.bsa);
  const total = metal + ligand + bsa;

  if (!Number.isFinite(total) || total <= 0) {
    return { x: NaN, y: NaN };
  }

  const ll = ligand / total;
  const bb = bsa / total;

  return {
    x: ll + 0.5 * bb,
    y: (Math.sqrt(3) / 2) * bb
  };
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

function scalarBoundsForMode(colourBy) {
  if (
    PHASE_PROBABILITY_MODES[colourBy] ||
    colourBy === "crystallinity" ||
    colourBy === "crystallinity_uncertainty" ||
    colourBy === "protein_ratio"
  ) {
    return { cmin: 0, cmax: 1 };
  }

  if (colourBy === "ee_error") {
    return { cmin: 0, cmax: undefined };
  }

  if (colourBy === "lc_percent") {
    return { cmin: 0, cmax: 100 };
  }

  return { cmin: undefined, cmax: undefined };
}

function crystallinityToCoreSize2D(c) {
  const v = Math.max(0, Math.min(1, Number(c) || 0));
  return CRYSTAL_CORE_MIN_SIZE_2D + (SAMPLE_MARKER_SIZE_2D - CRYSTAL_CORE_MIN_SIZE_2D) * Math.sqrt(v);
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

function formatHoverLine(label, value) {
  return `<span style="color:#7a8594;">${escapeHtml(label)}</span> ${escapeHtml(value)}`;
}

function buildPointHoverText(p) {
  const composition =
    `M ${formatValShort(p.metal, 1)}% | ` +
    `L ${formatValShort(p.ligand, 1)}% | ` +
    `BSA ${formatValShort(p.bsa, 1)}%`;
  const layer = `${formatValShort(p.concentration, 1)} mg mL^-1`;
  const phase = displayPhase(p.phase || p.primary_phase || "N/A");
  const wash = p.washing || p.wash || "N/A";
  const ee = numericOrNull(p.ee);
  const sourceLabel = p.is_predicted
    ? `Predicted grid | ${p.trust_band || "prototype"}`
    : "Measured sample";

  return (
    `<span style="font-size:14px;"><b>${escapeHtml(p.id)}</b></span><br>` +
    `<span style="color:#7a8594;">${escapeHtml(sourceLabel)}</span><br>` +
    `<span style="color:#20242a;">${escapeHtml(composition)}</span><br>` +
    `${formatHoverLine("Layer", layer)}<br>` +
    `${formatHoverLine("Wash", wash)}<br>` +
    `${formatHoverLine("Phase", phase)}<br>` +
    `${formatHoverLine("EE", ee == null ? "N/A" : formatValShort(ee, 2))}`
  );
}

const hoverLabelStyle = {
  bgcolor: "rgba(255,255,255,0.96)",
  bordercolor: "#d9dde3",
  font: { color: "#20242a", size: 13 }
};

function markerForSearchPosition2D(searchPosition, layer) {
  if (!searchPosition) return null;
  if (Number(searchPosition.concentration) !== Number(layer)) return null;

  const total =
    Number(searchPosition.metal) +
    Number(searchPosition.ligand) +
    Number(searchPosition.bsa);

  if (!Number.isFinite(total) || total <= 0) return null;

  const hovertemplate =
    `You are here<br>` +
    `Metal: ${formatValShort(searchPosition.metal, 1)} %<br>` +
    `Ligand: ${formatValShort(searchPosition.ligand, 1)} %<br>` +
    `BSA: ${formatValShort(searchPosition.bsa, 1)} %<br>` +
    `Concentration: ${formatValShort(searchPosition.concentration, 1)} mg mL^-1<extra></extra>`;

  return [
    {
      type: "scatterternary",
      mode: "markers",
      a: [Number(searchPosition.metal)],
      b: [Number(searchPosition.ligand)],
      c: [Number(searchPosition.bsa)],
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 28,
        color: "rgba(216, 91, 114, 0.12)",
        line: { width: 0, color: "rgba(0,0,0,0)" }
      }
    },
    {
      type: "scatterternary",
      mode: "markers",
      a: [Number(searchPosition.metal)],
      b: [Number(searchPosition.ligand)],
      c: [Number(searchPosition.bsa)],
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 20,
        color: "rgba(216, 91, 114, 0.2)",
        line: { width: 0, color: "rgba(0,0,0,0)" }
      }
    },
    {
      type: "scatterternary",
      mode: "markers+text",
      a: [Number(searchPosition.metal)],
      b: [Number(searchPosition.ligand)],
      c: [Number(searchPosition.bsa)],
      text: ["You are here"],
      textposition: "top center",
      hovertemplate,
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.96)",
        bordercolor: SEARCH_MARKER_COLOR,
        font: { color: "#20242a", size: 13 }
      },
      marker: {
        size: 12,
        color: SEARCH_MARKER_CORE_COLOR,
        symbol: "circle",
        line: { width: 2, color: "#ffffff" }
      },
      textfont: { size: 13, color: "#2e3947" },
      showlegend: false
    }
  ];
}

function markerForSearchPosition2DFallback(searchPosition, layer) {
  if (!searchPosition) return null;
  if (Number(searchPosition.concentration) !== Number(layer)) return null;

  const metal = Number(searchPosition.metal);
  const ligand = Number(searchPosition.ligand);
  const bsa = Number(searchPosition.bsa);
  const total = metal + ligand + bsa;

  if (!Number.isFinite(total) || total <= 0) return null;

  const mm = metal / total;
  const ll = ligand / total;
  const bb = bsa / total;

  const x = ll + 0.5 * bb;
  const y = (Math.sqrt(3) / 2) * bb;

  const hovertemplate =
    `You are here<br>` +
    `Metal: ${formatValShort(metal, 1)} %<br>` +
    `Ligand: ${formatValShort(ligand, 1)} %<br>` +
    `BSA: ${formatValShort(bsa, 1)} %<br>` +
    `Concentration: ${formatValShort(searchPosition.concentration, 1)} mg mL^-1<extra></extra>`;

  return [
    {
      type: "scatter",
      mode: "markers",
      x: [x],
      y: [y],
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 28,
        color: "rgba(216, 91, 114, 0.12)",
        line: { width: 0, color: "rgba(0,0,0,0)" }
      }
    },
    {
      type: "scatter",
      mode: "markers",
      x: [x],
      y: [y],
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 20,
        color: "rgba(216, 91, 114, 0.2)",
        line: { width: 0, color: "rgba(0,0,0,0)" }
      }
    },
    {
      type: "scatter",
      mode: "markers+text",
      x: [x],
      y: [y],
      text: ["You are here"],
      textposition: "top center",
      hovertemplate,
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.96)",
        bordercolor: SEARCH_MARKER_COLOR,
        font: { color: "#20242a", size: 13 }
      },
      marker: {
        size: 12,
        color: SEARCH_MARKER_CORE_COLOR,
        symbol: "circle",
        line: { width: 2, color: "#ffffff" }
      },
      textfont: { size: 13, color: "#2e3947" },
      showlegend: false
    }
  ];
}

export function renderPlot2D(points, colourBy, onPointClick, searchPosition = null) {
  const plotDiv = $("plot");
  if (!plotDiv) return;

  const layerFocus = $("layerFocus")?.value || "";
  const availableLayers = [...new Set(points.map((p) => Number(p.concentration)).filter((v) => Number.isFinite(v)))]
    .sort((a, b) => b - a);

  if (!availableLayers.length) {
    clearPlotContainer(plotDiv);
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points match the current filters.</div>`;
    return;
  }

  const layer = layerFocus ? Number(layerFocus) : availableLayers[0];
  const layerPoints = points.filter((p) => Number(p.concentration) === layer);

  if (!layerPoints.length) {
    clearPlotContainer(plotDiv);
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points found for this layer.</div>`;
    return;
  }
  return renderPlot2DFallback(layerPoints, colourBy, layer, onPointClick, searchPosition);
}

function renderPlot2DFallback(layerPoints, colourBy, layer, onPointClick, searchPosition = null) {
  const plotDiv = $("plot");

  let markerColor = "#9c9c9c";
  let colorscale = WARM_SCALAR_SCALE;
  let showscale = false;
  let colorbar = undefined;

  if (colourBy === "phase") {
    markerColor = layerPoints.map((p) => {
      const key = normalisePhase(p.phase);
      return PHASE_COLORS[key] || "#111111";
    });
    colorscale = undefined;
  } else if (colourBy === "ee") {
    markerColor = layerPoints.map((p) => numericOrNull(p.ee));
    showscale = true;
    colorbar = { title: "Encapsulation efficiency" };
  } else if (colourBy === "lc_percent") {
    markerColor = layerPoints.map((p) => numericOrNull(p.lc_percent));
    showscale = true;
    colorbar = { title: "Loading capacity" };
  } else if (colourBy === "ee_error") {
    markerColor = layerPoints.map((p) => numericOrNull(p.ee_error ?? p.ee_std));
    colorscale = WARM_SCALAR_SCALE;
    showscale = true;
    colorbar = { title: "EE standard deviation" };
  } else if (colourBy === "crystallinity") {
    markerColor = layerPoints.map((p) => numericOrNull(p.crystallinity));
    showscale = true;
    colorbar = { title: "Crystallinity" };
  } else if (colourBy === "crystallinity_uncertainty") {
    markerColor = layerPoints.map((p) =>
      numericOrNull(
        p.crystallinity_uncertainty ??
        p.crystallinity_std ??
        p.amorphousness_std
      )
    );
    colorscale = WARM_SCALAR_SCALE;
    showscale = true;
    colorbar = { title: "Crystallinity standard deviation" };
  } else if (colourBy === "protein_ratio") {
    markerColor = layerPoints.map((p) => numericOrNull(p.protein_ratio));
    showscale = true;
    colorbar = { title: "Estimated ATR ratio" };
  } else if (PHASE_PROBABILITY_MODES[colourBy]) {
    markerColor = layerPoints.map((p) => scalarValueForMode(p, colourBy));
    showscale = true;
    colorbar = { title: PHASE_PROBABILITY_MODES[colourBy].title };
  }

  const isPhaseView = colourBy === "phase";
  const amorphousBaseOpacity = getAmorphousBaseOpacity();
  const scalarBounds = scalarBoundsForMode(colourBy);
  const coords = layerPoints.map(ternaryCartesianCoords);

  const baseTrace = {
    type: "scatter",
    mode: "markers",
    x: coords.map((p) => p.x),
    y: coords.map((p) => p.y),
    customdata: layerPoints.map((p) => (p.is_predicted ? null : p.id)),
    text: layerPoints.map(buildPointHoverText),
    hovertemplate: "%{text}<extra></extra>",
    hoverlabel: hoverLabelStyle,
    marker: {
      size: layerPoints.map(baseMarkerSize2D),
      opacity: layerPoints.map((p) => p?.is_predicted ? pointOpacity2D(p, true) : amorphousBaseOpacity),
      color: AMORPHOUS_BASE_COLOR,
      line: { width: 0.3, color: "rgba(50,50,50,0.20)" }
    },
    showlegend: false
  };

  const colorTrace = {
    type: "scatter",
    mode: "markers",
    x: coords.map((p) => p.x),
    y: coords.map((p) => p.y),
    customdata: layerPoints.map((p) => (p.is_predicted ? null : p.id)),
    text: layerPoints.map(buildPointHoverText),
    hovertemplate: "%{text}<extra></extra>",
    hoverlabel: hoverLabelStyle,
    marker: {
      size: isPhaseView
        ? layerPoints.map(coreMarkerSize2D)
        : layerPoints.map(baseMarkerSize2D),
      opacity: layerPoints.map((p) => pointOpacity2D(p, false)),
      color: isPhaseView
        ? layerPoints.map(blendPhaseColor)
        : markerColor,
      colorscale: isPhaseView ? undefined : colorscale,
      showscale: isPhaseView ? false : showscale,
      colorbar: isPhaseView ? undefined : colorbar,
      cmin: isPhaseView ? undefined : scalarBounds.cmin,
      cmax: isPhaseView ? undefined : scalarBounds.cmax,
      line: { width: isPhaseView ? 0 : 0.3, color: "rgba(50,50,50,0.20)" }
    },
    showlegend: false
  };

  const searchTrace = markerForSearchPosition2DFallback(searchPosition, layer);
  const pointTraces = isPhaseView ? [baseTrace, colorTrace] : [colorTrace];
  const traces = searchTrace ? [...pointTraces, ...searchTrace] : pointTraces;

  const layout = {
    margin: { l: 40, r: 40, t: 40, b: 40 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    annotations: [
      { x: 0.5, y: 1.06, xref: "paper", yref: "paper", text: `Layer ${layer}`, showarrow: false, font: { size: 18, color: "#333" } },
      { x: 0.02, y: 0.02, xref: "paper", yref: "paper", text: "Metal", showarrow: false, font: { size: 16, color: "#333" } },
      { x: 0.98, y: 0.02, xref: "paper", yref: "paper", text: "Ligand", showarrow: false, font: { size: 16, color: "#333" } },
      { x: 0.5, y: 0.96, xref: "paper", yref: "paper", text: "BSA", showarrow: false, font: { size: 16, color: "#333" } }
    ],
    xaxis: { visible: false, range: [-0.1, 1.1] },
    yaxis: { visible: false, range: [-0.08, 0.95], scaleanchor: "x", scaleratio: 1 },
    shapes: [{
      type: "path",
      path: `M 0 0 L 1 0 L 0.5 ${Math.sqrt(3) / 2} Z`,
      xref: "x",
      yref: "y",
      line: { color: "rgba(25,25,25,0.45)", width: 2 },
      fillcolor: "rgba(0,0,0,0)"
    }],
    showlegend: false,
    uirevision: "stay2d"
  };

  Plotly.react(plotDiv, traces, layout, { responsive: true, displaylogo: false });

  plotDiv.removeAllListeners?.("plotly_click");
  plotDiv.on("plotly_click", async (ev) => {
    const sampleId = ev.points?.[0]?.customdata;
    if (sampleId) await onPointClick(sampleId);
  });
}
