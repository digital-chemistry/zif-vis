import { BASE_LAYER_Z, PHASE_COLORS, PHASE_LABELS } from "./constants.js";
import { $ } from "./dom.js";
import {
  normalisePhase,
  numericOrNull,
  formatValShort,
  escapeHtml,
  ternaryXYFromPoint
} from "./formatters.js";

/* =========================
 * Geometry
 * ========================= */

const SQRT3 = Math.sqrt(3);
const TRI_H = SQRT3 / 2;

const TRIANGLE = {
  A: { x: 0.0, y: 0.0 },       // Metal 100
  B: { x: 1.0, y: 0.0 },       // Ligand 100
  C: { x: 0.5, y: TRI_H },     // BSA 100
  centroid: { x: 0.5, y: TRI_H / 3 }
};

const ARROW_STYLE = {
  headLen: 0.06,
  wing: 0.028,
  width: 5,
  colours: {
    ligand: "rgba(110,110,110,0.75)",
    metal: "rgba(210,120,120,0.75)",
    bsa: "rgba(110,200,120,0.78)"
  }
};

const EDGE_STYLE = {
  base: "rgba(110,110,110,0.65)",
  left: "rgba(210,120,120,0.55)",
  right: "rgba(110,200,120,0.55)"
};

function vec(from, to) {
  return { x: to.x - from.x, y: to.y - from.y };
}

function len(v) {
  return Math.hypot(v.x, v.y);
}

function unit(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}

function add(point, direction, scale = 1) {
  return {
    x: point.x + direction.x * scale,
    y: point.y + direction.y * scale
  };
}

function midpoint(p1, p2) {
  return {
    x: 0.5 * (p1.x + p2.x),
    y: 0.5 * (p1.y + p2.y)
  };
}

function ternaryPoint(m, l, b) {
  const total = m + l + b;
  if (!total) return { x: 0, y: 0 };

  const ll = l / total;
  const bb = b / total;

  return {
    x: ll + 0.5 * bb,
    y: TRI_H * bb
  };
}

function inwardNormalForSide(p1, p2) {
  const d = unit(vec(p1, p2));
  const n1 = { x: -d.y, y: d.x };
  const n2 = { x: d.y, y: -d.x };

  const m = midpoint(p1, p2);

  const d1 = Math.hypot(
    TRIANGLE.centroid.x - (m.x + n1.x),
    TRIANGLE.centroid.y - (m.y + n1.y)
  );
  const d2 = Math.hypot(
    TRIANGLE.centroid.x - (m.x + n2.x),
    TRIANGLE.centroid.y - (m.y + n2.y)
  );

  return d1 < d2 ? n1 : n2;
}

function insetParallelSegment(
  p1,
  p2,
  inset = 0.055,
  trimStart = 0.09,
  trimEnd = 0.09,
  reverse = false
) {
  const d = unit(vec(p1, p2));
  const n = inwardNormalForSide(p1, p2);

  const start = add(add(p1, d, trimStart), n, inset);
  const end = add(add(p2, d, -trimEnd), n, inset);

  return reverse ? { start: end, end: start } : { start, end };
}

/* =========================
 * Overlay helpers
 * ========================= */

function updatePhaseLegend(colourBy) {
  const el = $("plotPhaseLegend") || $("phaseLegend");
  if (!el) return;

  if (colourBy !== "phase") {
    el.classList.add("is-hidden");
    el.innerHTML = "";
    return;
  }

  const entries = Object.entries(PHASE_COLORS)
    .filter(([key]) => key !== "unknown")
    .map(([key, color]) => {
      const label = PHASE_LABELS?.[key] || key;
      return `
        <div class="phase-legend-row">
          <span class="phase-legend-swatch" style="background:${color};"></span>
          <span class="phase-legend-label">${escapeHtml(label)}</span>
        </div>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="phase-legend-title">Phase</div>
    ${entries}
  `;

  el.classList.remove("is-hidden");
}

function updateTernaryInset() {
  const el = $("ternaryInset");
  if (!el) return;
  el.style.display = "block";
}

/* =========================
 * Layer helpers
 * ========================= */

export function getOrderedLayers(points) {
  const found = [...new Set(
    points.map((p) => Number(p.concentration)).filter((v) => Number.isFinite(v))
  )];

  const preferred = [12.5, 25, 50, 75, 100];
  const ordered = preferred.filter((v) => found.includes(v));
  const extras = found.filter((v) => !preferred.includes(v)).sort((a, b) => a - b);

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

function concentrationToInterpolatedZ(concentration, concToZ) {
  const c = Number(concentration);
  if (!Number.isFinite(c)) return null;

  const knownLayers = [...concToZ.keys()]
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!knownLayers.length) return null;

  const exact = concToZ.get(c);
  if (Number.isFinite(exact)) return exact;

  if (c <= knownLayers[0]) {
    if (knownLayers.length === 1) return concToZ.get(knownLayers[0]) ?? 0;
    const c1 = knownLayers[0];
    const c2 = knownLayers[1];
    const z1 = concToZ.get(c1);
    const z2 = concToZ.get(c2);
    if (!Number.isFinite(z1) || !Number.isFinite(z2) || c2 === c1) return z1 ?? 0;
    return z1 + ((c - c1) / (c2 - c1)) * (z2 - z1);
  }

  if (c >= knownLayers[knownLayers.length - 1]) {
    if (knownLayers.length === 1) return concToZ.get(knownLayers[0]) ?? 0;
    const c1 = knownLayers[knownLayers.length - 2];
    const c2 = knownLayers[knownLayers.length - 1];
    const z1 = concToZ.get(c1);
    const z2 = concToZ.get(c2);
    if (!Number.isFinite(z1) || !Number.isFinite(z2) || c2 === c1) return z2 ?? 0;
    return z1 + ((c - c1) / (c2 - c1)) * (z2 - z1);
  }

  for (let i = 0; i < knownLayers.length - 1; i++) {
    const c1 = knownLayers[i];
    const c2 = knownLayers[i + 1];

    if (c >= c1 && c <= c2) {
      const z1 = concToZ.get(c1);
      const z2 = concToZ.get(c2);
      if (!Number.isFinite(z1) || !Number.isFinite(z2) || c2 === c1) {
        return z1 ?? z2 ?? 0;
      }
      return z1 + ((c - c1) / (c2 - c1)) * (z2 - z1);
    }
  }

  return null;
}

/* =========================
 * Decorative traces
 * ========================= */

function buildLayerPlanes(orderedLayers, concToZ) {
  const { A, B, C } = TRIANGLE;

  return orderedLayers.map((layer) => {
    const z = concToZ.get(layer);
    return {
      type: "mesh3d",
      x: [A.x, B.x, C.x],
      y: [A.y, B.y, C.y],
      z: [z, z, z],
      i: [0],
      j: [1],
      k: [2],
      color: "#7f8da3",
      opacity: 0.03,
      hoverinfo: "skip",
      showscale: false
    };
  });
}

function buildTriangleEdges(orderedLayers, concToZ) {
  const { A, B, C } = TRIANGLE;

  const edgeBase = { x: [], y: [], z: [] };
  const edgeLeft = { x: [], y: [], z: [] };
  const edgeRight = { x: [], y: [], z: [] };

  orderedLayers.forEach((layer) => {
    const z = concToZ.get(layer);

    edgeBase.x.push(A.x, B.x, null);
    edgeBase.y.push(A.y, B.y, null);
    edgeBase.z.push(z, z, null);

    edgeLeft.x.push(A.x, C.x, null);
    edgeLeft.y.push(A.y, C.y, null);
    edgeLeft.z.push(z, z, null);

    edgeRight.x.push(B.x, C.x, null);
    edgeRight.y.push(B.y, C.y, null);
    edgeRight.z.push(z, z, null);
  });

  return [
    makeLineTrace(edgeBase, EDGE_STYLE.base),
    makeLineTrace(edgeLeft, EDGE_STYLE.left),
    makeLineTrace(edgeRight, EDGE_STYLE.right)
  ];
}

function buildTriangleGrid(orderedLayers, concToZ) {
  const xs = [];
  const ys = [];
  const zs = [];
  const levels = [0.25, 0.5, 0.75];

  orderedLayers.forEach((layer) => {
    const z = concToZ.get(layer);

    levels.forEach((t) => {
      const constantBsa1 = ternaryPoint(1 - t, 0, t);
      const constantBsa2 = ternaryPoint(0, 1 - t, t);
      pushSegment(xs, ys, zs, constantBsa1, constantBsa2, z);

      const constantLig1 = ternaryPoint(1 - t, t, 0);
      const constantLig2 = ternaryPoint(0, t, 1 - t);
      pushSegment(xs, ys, zs, constantLig1, constantLig2, z);

      const constantMet1 = ternaryPoint(t, 1 - t, 0);
      const constantMet2 = ternaryPoint(t, 0, 1 - t);
      pushSegment(xs, ys, zs, constantMet1, constantMet2, z);
    });
  });

  return {
    type: "scatter3d",
    mode: "lines",
    x: xs,
    y: ys,
    z: zs,
    hoverinfo: "skip",
    line: { color: "rgba(150,150,150,0.12)", width: 2 }
  };
}

function buildLayerLabels3D(orderedLayers, concToZ) {
  const x = [];
  const y = [];
  const z = [];
  const text = [];

  orderedLayers.forEach((layer) => {
    x.push(-0.12);
    y.push(0.035);
    z.push(concToZ.get(layer));
    text.push(`${layer} mg mL⁻¹`);
  });

  return {
    type: "scatter3d",
    mode: "text",
    x,
    y,
    z,
    text,
    textposition: "middle left",
    hoverinfo: "skip",
    textfont: { size: 12, color: "#4d4d4d" }
  };
}

function buildConcentrationGuide3D(orderedLayers, concToZ) {
  if (!orderedLayers.length) return [];

  const minZ = Math.min(...orderedLayers.map((v) => concToZ.get(v) ?? 0));
  const maxZ = Math.max(...orderedLayers.map((v) => concToZ.get(v) ?? 0));

  return [
    {
      type: "scatter3d",
      mode: "lines",
      x: [-0.22, -0.22],
      y: [0.02, 0.02],
      z: [minZ - 0.2, maxZ + 0.2],
      hoverinfo: "skip",
      line: { color: "rgba(70,70,70,0.72)", width: 6 }
    },
    {
      type: "scatter3d",
      mode: "text",
      x: [-0.34],
      y: [0.03],
      z: [(minZ + maxZ) / 2],
      text: ["Concentration [mg mL⁻¹]"],
      textposition: "middle left",
      hoverinfo: "skip",
      textfont: { size: 14, color: "#2f2f2f" }
    }
  ];
}

function buildPerLayerDirectionArrows3D(orderedLayers, concToZ) {
  const { A, B, C } = TRIANGLE;

  const ligandArrow = insetParallelSegment(A, B, 0.03, 0.10, 0.10, false);
  const metalArrow = insetParallelSegment(A, C, 0.035, 0.10, 0.10, true);
  const bsaArrow = insetParallelSegment(B, C, 0.035, 0.10, 0.10, false);

  const traces = [];

  orderedLayers.forEach((layer) => {
    const z = concToZ.get(layer);

    addArrowTrace(traces, ligandArrow.start, ligandArrow.end, z, ARROW_STYLE.colours.ligand);
    addArrowTrace(traces, metalArrow.start, metalArrow.end, z, ARROW_STYLE.colours.metal);
    addArrowTrace(traces, bsaArrow.start, bsaArrow.end, z, ARROW_STYLE.colours.bsa);
  });

  return traces;
}

function buildSideLabels3D(orderedLayers, concToZ) {
  if (!orderedLayers.length) return null;

  const midLayer = orderedLayers[Math.floor(orderedLayers.length / 2)];
  const z = (concToZ.get(midLayer) ?? 0) - 0.03;

  return {
    type: "scatter3d",
    mode: "text",
    x: [0.10, 0.50, 0.90],
    y: [0.34, -0.065, 0.34],
    z: [z, z, z],
    text: ["Metal [%]", "Ligand [%]", "BSA [%]"],
    textposition: ["middle left", "top center", "middle right"],
    hoverinfo: "skip",
    textfont: { size: 14, color: "#3b3b3b" }
  };
}

function makeLineTrace(coords, color, width = 5) {
  return {
    type: "scatter3d",
    mode: "lines",
    x: coords.x,
    y: coords.y,
    z: coords.z,
    hoverinfo: "skip",
    line: { color, width }
  };
}

function pushSegment(xs, ys, zs, p1, p2, z) {
  xs.push(p1.x, p2.x, null);
  ys.push(p1.y, p2.y, null);
  zs.push(z, z, null);
}

function addArrowTrace(traces, start, end, z, color) {
  traces.push({
    type: "scatter3d",
    mode: "lines",
    x: [start.x, end.x],
    y: [start.y, end.y],
    z: [z, z],
    hoverinfo: "skip",
    line: { color, width: ARROW_STYLE.width }
  });

  const d = unit(vec(start, end));
  const n = { x: -d.y, y: d.x };

  const base = add(end, d, -ARROW_STYLE.headLen);
  const wing1 = add(base, n, ARROW_STYLE.wing);
  const wing2 = add(base, n, -ARROW_STYLE.wing);

  traces.push({
    type: "scatter3d",
    mode: "lines",
    x: [end.x, wing1.x],
    y: [end.y, wing1.y],
    z: [z, z],
    hoverinfo: "skip",
    line: { color, width: ARROW_STYLE.width }
  });

  traces.push({
    type: "scatter3d",
    mode: "lines",
    x: [end.x, wing2.x],
    y: [end.y, wing2.y],
    z: [z, z],
    hoverinfo: "skip",
    line: { color, width: ARROW_STYLE.width }
  });
}

/* =========================
 * Hover and search traces
 * ========================= */

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

function markerForSearchPosition3D(searchPosition, concToZ) {
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
      size: 9,
      color: "#111111",
      symbol: "diamond",
      line: { width: 2, color: "#ffffff" }
    }
  };
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

function buildPointTrace(points, concToZ, colourBy) {
  const markerStyle = getMarkerStyle(points, colourBy);

  return {
    type: "scatter3d",
    mode: "markers",
    x: points.map((p) => ternaryXYFromPoint(p).x),
    y: points.map((p) => ternaryXYFromPoint(p).y),
    z: points.map((p) => concToZ.get(Number(p.concentration)) ?? 0),
    customdata: points.map((p) => p.id),
    text: points.map(buildHoverText),
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      size: 5.8,
      opacity: 0.86,
      color: markerStyle.color,
      colorscale: markerStyle.colorscale,
      showscale: markerStyle.showscale,
      colorbar: markerStyle.colorbar,
      line: { width: 0.25, color: "rgba(70,70,70,0.18)" }
    }
  };
}

/* =========================
 * Layout
 * ========================= */

function buildLayout(currentCamera) {
  return {
    margin: { l: 10, r: 10, t: 10, b: 10 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    uirevision: null,
    scene: {
      xaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.20, 1.08]
      },
      yaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.08, TRI_H + 0.08]
      },
      zaxis: {
        title: "",
        showticklabels: false,
        showgrid: false,
        zeroline: false,
        showbackground: false
      },
      camera: currentCamera || {
        eye: { x: 1.55, y: -1.55, z: 1.05 },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 0, z: 0 },
        projection: { type: "orthographic" }
      },
      aspectmode: "manual",
      aspectratio: {
        x: 1.0,
        y: TRI_H,
        z: 2.4
      }
    },
    annotations: [
      {
        xref: "paper",
        yref: "paper",
        x: 0.02,
        y: 0.98,
        text: "Stacked ternary maps across concentration levels",
        showarrow: false,
        font: { size: 12, color: "#6c645d" },
        align: "left"
      }
    ],
    showlegend: false
  };
}

/* =========================
 * Public renderer
 * ========================= */

export function renderPlot3D(
  points,
  colourBy,
  currentCamera,
  onCameraChange,
  onPointClick,
  searchPosition = null
) {
  const plotDiv = $("plot");
  if (!plotDiv) return;

  if (!points.length) {
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points match the current filters.</div>`;
    updateTernaryInset();
    updatePhaseLegend(colourBy);
    return;
  }

  const spacingScale = Number($("spacingScale")?.value || 0.2);
  const orderedLayers = getOrderedLayers(points);
  const concToZ = buildLayerZMap(orderedLayers, spacingScale);

  const searchMarker = markerForSearchPosition3D(searchPosition, concToZ);

  const traces = [
    ...buildLayerPlanes(orderedLayers, concToZ),
    buildTriangleGrid(orderedLayers, concToZ),
    ...buildTriangleEdges(orderedLayers, concToZ),
    buildLayerLabels3D(orderedLayers, concToZ),
    ...buildConcentrationGuide3D(orderedLayers, concToZ),
    ...buildPerLayerDirectionArrows3D(orderedLayers, concToZ),
    buildSideLabels3D(orderedLayers, concToZ),
    buildPointTrace(points, concToZ, colourBy),
    ...(searchMarker ? [searchMarker] : [])
  ].filter(Boolean);

  Plotly.react(
    plotDiv,
    traces,
    buildLayout(currentCamera),
    { responsive: true, displaylogo: false }
  );

  updateTernaryInset();
  updatePhaseLegend(colourBy);

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