import { BASE_LAYER_Z } from "./constants.js";

export function getOrderedLayers(points) {
  const found = [...new Set(
    points.map((p) => Number(p.concentration)).filter((v) => Number.isFinite(v))
  )];
  return found.sort((a, b) => a - b);
}

export function buildLayerZMap(orderedLayers, spacingScale) {
  const zMap = new Map();
  const knownBaseLayers = Object.keys(BASE_LAYER_Z)
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  orderedLayers.forEach((layer, i) => {
    if (BASE_LAYER_Z[layer] !== undefined) {
      zMap.set(layer, BASE_LAYER_Z[layer] * spacingScale);
      return;
    }

    let placed = false;
    for (let idx = 0; idx < knownBaseLayers.length - 1; idx++) {
      const c1 = knownBaseLayers[idx];
      const c2 = knownBaseLayers[idx + 1];

      if (layer > c1 && layer < c2) {
        const z1 = BASE_LAYER_Z[c1];
        const z2 = BASE_LAYER_Z[c2];
        const t = (layer - c1) / (c2 - c1);
        zMap.set(layer, (z1 + (z2 - z1) * t) * spacingScale);
        placed = true;
        break;
      }
    }

    if (!placed) {
      zMap.set(layer, i * 1.1 * spacingScale);
    }
  });

  return zMap;
}
