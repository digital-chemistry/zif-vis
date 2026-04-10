import { TRI_H } from "./plot3d-geometry.js";

export function buildLayout(currentCamera, orderedLayers = [], concToZ = new Map()) {
  const xMin = -0.14;
  const xMax = 1.14;
  const span = xMax - xMin;
  const yCenter = TRI_H / 2;
  const yMin = yCenter - span / 2;
  const yMax = yCenter + span / 2;
  const zValues = orderedLayers
    .map((layer) => Number(concToZ.get(layer)))
    .filter((value) => Number.isFinite(value));
  const zMin = zValues.length ? Math.min(...zValues) : 0;
  const zMax = zValues.length ? Math.max(...zValues) : 1;
  const zPad = zValues.length <= 1 ? 0.08 : Math.max(0.08, (zMax - zMin) * 0.14);

  return {
    margin: { l: 0, r: 0, t: 8, b: 0 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    uirevision: "zif-3d-scene",

    scene: {
      xaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [xMin, xMax]
      },

      yaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [yMin, yMax]
      },

      zaxis: {
        visible: false,
        showticklabels: false,
        showgrid: false,
        zeroline: false,
        showbackground: false,
        range: [zMin - zPad, zMax + zPad]
      },

      camera: currentCamera || {
        eye: { x: 0.0, y: -1.72, z: 0.66 },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0.0, y: 0.01, z: 0 },
        projection: { type: "orthographic" }
      },

      aspectmode: "manual",
      aspectratio: {
        x: 1,
        y: 1,
        z: 0.95
      }
    },

    annotations: [
      {
        xref: "paper",
        yref: "paper",
      x: 0.025,
      y: 0.975,
      text: "Stacked ternary composition map",
      showarrow: false,
      font: { size: 15, color: "#283240" },
      align: "left"
    },
      {
        xref: "paper",
        yref: "paper",
      x: 0.025,
      y: 0.935,
      text: "Layered by concentration with anchored ternary axes",
      showarrow: false,
      font: { size: 11, color: "#6d7785" },
      align: "left"
    }
    ],

    showlegend: false
  };
}
