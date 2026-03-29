import { BASE_LAYER_Z, PHASE_COLORS } from "./constants.js";
import { $, } from "./dom.js";
import {
  normalisePhase,
  displayPhase,
  numericOrNull,
  formatValShort,
  escapeHtml,
  ternaryXYFromPoint
} from "./formatters.js";

export function getOrderedLayers(points) {
  const found = [...new Set(points.map(p => Number(p.concentration)).filter(v => Number.isFinite(v)))];
  const preferred = [12.5, 25, 50, 75, 100];
  const ordered = preferred.filter(v => found.includes(v));
  const extras = found.filter(v => !preferred.includes(v)).sort((a, b) => a - b);
  return [...ordered, ...extras];
}

export function buildLayerZMap(orderedLayers, spacingScale) {
  const zMap = new Map();

  orderedLayers.forEach((layer, i) => {
    if (BASE_LAYER_Z[layer] !== undefined) {
      zMap.set(layer, BASE_LAYER_Z[layer] * spacingScale);
    } else {
      zMap.set(layer, i * 1.1 * spacingScale);
    }
  });

  return zMap;
}

function ternaryPoint(m, l, b) {
  return {
    x: l + 0.5 * b,
    y: (Math.sqrt(3) / 2) * b
  };
}

function buildLayerPlanes(orderedLayers, concToZ) {
  return orderedLayers.map(layer => {
    const z = concToZ.get(layer);
    return {
      type: "mesh3d",
      x: [0, 1, 0.5],
      y: [0, 0, Math.sqrt(3) / 2],
      z: [z, z, z],
      i: [0],
      j: [1],
      k: [2],
      color: "#7f8da3",
      opacity: 0.025,
      hoverinfo: "skip",
      showscale: false
    };
  });
}

function buildTriangleEdges(orderedLayers, concToZ) {
  const A = [0, 0];
  const B = [1, 0];
  const C = [0.5, Math.sqrt(3) / 2];

  const xs = [];
  const ys = [];
  const zs = [];

  orderedLayers.forEach(layer => {
    const z = concToZ.get(layer);
    xs.push(A[0], B[0], null, B[0], C[0], null, C[0], A[0], null);
    ys.push(A[1], B[1], null, B[1], C[1], null, C[1], A[1], null);
    zs.push(z, z, null, z, z, null, z, z, null);
  });

  return {
    type: "scatter3d",
    mode: "lines",
    x: xs,
    y: ys,
    z: zs,
    hoverinfo: "skip",
    line: { color: "rgba(90,90,90,0.32)", width: 4 }
  };
}

function buildTriangleGrid(orderedLayers, concToZ) {
  const xs = [];
  const ys = [];
  const zs = [];
  const levels = [0.25, 0.5, 0.75];

  orderedLayers.forEach(layer => {
    const z = concToZ.get(layer);

    levels.forEach(t => {
      const y = (Math.sqrt(3) / 2) * t;
      const x1 = 0.5 * t;
      const x2 = 1 - 0.5 * t;
      xs.push(x1, x2, null);
      ys.push(y, y, null);
      zs.push(z, z, null);

      const p1 = ternaryPoint(1 - t, t, 0);
      const p2 = ternaryPoint(0, t, 1 - t);
      xs.push(p1.x, p2.x, null);
      ys.push(p1.y, p2.y, null);
      zs.push(z, z, null);

      const q1 = ternaryPoint(t, 1 - t, 0);
      const q2 = ternaryPoint(t, 0, 1 - t);
      xs.push(q1.x, q2.x, null);
      ys.push(q1.y, q2.y, null);
      zs.push(z, z, null);
    });
  });

  return {
    type: "scatter3d",
    mode: "lines",
    x: xs,
    y: ys,
    z: zs,
    hoverinfo: "skip",
    line: { color: "rgba(140,140,140,0.13)", width: 2 }
  };
}

function buildCornerLabels3D(orderedLayers, concToZ) {
  const topLayer = orderedLayers.length ? orderedLayers[orderedLayers.length - 1] : 100;
  const topZ = concToZ.get(topLayer) ?? 0;

  return {
    type: "scatter3d",
    mode: "text",
    x: [-0.14, 1.12, 0.5],
    y: [-0.09, -0.09, Math.sqrt(3) / 2 + 0.15],
    z: [topZ - 0.45, topZ - 0.15, topZ + 0.08],
    text: ["Metal", "Ligand", "BSA"],
    textposition: ["middle left", "middle right", "top center"],
    hoverinfo: "skip",
    textfont: { size: 15, color: "#2f2f2f" }
  };
}

export function renderPlot3D(points, colourBy, currentCamera, onCameraChange, onPointClick) {
  const plotDiv = $("plot");
  if (!plotDiv) return;

  if (!points.length) {
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points match the current filters.</div>`;
    return;
  }

  const spacingScale = Number($("spacingScale")?.value || 0.75);
  const orderedLayers = getOrderedLayers(points);
  const concToZ = buildLayerZMap(orderedLayers, spacingScale);

  const planeTraces = buildLayerPlanes(orderedLayers, concToZ);
  const edgeTrace = buildTriangleEdges(orderedLayers, concToZ);
  const gridTrace = buildTriangleGrid(orderedLayers, concToZ);
  const cornerTrace = buildCornerLabels3D(orderedLayers, concToZ);

  let markerColor = "#9c9c9c";
  let colorscale = "RdBu";
  let showscale = false;
  let colorbar = undefined;

  if (colourBy === "phase") {
    markerColor = points.map(p => {
      const key = normalisePhase(p.phase);
      return PHASE_COLORS[key] || "#111111";
    });
    colorscale = undefined;
  } else if (colourBy === "ee") {
    markerColor = points.map(p => numericOrNull(p.ee));
    showscale = true;
    colorbar = { title: "EE%" };
  } else if (colourBy === "crystallinity") {
    markerColor = points.map(p => numericOrNull(p.crystallinity));
    showscale = true;
    colorbar = { title: "Relative crystallinity" };
  } else if (colourBy === "protein_ratio") {
    markerColor = points.map(p => numericOrNull(p.protein_ratio));
    showscale = true;
    colorbar = { title: "Protein ratio" };
  }

  const pointTrace = {
    type: "scatter3d",
    mode: "markers",
    x: points.map(p => ternaryXYFromPoint(p).x),
    y: points.map(p => ternaryXYFromPoint(p).y),
    z: points.map(p => concToZ.get(Number(p.concentration)) ?? 0),
    customdata: points.map(p => p.id),
    text: points.map(p =>
      `<b>${escapeHtml(p.id)}</b><br>` +
      `Primary phase: ${escapeHtml(displayPhase(p.phase))}<br>` +
      `Detected phases: ${escapeHtml(p.detected_phases || "N/A")}<br>` +
      `Wash: ${escapeHtml(p.washing || p.wash || "N/A")}<br>` +
      `Conc: ${formatValShort(p.concentration)}<br>` +
      `EE: ${formatValShort(p.ee)}<br>` +
      `Relative crystallinity: ${formatValShort(p.crystallinity)}<br>` +
      `Protein ratio: ${formatValShort(p.protein_ratio)}`
    ),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: 5.5,
      opacity: 0.84,
      color: markerColor,
      colorscale,
      showscale,
      colorbar,
      line: { width: 0.25, color: "rgba(70,70,70,0.18)" }
    }
  };

  const maxZ = orderedLayers.length
    ? Math.max(...orderedLayers.map(v => concToZ.get(v) || 0))
    : 1;

  const layout = {
    margin: { l: 0, r: 0, t: 10, b: 0 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    uirevision: "stay",
    scene: {
      xaxis: { visible: false, showbackground: false, showgrid: false, zeroline: false, range: [-0.22, 1.18] },
      yaxis: { visible: false, showbackground: false, showgrid: false, zeroline: false, range: [-0.14, 1.04] },
      zaxis: {
        title: "Concentration",
        tickvals: orderedLayers.map(v => concToZ.get(v)),
        ticktext: orderedLayers.map(v => String(v)),
        showgrid: false,
        zeroline: false,
        showbackground: false
      },
      camera: currentCamera || { eye: { x: 1.3, y: -1.8, z: 1.1 } },
      aspectmode: "manual",
      aspectratio: { x: 1.05, y: 0.95, z: Math.max(1.65, maxZ * 0.5) }
    },
    showlegend: false
  };

  Plotly.react(
    plotDiv,
    [...planeTraces, gridTrace, edgeTrace, cornerTrace, pointTrace],
    layout,
    { responsive: true, displaylogo: false }
  );

  plotDiv.removeAllListeners?.("plotly_relayout");
  plotDiv.removeAllListeners?.("plotly_click");

  plotDiv.on("plotly_relayout", (ev) => {
    if (ev["scene.camera"]) onCameraChange(ev["scene.camera"]);
  });

  plotDiv.on("plotly_click", async (ev) => {
    const sampleId = ev.points?.[0]?.customdata;
    if (sampleId) await onPointClick(sampleId);
  });
}