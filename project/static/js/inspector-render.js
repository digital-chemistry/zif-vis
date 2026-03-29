import { $ } from "./dom.js";
import { formatValShort, escapeHtml } from "./formatters.js";

export function formatPercentWithError(mean, err, digits = 2) {
  if (mean == null) return "N/A";
  if (err == null) return `${formatValShort(mean, digits)}%`;
  return `${formatValShort(mean, digits)} ± ${formatValShort(err, digits)}%`;
}

export function formatFractionWithError(mean, err, digits = 1) {
  if (mean == null) return "N/A";

  const meanPct = mean * 100;
  if (err == null) return `${formatValShort(meanPct, digits)}%`;

  const errPct = err * 100;
  return `${formatValShort(meanPct, digits)} ± ${formatValShort(errPct, digits)}%`;
}

export function buildParameterRows(summary, topPhasesText, pointId) {
  return [
    {
      label: "Point ID",
      value: pointId || "N/A"
    },
    {
      label: "Encapsulation efficiency",
      value: formatPercentWithError(summary.eeMean, summary.eeErr, 2)
    },
    {
      label: "ATR IR relative peaks",
      value: summary.ratio == null ? "N/A" : formatValShort(summary.ratio, 4)
    },
    {
      label: "Crystalline fraction",
      value: formatFractionWithError(summary.crystMean, summary.crystStd, 1)
    },
    {
      label: "Amorphous fraction",
      value: formatFractionWithError(summary.amorphMean, summary.amorphStd, 1)
    },
    {
      label: "Top phases",
      value: topPhasesText,
      wide: true
    }
  ];
}

export function setInspectorLoading(sampleId) {
  const sampleTitle = $("sampleTitle");
  if (sampleTitle) {
    sampleTitle.textContent = sampleId || "Loading...";
  }

  const parametersGrid = $("parametersGrid");
  if (parametersGrid) {
    parametersGrid.innerHTML = `<div class="empty-msg">Loading parameters...</div>`;
  }

  const phasePlot = $("phaseCompositionPlot");
  if (phasePlot) {
    if (window.Plotly) {
      Plotly.purge(phasePlot);
    }
    phasePlot.innerHTML = `<div class="empty-msg">Loading material composition...</div>`;
  }

  const legend = $("phaseLegend");
  if (legend) {
    legend.innerHTML = "";
  }

  const atrDiv = $("atrPlot");
  if (atrDiv) {
    if (window.Plotly) {
      Plotly.purge(atrDiv);
    }
    atrDiv.innerHTML = `<div class="empty-msg">Open to load ATR data.</div>`;
  }

  const cards = $("experimentCards");
  if (cards) {
    cards.innerHTML = `<div class="empty-msg">Open to load repeated XRD experiments.</div>`;
  }
}

export function clearParametersCard(message = "No parameter data available.") {
  const el = $("parametersGrid");
  if (!el) return;
  el.innerHTML = `<div class="empty-msg">${escapeHtml(message)}</div>`;
}

export function clearPhaseComposition(message = "No material composition available.") {
  const plotDiv = $("phaseCompositionPlot");
  const legend = $("phaseLegend");

  if (plotDiv) {
    if (window.Plotly) {
      Plotly.purge(plotDiv);
    }
    plotDiv.innerHTML = `<div class="empty-msg">${escapeHtml(message)}</div>`;
  }

  if (legend) {
    legend.innerHTML = "";
  }
}

export function clearAtrSection(message = "No ATR data") {
  const atrDiv = $("atrPlot");
  if (!atrDiv) return;

  if (window.Plotly) {
    Plotly.purge(atrDiv);
  }

  atrDiv.innerHTML = `<div class="empty-msg">${escapeHtml(message)}</div>`;
}

export function clearXrdSection(message = "No repeated experiments found.") {
  const cards = $("experimentCards");
  if (!cards) return;

  cards.innerHTML = `<div class="empty-msg">${escapeHtml(message)}</div>`;
}

export function prepareCollapsedSections() {
  const atrDetails = $("atrDetails");
  const xrdDetails = $("xrdDetails");

  if (atrDetails) atrDetails.open = false;
  if (xrdDetails) xrdDetails.open = false;

  const atrDiv = $("atrPlot");
  if (atrDiv) {
    atrDiv.innerHTML = `<div class="empty-msg">Open to load ATR data.</div>`;
  }

  const cards = $("experimentCards");
  if (cards) {
    cards.innerHTML = `<div class="empty-msg">Open to load repeated XRD experiments.</div>`;
  }
}

export function renderParametersCard(summary, topPhasesText, pointId) {
  const el = $("parametersGrid");
  if (!el) return;

  const rows = buildParameterRows(summary, topPhasesText, pointId);

  el.innerHTML = rows
    .map(
      (row) => `
      <div class="parameter-item${row.wide ? " parameter-item-wide" : ""}">
        <div class="parameter-label">${escapeHtml(row.label)}</div>
        <div class="parameter-value">${escapeHtml(row.value)}</div>
      </div>
    `
    )
    .join("");
}

export function renderPhaseComposition(slices) {
  const plotDiv = $("phaseCompositionPlot");
  const legend = $("phaseLegend");

  if (!plotDiv) return;

  if (!slices.length) {
    clearPhaseComposition();
    return;
  }

  const labels = slices.map((slice) => slice.label);
  const values = slices.map((slice) => slice.value);
  const colors = slices.map((slice) => slice.color);

  Plotly.react(
    plotDiv,
    [
      {
        type: "pie",
        hole: 0.58,
        labels,
        values,
        sort: false,
        direction: "clockwise",
        textinfo: "none",
        hovertemplate: "%{label}: %{value:.1%}<extra></extra>",
        marker: {
          colors,
          line: { color: "#ffffff", width: 2 }
        }
      }
    ],
    {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "white",
      showlegend: false
    },
    { responsive: true, displaylogo: false }
  );

  if (legend) {
    legend.innerHTML = slices
      .map(
        (slice) => `
        <div class="inspector-phase-legend-item">
          <span class="inspector-phase-legend-swatch" style="background:${escapeHtml(slice.color)};"></span>
          <span>${escapeHtml(slice.label)} (${formatValShort(slice.value * 100, 1)}%)</span>
        </div>
      `
      )
      .join("");
  }
}

export function renderLinePlotElement(target, x, y, xlabel, ylabel) {
  Plotly.react(
    target,
    [
      {
        x,
        y,
        type: "scatter",
        mode: "lines",
        line: { width: 2, color: "#50667f" }
      }
    ],
    {
      autosize: true,
      margin: { l: 46, r: 12, t: 10, b: 42 },
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      font: {
        family: "Segoe UI, Arial, sans-serif",
        color: "#4d627a",
        size: 12
      },
      xaxis: {
        title: xlabel,
        showgrid: false,
        zeroline: false,
        showline: true,
        linecolor: "#cfd9e4",
        tickcolor: "#cfd9e4",
        ticks: "outside",
        automargin: true
      },
      yaxis: {
        title: ylabel,
        showgrid: false,
        zeroline: false,
        showline: true,
        linecolor: "#cfd9e4",
        tickcolor: "#cfd9e4",
        ticks: "outside",
        automargin: true
      },
      showlegend: false
    },
    { responsive: true, displaylogo: false }
  );

  requestAnimationFrame(() => {
    Plotly.Plots.resize(target);
  });
}
