import { $ } from "./dom.js";
import { updatePhaseLegend, updateTernaryInset } from "./plot3d-overlays.js";
import { getOrderedLayers, buildLayerZMap } from "./plot3d-layers.js";
import {
  buildLayerPlanes,
  buildTriangleGrid,
  buildTriangleEdges,
  buildLayerLabels3D,
  buildConcentrationGuide3D,
  buildPerLayerDirectionArrows3D,
  buildSideLabels3D
} from "./plot3d-decorations-v2.js";
import {
  buildPointTraces,
  markerForSearchPosition3D,
  buildPointSizeUpdate3D,
  buildAmorphousOpacityUpdate3D,
  buildSearchMarkerSizeUpdate3D
} from "./plot3d-points.js";
import { buildLayout } from "./plot3d-layout.js";

export { getOrderedLayers, buildLayerZMap };

const SPACING_ACTUAL_MIN = 0.02;
const SPACING_ACTUAL_MAX = 0.2;

function clearPlotContainer(plotDiv) {
  if (!plotDiv) return;
  Plotly.purge?.(plotDiv);
  plotDiv.replaceChildren();
  plotDiv.textContent = "";
}

function cloneCamera(camera) {
  return camera ? JSON.parse(JSON.stringify(camera)) : null;
}

function getActualSpacingScale() {
  const raw = Number($("spacingScale")?.value ?? 1);
  const normalized = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
  return SPACING_ACTUAL_MIN + normalized * (SPACING_ACTUAL_MAX - SPACING_ACTUAL_MIN);
}

function extractCameraFromRelayoutEvent(ev, fallbackCamera = null) {
  if (!ev || typeof ev !== "object") return fallbackCamera;
  if (ev["scene.camera"]) return cloneCamera(ev["scene.camera"]);

  const base = cloneCamera(fallbackCamera) || {
    eye: { x: 0.0, y: -1.72, z: 0.66 },
    up: { x: 0, y: 0, z: 1 },
    center: { x: 0.0, y: 0.01, z: 0 },
    projection: { type: "orthographic" }
  };

  let changed = false;
  const mappings = [
    ["scene.camera.eye.x", ["eye", "x"]],
    ["scene.camera.eye.y", ["eye", "y"]],
    ["scene.camera.eye.z", ["eye", "z"]],
    ["scene.camera.up.x", ["up", "x"]],
    ["scene.camera.up.y", ["up", "y"]],
    ["scene.camera.up.z", ["up", "z"]],
    ["scene.camera.center.x", ["center", "x"]],
    ["scene.camera.center.y", ["center", "y"]],
    ["scene.camera.center.z", ["center", "z"]]
  ];

  mappings.forEach(([key, path]) => {
    if (key in ev && Number.isFinite(Number(ev[key]))) {
      const [group, axis] = path;
      if (!base[group]) base[group] = {};
      base[group][axis] = Number(ev[key]);
      changed = true;
    }
  });

  if ("scene.camera.projection.type" in ev) {
    base.projection = base.projection || {};
    base.projection.type = ev["scene.camera.projection.type"];
    changed = true;
  }

  return changed ? base : fallbackCamera;
}

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
    clearPlotContainer(plotDiv);
    plotDiv.innerHTML = `<div style="padding:24px;color:#777;">No points match the current filters.</div>`;
    updateTernaryInset();
    updatePhaseLegend(colourBy);
    return;
  }

  const spacingScale = getActualSpacingScale();
  const orderedLayers = getOrderedLayers(points);
  const concToZ = buildLayerZMap(orderedLayers, spacingScale);
  const preserveExistingCamera = Boolean(plotDiv?.data?.length && plotDiv?._fullLayout?.scene);

  const staticTraces = [
    ...buildLayerPlanes(orderedLayers, concToZ),
    buildTriangleGrid(orderedLayers, concToZ),
    ...buildTriangleEdges(orderedLayers, concToZ),
    buildLayerLabels3D(orderedLayers, concToZ),
    ...buildConcentrationGuide3D(orderedLayers, concToZ),
    ...buildPerLayerDirectionArrows3D(orderedLayers, concToZ),
    ...buildSideLabels3D(orderedLayers, concToZ)
  ].filter(Boolean);
  const pointTraces = buildPointTraces(points, concToZ, colourBy);
  const searchTraces = markerForSearchPosition3D(searchPosition, concToZ) || [];

  const traces = [
    ...staticTraces,
    ...pointTraces,
    ...searchTraces
  ].filter(Boolean);
  const liveCamera = cloneCamera(plotDiv?._fullLayout?.scene?.camera);
  const effectiveCamera = liveCamera || currentCamera;

  Plotly.react(
    plotDiv,
    traces,
    buildLayout(effectiveCamera, orderedLayers, concToZ, { preserveExistingCamera }),
    { responsive: true, displaylogo: false }
  );

  updateTernaryInset();
  updatePhaseLegend(colourBy);

  plotDiv.__zif3DPointTraceIndices = pointTraces.map(
    (_trace, index) => staticTraces.length + index
  );
  plotDiv.__zif3DSearchTraceIndices = searchTraces.map(
    (_trace, index) => staticTraces.length + pointTraces.length + index
  );
  plotDiv.__zif3DPointSizeUpdate = () => buildPointSizeUpdate3D(points, colourBy);
  plotDiv.__zif3DAmorphousOpacityUpdate = () =>
    buildAmorphousOpacityUpdate3D(points, colourBy);
  plotDiv.__zif3DSearchSizeUpdate = () => buildSearchMarkerSizeUpdate3D();

  plotDiv.removeAllListeners?.("plotly_relayout");
  plotDiv.removeAllListeners?.("plotly_click");

  plotDiv.on("plotly_relayout", (ev) => {
    if (Number(plotDiv.__zif3DSuppressCameraEvents || 0) > 0) {
      return;
    }
    const nextCamera = extractCameraFromRelayoutEvent(
      ev,
      plotDiv?._fullLayout?.scene?.camera || effectiveCamera
    );
    if (nextCamera) {
      onCameraChange(nextCamera);
    }
  });

  plotDiv.on("plotly_click", async (ev) => {
    const sampleId = ev.points?.[0]?.customdata;
    if (sampleId) await onPointClick(sampleId);
  });
}
