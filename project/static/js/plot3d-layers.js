import { BASE_LAYER_Z } from "./constants.js";

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