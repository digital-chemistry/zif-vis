import { PHASE_COLORS } from "./constants.js";
import { $ } from "./dom.js";
import {
  normalisePhase,
  displayPhase,
  numericOrNull,
  formatValShort,
  escapeHtml
} from "./formatters.js";

export function renderPlot2D(points, colourBy, onPointClick) {
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
    return renderPlot2DFallback(layerPoints, colourBy, layer, onPointClick);
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
    colorbar = { title: "Rel. cryst." };
  } else if (colourBy === "protein_ratio") {
    markerColor = layerPoints.map(p => numericOrNull(p.protein_ratio));
    showscale = true;
    colorbar = { title: "Protein ratio" };
  }

  const trace = {
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
      `Wash: ${escapeHtml(p.washing || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}<br>` +
      `EE: ${formatValShort(p.ee)}<br>` +
      `Relative crystallinity: ${formatValShort(p.crystallinity)}<br>` +
      `Protein ratio: ${formatValShort(p.protein_ratio)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: 10,
      opacity: 0.9,
      color: markerColor,
      colorscale,
      showscale,
      colorbar,
      line: { width: 0.3, color: "rgba(50,50,50,0.20)" }
    }
  };

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
      aaxis: { title: { text: "Metal" }, min: 0, ticks: "outside", gridcolor: "rgba(140,140,140,0.18)", linecolor: "rgba(90,90,90,0.35)" },
      baxis: { title: { text: "Ligand" }, min: 0, ticks: "outside", gridcolor: "rgba(140,140,140,0.18)", linecolor: "rgba(90,90,90,0.35)" },
      caxis: { title: { text: "BSA" }, min: 0, ticks: "outside", gridcolor: "rgba(140,140,140,0.18)", linecolor: "rgba(90,90,90,0.35)" }
    },
    showlegend: false,
    uirevision: "stay2d"
  };

  Plotly.react(plotDiv, [trace], layout, { responsive: true, displaylogo: false });

  plotDiv.removeAllListeners?.("plotly_click");
  plotDiv.on("plotly_click", async (ev) => {
    const sampleId = ev.points?.[0]?.customdata;
    if (sampleId) await onPointClick(sampleId);
  });
}

function renderPlot2DFallback(layerPoints, colourBy, layer, onPointClick) {
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
    colorbar = { title: "Rel. cryst." };
  } else if (colourBy === "protein_ratio") {
    markerColor = layerPoints.map(p => numericOrNull(p.protein_ratio));
    showscale = true;
    colorbar = { title: "Protein ratio" };
  }

  const trace = {
    type: "scatter",
    mode: "markers",
    x: layerPoints.map(p => Number(p.x)),
    y: layerPoints.map(p => Number(p.y)),
    customdata: layerPoints.map(p => p.id),
    text: layerPoints.map(p =>
      `<b>${escapeHtml(p.id)}</b><br>` +
      `Primary phase: ${escapeHtml(displayPhase(p.phase))}<br>` +
      `Detected phases: ${escapeHtml(p.detected_phases || "N/A")}<br>` +
      `Wash: ${escapeHtml(p.washing || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: 10,
      opacity: 0.9,
      color: markerColor,
      colorscale,
      showscale,
      colorbar,
      line: { width: 0.3, color: "rgba(50,50,50,0.20)" }
    }
  };

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

  Plotly.react(plotDiv, [trace], layout, { responsive: true, displaylogo: false });

  plotDiv.removeAllListeners?.("plotly_click");
  plotDiv.on("plotly_click", async (ev) => {
    const sampleId = ev.points?.[0]?.customdata;
    if (sampleId) await onPointClick(sampleId);
  });
}