import { TRI_H } from "./plot3d-geometry.js";

export function buildLayout(currentCamera) {
  return {
    margin: { l: 10, r: 10, t: 10, b: 10 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    uirevision: null,
    scene: {
      xaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.20, 1.08]
      },
      yaxis: {
        visible: false,
        showbackground: false,
        showgrid: false,
        zeroline: false,
        range: [-0.08, TRI_H + 0.08]
      },
      zaxis: {
        title: "",
        showticklabels: false,
        showgrid: false,
        zeroline: false,
        showbackground: false
      },
      camera: currentCamera || {
        eye: { x: 1.55, y: -1.55, z: 1.05 },
        up: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 0, z: 0 },
        projection: { type: "orthographic" }
      },
      aspectmode: "manual",
      aspectratio: {
        x: 1.0,
        y: TRI_H,
        z: 2.4
      }
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