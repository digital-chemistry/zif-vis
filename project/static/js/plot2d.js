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

function markerForSearchPosition2D(searchPosition, layer) {
  if (!searchPosition) return null;
  if (Number(searchPosition.concentration) !== Number(layer)) return null;

  const total =
    Number(searchPosition.metal) +
    Number(searchPosition.ligand) +
    Number(searchPosition.bsa);

  if (!Number.isFinite(total) || total <= 0) return null;

  return {
    type: "scatterternary",
    mode: "markers+text",
    a: [Number(searchPosition.metal)],
    b: [Number(searchPosition.ligand)],
    c: [Number(searchPosition.bsa)],
    text: ["You are here"],
    textposition: "top center",
    hovertemplate: "You are here<extra></extra>",
    marker: {
      size: 14,
      color: "#111111",
      symbol: "diamond",
      line: { width: 2, color: "#ffffff" }
    }
  };
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

  return {
    type: "scatter",
    mode: "markers+text",
    x: [x],
    y: [y],
    text: ["You are here"],
    textposition: "top center",
    hovertemplate: "You are here<extra></extra>",
    marker: {
      size: 14,
      color: "#111111",
      symbol: "diamond",
      line: { width: 2, color: "#ffffff" }
    }
  };
}

export function renderPlot2D(points, colourBy, onPointClick, searchPosition = null) {
  const plotDiv = $("plot");
  if (!plotDiv) return;

  const layerFocus = $("layerFocus")?.value || "";
  const availableLayers = [...new Set(points.map(p => Number(p.concentration)).filter(v => Number.isFinite(v)))]
    .sort((a, b) => b - a);

  if (!availableLayers.length) {
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points match the current filters.</div>`;
    return;
  }

  const layer = layerFocus ? Number(layerFocus) : availableLayers[0];
  const layerPoints = points.filter(p => Number(p.concentration) === layer);

  if (!layerPoints.length) {
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points found for this layer.</div>`;
    return;
  }

  const realTernary = layerPoints.every(p =>
    Number.isFinite(Number(p.metal)) &&
    Number.isFinite(Number(p.ligand)) &&
    Number.isFinite(Number(p.bsa))
  );

  if (!realTernary) {
    return renderPlot2DFallback(layerPoints, colourBy, layer, onPointClick, searchPosition);
  }

  let markerColor = "#9c9c9c";
  let colorscale = "RdBu";
  let showscale = false;
  let colorbar = undefined;

  if (colourBy === "phase") {
    markerColor = layerPoints.map(p => {
      const key = normalisePhase(p.phase);
      return PHASE_COLORS[key] || "#111111";
    });
    colorscale = undefined;
  } else if (colourBy === "ee") {
    markerColor = layerPoints.map(p => numericOrNull(p.ee));
    showscale = true;
    colorbar = { title: "EE%" };
  } else if (colourBy === "crystallinity") {
    markerColor = layerPoints.map(p => numericOrNull(p.crystallinity));
    showscale = true;
    colorbar = { title: "Crystallinity" };
  } else if (colourBy === "protein_ratio") {
    markerColor = layerPoints.map(p => numericOrNull(p.protein_ratio));
    showscale = true;
    colorbar = { title: "Protein ratio" };
  }

  const baseTrace = {
    type: "scatterternary",
    mode: "markers",
    a: layerPoints.map(p => Number(p.metal)),
    b: layerPoints.map(p => Number(p.ligand)),
    c: layerPoints.map(p => Number(p.bsa)),
    customdata: layerPoints.map(p => p.id),
    text: layerPoints.map(p =>
      `<b>${escapeHtml(p.id)}</b><br>` +
      `Primary phase: ${escapeHtml(displayPhase(p.phase))}<br>` +
      `Detected phases: ${escapeHtml(p.detected_phases || "N/A")}<br>` +
      `Washing: ${escapeHtml(p.washing || p.wash || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}<br>` +
      `EE: ${formatValShort(p.ee)}<br>` +
      `Crystallinity: ${formatValShort(p.crystallinity)}<br>` +
      `Protein ratio: ${formatValShort(p.protein_ratio)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: SAMPLE_MARKER_SIZE_2D,
      opacity: 0.95,
      color: AMORPHOUS_BASE_COLOR,
      line: { width: 0.3, color: "rgba(50,50,50,0.20)" }
    },
    showlegend: false
  };

  const coreTrace = {
    type: "scatterternary",
    mode: "markers",
    a: layerPoints.map(p => Number(p.metal)),
    b: layerPoints.map(p => Number(p.ligand)),
    c: layerPoints.map(p => Number(p.bsa)),
    customdata: layerPoints.map(p => p.id),
    text: layerPoints.map(p =>
      `<b>${escapeHtml(p.id)}</b><br>` +
      `Primary phase: ${escapeHtml(displayPhase(p.phase))}<br>` +
      `Detected phases: ${escapeHtml(p.detected_phases || "N/A")}<br>` +
      `Washing: ${escapeHtml(p.washing || p.wash || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}<br>` +
      `EE: ${formatValShort(p.ee)}<br>` +
      `Crystallinity: ${formatValShort(p.crystallinity)}<br>` +
      `Protein ratio: ${formatValShort(p.protein_ratio)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: layerPoints.map(p => crystallinityToCoreSize2D(p.crystallinity)),
      opacity: 0.95,
      color: colourBy === "phase"
        ? layerPoints.map(blendPhaseColor)
        : markerColor,
      colorscale: colourBy === "phase" ? undefined : colorscale,
      showscale: colourBy === "phase" ? false : showscale,
      colorbar: colourBy === "phase" ? undefined : colorbar,
      line: { width: 0 }
    },
    showlegend: false
  };

  const searchTrace = markerForSearchPosition2D(searchPosition, layer);
  const traces = searchTrace
    ? [baseTrace, coreTrace, searchTrace]
    : [baseTrace, coreTrace];

  const layout = {
    margin: { l: 40, r: 40, t: 40, b: 40 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    annotations: [{
      x: 0.5,
      y: 1.06,
      xref: "paper",
      yref: "paper",
      text: `Layer ${layer}`,
      showarrow: false,
      font: { size: 18, color: "#333" }
    }],
    ternary: {
      sum: 100,
      bgcolor: "white",
      aaxis: {
        title: { text: "Metal" },
        min: 0,
        ticks: "outside",
        gridcolor: "rgba(140,140,140,0.18)",
        linecolor: "rgba(90,90,90,0.35)"
      },
      baxis: {
        title: { text: "Ligand" },
        min: 0,
        ticks: "outside",
        gridcolor: "rgba(140,140,140,0.18)",
        linecolor: "rgba(90,90,90,0.35)"
      },
      caxis: {
        title: { text: "BSA" },
        min: 0,
        ticks: "outside",
        gridcolor: "rgba(140,140,140,0.18)",
        linecolor: "rgba(90,90,90,0.35)"
      }
    },
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

function renderPlot2DFallback(layerPoints, colourBy, layer, onPointClick, searchPosition = null) {
  const plotDiv = $("plot");

  let markerColor = "#9c9c9c";
  let colorscale = "RdBu";
  let showscale = false;
  let colorbar = undefined;

  if (colourBy === "phase") {
    markerColor = layerPoints.map(p => {
      const key = normalisePhase(p.phase);
      return PHASE_COLORS[key] || "#111111";
    });
    colorscale = undefined;
  } else if (colourBy === "ee") {
    markerColor = layerPoints.map(p => numericOrNull(p.ee));
    showscale = true;
    colorbar = { title: "EE%" };
  } else if (colourBy === "crystallinity") {
    markerColor = layerPoints.map(p => numericOrNull(p.crystallinity));
    showscale = true;
    colorbar = { title: "Crystallinity" };
  } else if (colourBy === "protein_ratio") {
    markerColor = layerPoints.map(p => numericOrNull(p.protein_ratio));
    showscale = true;
    colorbar = { title: "Protein ratio" };
  }

  const baseTrace = {
    type: "scatter",
    mode: "markers",
    x: layerPoints.map(p => Number(p.x)),
    y: layerPoints.map(p => Number(p.y)),
    customdata: layerPoints.map(p => p.id),
    text: layerPoints.map(p =>
      `<b>${escapeHtml(p.id)}</b><br>` +
      `Primary phase: ${escapeHtml(displayPhase(p.phase))}<br>` +
      `Detected phases: ${escapeHtml(p.detected_phases || "N/A")}<br>` +
      `Washing: ${escapeHtml(p.washing || p.wash || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: SAMPLE_MARKER_SIZE_2D,
      opacity: 0.95,
      color: AMORPHOUS_BASE_COLOR,
      line: { width: 0.3, color: "rgba(50,50,50,0.20)" }
    },
    showlegend: false
  };

  const coreTrace = {
    type: "scatter",
    mode: "markers",
    x: layerPoints.map(p => Number(p.x)),
    y: layerPoints.map(p => Number(p.y)),
    customdata: layerPoints.map(p => p.id),
    text: layerPoints.map(p =>
      `<b>${escapeHtml(p.id)}</b><br>` +
      `Primary phase: ${escapeHtml(displayPhase(p.phase))}<br>` +
      `Detected phases: ${escapeHtml(p.detected_phases || "N/A")}<br>` +
      `Washing: ${escapeHtml(p.washing || p.wash || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: layerPoints.map(p => crystallinityToCoreSize2D(p.crystallinity)),
      opacity: 0.95,
      color: colourBy === "phase"
        ? layerPoints.map(blendPhaseColor)
        : markerColor,
      colorscale: colourBy === "phase" ? undefined : colorscale,
      showscale: colourBy === "phase" ? false : showscale,
      colorbar: colourBy === "phase" ? undefined : colorbar,
      line: { width: 0 }
    },
    showlegend: false
  };

  const searchTrace = markerForSearchPosition2DFallback(searchPosition, layer);
  const traces = searchTrace
    ? [baseTrace, coreTrace, searchTrace]
    : [baseTrace, coreTrace];

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
      line: { color: "rgba(90,90,90,0.35)", width: 2 },
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