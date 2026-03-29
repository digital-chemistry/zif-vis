import { TRI_H } from "./plot3d-geometry.js";

export function buildLayout(currentCamera) {
  return {
    margin: { l: 0, r: 0, t: 0, b: 0 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    uirevision: null,

    scene: {
      xaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.32, 1.02]
      },

      yaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.12, TRI_H + 0.05]
      },

      zaxis: {
        visible: false,
        showticklabels: false,
        showgrid: false,
        zeroline: false,
        showbackground: false
      },

      camera: currentCamera || {
        eye: { x: 0.72, y: -0.74, z: 0.50 },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0.06, y: 0.02, z: 0 },
        projection: { type: "orthographic" }
      },

      aspectmode: "data"
    },

    annotations: [
      {
        xref: "paper",
        yref: "paper",
        x: 0.02,
        y: 0.98,
        text: "Stacked ternary maps across concentration levels",
        showarrow: false,
        font: { size: 12, color: "#6c645d" },
        align: "left"
      }
    ],

    showlegend: false
  };
}