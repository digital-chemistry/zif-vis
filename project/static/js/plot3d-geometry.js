import { numericOrNull } from "./formatters.js";

export const SQRT3 = Math.sqrt(3);
export const TRI_H = SQRT3 / 2;

export const TRIANGLE = {
  A: { x: 0.0, y: 0.0 },
  B: { x: 1.0, y: 0.0 },
  C: { x: 0.5, y: TRI_H },
  centroid: { x: 0.5, y: TRI_H / 3 }
};

export const ARROW_STYLE = {
  headLen: 0.045,
  wing: 0.02,
  width: 4,
  colours: {
    ligand: "rgba(102, 116, 132, 0.84)",
    metal: "rgba(210, 126, 114, 0.84)",
    bsa: "rgba(115, 191, 132, 0.84)"
  }
};

export const EDGE_STYLE = {
  base: "rgba(102, 116, 132, 0.42)",
  left: "rgba(210, 126, 114, 0.42)",
  right: "rgba(115, 191, 132, 0.42)"
};

export function vec(from, to) {
  return { x: to.x - from.x, y: to.y - from.y };
}

export function len(v) {
  return Math.hypot(v.x, v.y);
}

export function unit(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}

export function add(point, direction, scale = 1) {
  return {
    x: point.x + direction.x * scale,
    y: point.y + direction.y * scale
  };
}

export function midpoint(p1, p2) {
  return {
    x: 0.5 * (p1.x + p2.x),
    y: 0.5 * (p1.y + p2.y)
  };
}

export function ternaryPoint(m, l, b) {
  const total = m + l + b;
  if (!total) return { x: 0, y: 0 };

  const ll = l / total;
  const bb = b / total;

  return {
    x: ll + 0.5 * bb,
    y: TRI_H * bb
  };
}

export function inwardNormalForSide(p1, p2) {
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

export function insetParallelSegment(
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

export function concentrationToInterpolatedZ(concentration, concToZ) {
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
