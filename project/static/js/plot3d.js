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
  buildPointMarkerUpdates3D,
  buildSearchMarkerUpdates3D
} from "./plot3d-points.js";
import { buildLayout } from "./plot3d-layout.js";

export { getOrderedLayers, buildLayerZMap };

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

  const spacingScale = Number($("spacingScale")?.value || 0.17);
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

  Plotly.react(
    plotDiv,
    traces,
    buildLayout(currentCamera, orderedLayers, concToZ, { preserveExistingCamera }),
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
  plotDiv.__zif3DPointMarkerUpdates = () => buildPointMarkerUpdates3D(points, colourBy);
  plotDiv.__zif3DSearchMarkerUpdates = () => buildSearchMarkerUpdates3D();

  plotDiv.removeAllListeners?.("plotly_relayout");
  plotDiv.removeAllListeners?.("plotly_click");

  plotDiv.on("plotly_relayout", (ev) => {
    if (ev["scene.camera"]) {
      onCameraChange(JSON.parse(JSON.stringify(ev["scene.camera"])));
    }
  });

  plotDiv.on("plotly_click", async (ev) => {
    const sampleId = ev.points?.[0]?.customdata;
    if (sampleId) await onPointClick(sampleId);
  });
}
