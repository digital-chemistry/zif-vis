import { TRI_H } from "./plot3d-geometry.js";

export function buildLayout(currentCamera) {
  return {
    margin: { l: 0, r: 0, t: 8, b: 0 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    uirevision: null,

    scene: {
      xaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.22, 1.26]
      },

      yaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.16, TRI_H + 0.12]
      },

      zaxis: {
        visible: false,
        showticklabels: false,
        showgrid: false,
        zeroline: false,
        showbackground: false
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
