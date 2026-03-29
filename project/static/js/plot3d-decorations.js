import {
  TRIANGLE,
  TRI_H,
  ARROW_STYLE,
  EDGE_STYLE,
  ternaryPoint,
  insetParallelSegment,
  add,
  unit,
  vec,
  midpoint
} from "./plot3d-geometry.js";

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
  return Number.isInteger(n) ? `${n} mg mL⁻¹` : `${n.toFixed(1)} mg mL⁻¹`;
}

export function buildLayerPlanes(orderedLayers, concToZ) {
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
    line: { color: "rgba(150,150,150,0.12)", width: 2 }
  };
}

export function buildLayerLabels3D(orderedLayers, concToZ) {
  const x = [];
  const y = [];
  const z = [];
  const text = [];

  orderedLayers.forEach((layer) => {
    x.push(-0.285);
    y.push(0.02);
    z.push(concToZ.get(layer));
    text.push(formatLayerLabel(layer));
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
    showlegend: false,
    textfont: {
      size: 13,
      color: "#4d4d4d"
    }
  };
}

export function buildConcentrationGuide3D() {
  return [];
}

export function buildPerLayerDirectionArrows3D(orderedLayers, concToZ) {
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

export function buildSideLabels3D(orderedLayers, concToZ) {
  if (!orderedLayers.length) return null;

  const midLayer = orderedLayers[Math.floor(orderedLayers.length / 2)];
  const z = (concToZ.get(midLayer) ?? 0) - 0.03;

  const { A, B, C } = TRIANGLE;
  const leftMid = midpoint(A, C);
  const baseMid = midpoint(A, B);
  const rightMid = midpoint(B, C);

  return {
    type: "scatter3d",
    mode: "text",
    x: [leftMid.x - 0.08, baseMid.x, rightMid.x + 0.08],
    y: [leftMid.y, baseMid.y - 0.095, rightMid.y],
    z: [z, z, z],
    text: ["Metal [%]", "Ligand [%]", "BSA [%]"],
    textposition: ["middle left", "top center", "middle right"],
    hoverinfo: "skip",
    showlegend: false,
    textfont: { size: 14, color: "#3b3b3b" }
  };
}