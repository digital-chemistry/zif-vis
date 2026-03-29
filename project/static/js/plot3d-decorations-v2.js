import {
  TRIANGLE,
  ARROW_STYLE,
  EDGE_STYLE,
  ternaryPoint,
  insetParallelSegment,
  add,
  unit,
  vec,
  midpoint
} from "./plot3d-geometry.js";

const LAYER_PLANE_COLORS = [
  "rgba(255, 255, 255, 0.22)",
  "rgba(250, 250, 251, 0.18)",
  "rgba(246, 247, 248, 0.14)",
  "rgba(242, 243, 245, 0.11)",
  "rgba(238, 239, 241, 0.08)"
];

function makeLineTrace(coords, color, width = 5) {
  return {
    type: "scatter3d",
    mode: "lines",
    x: coords.x,
    y: coords.y,
    z: coords.z,
    hoverinfo: "skip",
    line: { color, width },
    showlegend: false
  };
}

function makeTextTrace(x, y, z, text, textposition, font) {
  return {
    type: "scatter3d",
    mode: "text",
    x,
    y,
    z,
    text,
    textposition,
    hoverinfo: "skip",
    showlegend: false,
    textfont: font
  };
}

function makeMarkerTextTrace(x, y, z, text, textposition, marker, font) {
  return {
    type: "scatter3d",
    mode: "markers+text",
    x,
    y,
    z,
    text,
    textposition,
    hoverinfo: "skip",
    showlegend: false,
    marker,
    textfont: font
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
    showlegend: false,
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
    showlegend: false,
    line: { color, width: ARROW_STYLE.width }
  });

  traces.push({
    type: "scatter3d",
    mode: "lines",
    x: [end.x, wing2.x],
    y: [end.y, wing2.y],
    z: [z, z],
    hoverinfo: "skip",
    showlegend: false,
    line: { color, width: ARROW_STYLE.width }
  });
}

function formatLayerLabel(layer) {
  const n = Number(layer);
  if (!Number.isFinite(n)) return String(layer);
  return Number.isInteger(n) ? `${n} mg mL^-1` : `${n.toFixed(1)} mg mL^-1`;
}

export function buildLayerPlanes(orderedLayers, concToZ) {
  const { A, B, C } = TRIANGLE;

  return orderedLayers.map((layer, index) => {
    const z = concToZ.get(layer);
    return {
      type: "mesh3d",
      x: [A.x, B.x, C.x],
      y: [A.y, B.y, C.y],
      z: [z, z, z],
      i: [0],
      j: [1],
      k: [2],
      color: LAYER_PLANE_COLORS[index] || LAYER_PLANE_COLORS[LAYER_PLANE_COLORS.length - 1],
      opacity: 1,
      hoverinfo: "skip",
      showscale: false
    };
  });
}

export function buildTriangleEdges(orderedLayers, concToZ) {
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

export function buildTriangleGrid(orderedLayers, concToZ) {
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
    showlegend: false,
    line: { color: "rgba(65, 74, 86, 0.12)", width: 2 }
  };
}

export function buildInterlayerGuides3D(orderedLayers, concToZ) {
  if (orderedLayers.length < 2) return [];

  const anchors = [];
  const step = 0.1;

  for (let metal = 0; metal <= 1.0001; metal += step) {
    for (let ligand = 0; ligand <= 1.0001 - metal; ligand += step) {
      const bsa = 1 - metal - ligand;
      if (bsa < -1e-9) continue;
      anchors.push(ternaryPoint(metal, ligand, Math.max(0, bsa)));
    }
  }

  const traces = [];

  for (let i = 0; i < orderedLayers.length - 1; i++) {
    const z1 = concToZ.get(orderedLayers[i]);
    const z2 = concToZ.get(orderedLayers[i + 1]);
    const intermediateSteps = 5;

    anchors.forEach((anchor, idx) => {
      const x = [];
      const y = [];
      const z = [];

      for (let j = 1; j < intermediateSteps; j++) {
        const t = j / intermediateSteps;
        x.push(anchor.x);
        y.push(anchor.y);
        z.push(z1 + (z2 - z1) * t);
      }

      traces.push({
        type: "scatter3d",
        mode: "markers",
        x,
        y,
        z,
        hoverinfo: "skip",
        showlegend: false,
        marker: {
          size: idx % 2 === 0 ? 2.8 : 2.2,
          color: "rgba(95, 111, 133, 0.42)",
          line: { width: 0, color: "rgba(0,0,0,0)" }
        }
      });
    });
  }

  return traces;
}

export function buildLayerLabels3D(orderedLayers, concToZ) {
  const x = [];
  const y = [];
  const z = [];
  const text = [];

  orderedLayers.forEach((layer) => {
    x.push(1.125);
    y.push(0.02);
    z.push(concToZ.get(layer));
    text.push(formatLayerLabel(layer));
  });

  return makeMarkerTextTrace(
    x,
    y,
    z,
    text,
    "middle right",
    {
      size: 10,
      color: "rgba(255,255,255,0.92)",
      line: { width: 1.5, color: "rgba(55, 66, 80, 0.32)" },
      symbol: "circle"
    },
    {
      size: 12,
      color: "#2f3946"
    }
  );
}

export function buildConcentrationGuide3D(orderedLayers, concToZ) {
  if (!orderedLayers.length) return [];

  const x = 1.03;
  const y = 0.06;
  const zValues = orderedLayers.map((layer) => concToZ.get(layer));
  const zMin = Math.min(...zValues);
  const zMax = Math.max(...zValues);
  const midZ = zValues[Math.floor(zValues.length / 2)];

  return [
    {
      type: "scatter3d",
      mode: "lines",
      x: [x, x],
      y: [y, y],
      z: [zMin, zMax],
      hoverinfo: "skip",
      showlegend: false,
      line: { color: "rgba(40, 49, 61, 0.22)", width: 5 }
    },
    {
      type: "scatter3d",
      mode: "markers",
      x: orderedLayers.map(() => x),
      y: orderedLayers.map(() => y),
      z: zValues,
      hoverinfo: "skip",
      showlegend: false,
      marker: {
        size: 5,
        color: "rgba(48, 57, 69, 0.7)",
        line: { width: 1, color: "rgba(255,255,255,0.85)" }
      }
    },
    makeTextTrace(
      [1.115],
      [0.09],
      [midZ],
      ["Concentration"],
      "middle right",
      { size: 12, color: "#424c59" }
    )
  ];
}

export function buildPerLayerDirectionArrows3D(orderedLayers, concToZ) {
  if (!orderedLayers.length) return [];

  const { A, B, C } = TRIANGLE;

  const ligandArrow = insetParallelSegment(A, B, 0.028, 0.16, 0.16, false);
  const metalArrow = insetParallelSegment(A, C, 0.032, 0.16, 0.16, true);
  const bsaArrow = insetParallelSegment(B, C, 0.032, 0.16, 0.16, false);

  const traces = [];
  const frontLayer = orderedLayers[0];
  const z = (concToZ.get(frontLayer) ?? 0) + 0.012;

  addArrowTrace(traces, ligandArrow.start, ligandArrow.end, z, ARROW_STYLE.colours.ligand);
  addArrowTrace(traces, metalArrow.start, metalArrow.end, z, ARROW_STYLE.colours.metal);
  addArrowTrace(traces, bsaArrow.start, bsaArrow.end, z, ARROW_STYLE.colours.bsa);

  return traces;
}

export function buildSideLabels3D(orderedLayers, concToZ) {
  if (!orderedLayers.length) return [];

  const frontLayer = orderedLayers[0];
  const z = (concToZ.get(frontLayer) ?? 0) - 0.012;

  const { A, B, C } = TRIANGLE;
  const leftAnchor = midpoint(A, C);
  const baseAnchor = midpoint(A, B);
  const rightAnchor = midpoint(B, C);

  const axisTrace = makeTextTrace(
    [leftAnchor.x - 0.115, baseAnchor.x, rightAnchor.x + 0.115],
    [leftAnchor.y + 0.005, baseAnchor.y - 0.11, rightAnchor.y + 0.005],
    [z, z, z],
    ["Metal", "Ligand", "BSA"],
    ["middle left", "top center", "middle right"],
    { size: 16, color: "#111111" }
  );

  const tickTrace = makeTextTrace(
    [
      A.x - 0.055,
      B.x + 0.055,
      C.x,
      baseAnchor.x,
      leftAnchor.x - 0.035,
      rightAnchor.x + 0.035
    ],
    [
      A.y - 0.012,
      B.y - 0.012,
      C.y + 0.042,
      baseAnchor.y - 0.055,
      leftAnchor.y - 0.018,
      rightAnchor.y - 0.018
    ],
    [z, z, z, z, z, z],
    ["100%", "100%", "100%", "50%", "50%", "50%"],
    [
      "middle left",
      "middle right",
      "top center",
      "top center",
      "middle left",
      "middle right"
    ],
    { size: 10, color: "#5a6572" }
  );

  return [axisTrace, tickTrace];
}
