const SLICE_AXES = ["metal", "ligand", "bsa"];

function normaliseAxis(axis) {
  return SLICE_AXES.includes(axis) ? axis : "metal";
}

function pointAxisValue(point, axis) {
  const value = Number(point?.[axis]);
  return Number.isFinite(value) ? value : null;
}

function uniqueAxisValues(points, axis) {
  return [...new Set(
    points
      .map((point) => pointAxisValue(point, axis))
      .filter((value) => value != null)
  )].sort((a, b) => a - b);
}

function snapToNearest(values, target) {
  if (!values.length) return null;
  const numericTarget = Number(target);
  if (!Number.isFinite(numericTarget)) return values[0];

  return values.reduce((best, value) => {
    if (best == null) return value;
    return Math.abs(value - numericTarget) < Math.abs(best - numericTarget)
      ? value
      : best;
  }, null);
}

export function applyCompositionSlice(points, sliceState) {
  if (!sliceState || sliceState.mode === "off" || !Array.isArray(points) || !points.length) {
    return Array.isArray(points) ? points : [];
  }

  const axisA = normaliseAxis(sliceState.axisA);
  const valuesA = uniqueAxisValues(points, axisA);
  const snappedA = snapToNearest(valuesA, sliceState.valueA);
  if (snappedA == null) return [];

  let sliced = points.filter((point) => pointAxisValue(point, axisA) === snappedA);

  if (sliceState.mode === "line") {
    let axisB = normaliseAxis(sliceState.axisB);
    if (axisB === axisA) {
      axisB = SLICE_AXES.find((axis) => axis !== axisA) || "ligand";
    }

    const valuesB = uniqueAxisValues(sliced.length ? sliced : points, axisB);
    const snappedB = snapToNearest(valuesB, sliceState.valueB);
    if (snappedB == null) return [];

    sliced = sliced.filter((point) => pointAxisValue(point, axisB) === snappedB);
  }

  return sliced;
}
