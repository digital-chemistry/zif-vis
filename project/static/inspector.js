import { $ } from "./dom.js";
import { PHASE_COLORS, PHASE_LABELS } from "./constants.js";
import { normalisePhase, numericOrNull, formatValShort, escapeHtml } from "./formatters.js";

let currentInspectorToken = 0;
let currentSample = null;
let atrLoadedForSample = null;
let xrdLoadedForSample = null;

export async function loadInspector(sampleId) {
  const token = ++currentInspectorToken;
  setInspectorLoading(sampleId);

  try {
    const res = await fetch(`/api/sample/${encodeURIComponent(sampleId)}`);
    if (!res.ok) throw new Error(`Failed sample load: ${res.status}`);

    const data = await res.json();

    console.log("SAMPLE DATA", data);
    console.log("CRYSTALLINE FRACTION", data?.crystallinity);
    console.log("AMORPHOUS FRACTION", data?.amorphousness);
    console.log("PHASE COMP", data?.phase_composition);

    if (token !== currentInspectorToken) return;

    currentSample = data;
    atrLoadedForSample = null;
    xrdLoadedForSample = null;

    $("sampleTitle").textContent = data.id || sampleId;
    $("eeVal").textContent = formatValShort(data.ee, 2);
    $("proteinVal").textContent = formatValShort(data.protein_ratio, 2);

    renderUncertaintyBlock(data);
    renderPhaseComposition(data);
    prepareCollapsedSections();
    wireLazySections(token);
  } catch (err) {
    if (token !== currentInspectorToken) return;
    console.error(err);
    $("sampleTitle").textContent = sampleId;
    $("eeVal").textContent = "—";
    $("proteinVal").textContent = "—";
    clearUncertaintyBlock();
  }
}

function setInspectorLoading(sampleId) {
  $("sampleTitle").textContent = sampleId;
  $("eeVal").textContent = "Loading...";
  $("proteinVal").textContent = "Loading...";

  const uncertaintyEl = $("inspectorUncertainty");
  if (uncertaintyEl) {
    uncertaintyEl.innerHTML = `<div class="empty-msg">Loading uncertainty...</div>`;
  }

  const phasePlot = $("phaseCompositionPlot");
  if (phasePlot) {
    Plotly.purge(phasePlot);
    phasePlot.innerHTML = `<div class="empty-msg">Loading material composition...</div>`;
  }

  const legend = $("phaseLegend");
  if (legend) legend.innerHTML = "";

  const atrDiv = $("atrPlot");
  if (atrDiv) {
    Plotly.purge(atrDiv);
    atrDiv.innerHTML = `<div class="empty-msg">Open to load ATR data.</div>`;
  }

  const cards = $("experimentCards");
  if (cards) {
    cards.innerHTML = `<div class="empty-msg">Open to load repeated XRD experiments.</div>`;
  }
}

function clearUncertaintyBlock() {
  const el = $("inspectorUncertainty");
  if (!el) return;
  el.innerHTML = `<div class="empty-msg">No uncertainty data available.</div>`;
}

function formatMeanPm(mean, err, digits = 2) {
  const m = numericOrNull(mean);
  const e = numericOrNull(err);

  if (m == null) return "N/A";
  if (e == null) return formatValShort(m, digits);

  return `${formatValShort(m, digits)} ± ${formatValShort(e, digits)}`;
}

function renderUncertaintyBlock(point) {
  const el = $("inspectorUncertainty");
  if (!el) return;

  const eeMean = numericOrNull(point.ee);
  const eeErr = numericOrNull(point.ee_error ?? point.error_bar ?? point.ee_std);

  const crystMean = numericOrNull(point.crystallinity);
  const crystStd = numericOrNull(point.crystallinity_std);

  const amorphMean = numericOrNull(point.amorphousness);
  const amorphStd = numericOrNull(point.amorphousness_std);

  const phaseComp = point.phase_composition || {};
  const topPhases = Object.entries(phaseComp)
    .map(([name, obj]) => ({
      name,
      mean: numericOrNull(obj?.mean ?? obj),
      std: numericOrNull(obj?.std)
    }))
    .filter((v) => v.mean != null && v.mean > 0)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 3);

  const hasMainData =
    eeMean != null ||
    eeErr != null ||
    crystMean != null ||
    crystStd != null ||
    amorphMean != null ||
    amorphStd != null ||
    topPhases.length > 0;

  if (!hasMainData) {
    el.innerHTML = `<div class="empty-msg">No uncertainty data available.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="inspector-uncertainty-row">EE: ${escapeHtml(formatMeanPm(eeMean, eeErr, 2))}</div>
    <div class="inspector-uncertainty-row">Crystalline: ${escapeHtml(formatMeanPm(crystMean, crystStd, 3))}</div>
    <div class="inspector-uncertainty-row">Amorphous: ${escapeHtml(formatMeanPm(amorphMean, amorphStd, 3))}</div>
    ${
      topPhases.length
        ? `
          <div class="inspector-uncertainty-subtitle">Top phases</div>
          ${topPhases.map((p) =>
            `<div class="inspector-uncertainty-row">${escapeHtml(p.name)}: ${escapeHtml(
              formatMeanPm(
                p.mean * 100,
                p.std == null ? null : p.std * 100,
                1
              )
            )}%</div>`
          ).join("")}
        `
        : ""
    }
  `;
}

function prepareCollapsedSections() {
  const atrDetails = $("atrDetails");
  const xrdDetails = $("xrdDetails");

  if (atrDetails) atrDetails.open = false;
  if (xrdDetails) xrdDetails.open = false;

  const atrDiv = $("atrPlot");
  if (atrDiv) atrDiv.innerHTML = `<div class="empty-msg">Open to load ATR data.</div>`;

  const cards = $("experimentCards");
  if (cards) cards.innerHTML = `<div class="empty-msg">Open to load repeated XRD experiments.</div>`;
}

function wireLazySections(token) {
  const atrDetails = $("atrDetails");
  const xrdDetails = $("xrdDetails");

  if (atrDetails) {
    atrDetails.ontoggle = async () => {
      if (!atrDetails.open || !currentSample) return;
      if (atrLoadedForSample === currentSample.id) return;
      await loadATRForPoint(currentSample, token);
      atrLoadedForSample = currentSample.id;
    };
  }

  if (xrdDetails) {
    xrdDetails.ontoggle = async () => {
      if (!xrdDetails.open || !currentSample) return;
      if (xrdLoadedForSample === currentSample.id) return;
      await loadExperimentCards(currentSample.experiments || [], token);
      xrdLoadedForSample = currentSample.id;
    };
  }
}

function renderPhaseComposition(sample) {
  const plotDiv = $("phaseCompositionPlot");
  const legend = $("phaseLegend");
  if (!plotDiv) return;

  const slices = buildPhaseSlices(sample);

  if (!slices.length) {
    Plotly.purge(plotDiv);
    plotDiv.innerHTML = `<div class="empty-msg">No material composition available.</div>`;
    if (legend) legend.innerHTML = "";
    return;
  }

  const labels = slices.map((s) => s.label);
  const values = slices.map((s) => s.value);
  const colors = slices.map((s) => s.color);

  Plotly.react(
    plotDiv,
    [{
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
    }],
    {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "white",
      showlegend: false
    },
    { responsive: true, displaylogo: false }
  );

  if (legend) {
    legend.innerHTML = slices.map((s) => `
      <div class="phase-legend-item">
        <span class="phase-legend-swatch" style="background:${escapeHtml(s.color)};"></span>
        <span>${escapeHtml(s.label)} (${formatValShort(s.value * 100, 1)}%)</span>
      </div>
    `).join("");
  }
}

function buildPhaseSlices(sample) {
  const result = [];

  const crystalline = Number(
    sample?.crystallinity ??
    sample?.crystallinity_fractions?.crystalline ??
    sample?.crystalline_fraction
  );

  const amorphous = Number(
    sample?.amorphousness ??
    sample?.crystallinity_fractions?.amorphous ??
    sample?.amorphous_fraction
  );

  const hasCrystalline = Number.isFinite(crystalline) && crystalline > 0;
  const hasAmorphous = Number.isFinite(amorphous) && amorphous > 0;

  if (hasAmorphous) {
    result.push({
      key: "am",
      label: "Amorphous",
      value: amorphous,
      color: PHASE_COLORS.am || "#B2B2B2"
    });
  }

  const phaseComp = sample?.phase_composition || {};
  const rawPhases = [];

  Object.entries(phaseComp).forEach(([name, obj]) => {
    const raw = Number(obj?.mean ?? obj);
    if (!Number.isFinite(raw) || raw <= 0) return;

    const key = normalisePhase(name);
    rawPhases.push({
      key,
      label: PHASE_LABELS[key] || name,
      raw,
      color: PHASE_COLORS[key] || PHASE_COLORS.unknown || "#8B8B8B"
    });
  });

  const rawTotal = rawPhases.reduce((sum, p) => sum + p.raw, 0);

  if (rawTotal > 0 && hasCrystalline) {
    rawPhases.forEach((p) => {
      const fractionWithinCrystalline = p.raw / rawTotal;
      const finalValue = crystalline * fractionWithinCrystalline;

      if (finalValue > 0) {
        result.push({
          key: p.key,
          label: p.label,
          value: finalValue,
          color: p.color
        });
      }
    });
  }

  console.log("MATERIAL SLICES", result);
  return result;
}

async function loadATRForPoint(sample, token) {
  const atrDiv = $("atrPlot");
  if (!atrDiv) return;

  const atrExp = (sample.experiments || []).find((e) => e.has_atr);

  if (!atrExp) {
    if (token !== currentInspectorToken) return;
    Plotly.purge(atrDiv);
    atrDiv.innerHTML = `<div class="empty-msg">No ATR data</div>`;
    return;
  }

  try {
    const res = await fetch(`/api/spectrum/atr/${encodeURIComponent(atrExp.experiment_id)}`);
    if (!res.ok) throw new Error(`Failed ATR load: ${res.status}`);
    const data = await res.json();

    if (token !== currentInspectorToken) return;

    if (!data.x?.length || !data.y?.length) {
      atrDiv.innerHTML = `<div class="empty-msg">No ATR data</div>`;
      return;
    }

    renderLinePlotElement(atrDiv, data.x, data.y, "Wavenumber / cm⁻¹", "Absorbance");
  } catch (err) {
    if (token !== currentInspectorToken) return;
    console.error(err);
    atrDiv.innerHTML = `<div class="empty-msg">No ATR data</div>`;
  }
}

async function loadExperimentCards(experiments, token) {
  const cards = $("experimentCards");
  if (!cards) return;
  if (token !== currentInspectorToken) return;

  if (!experiments.length) {
    cards.innerHTML = `<div class="empty-msg">No repeated experiments found.</div>`;
    return;
  }

  cards.innerHTML = "";
  const seen = new Set();

  for (const exp of experiments) {
    if (token !== currentInspectorToken) return;
    if (!exp?.experiment_id || seen.has(exp.experiment_id)) continue;
    seen.add(exp.experiment_id);

    const card = document.createElement("div");
    card.className = "experiment-card";

    const title = document.createElement("div");
    title.className = "experiment-title";
    title.textContent = exp.experiment_id;
    card.appendChild(title);

    const plotDiv = document.createElement("div");
    plotDiv.className = "experiment-mini-plot";
    card.appendChild(plotDiv);

    cards.appendChild(card);

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (token !== currentInspectorToken) return;

    try {
      const xrdRes = await fetch(`/api/spectrum/xrd/${encodeURIComponent(exp.experiment_id)}`);
      if (!xrdRes.ok) throw new Error(`HTTP ${xrdRes.status}`);

      const xrd = await xrdRes.json();
      if (token !== currentInspectorToken) return;

      if (xrd.x?.length && xrd.y?.length) {
        renderLinePlotElement(plotDiv, xrd.x, xrd.y, "2θ / °", "Intensity");
      } else {
        plotDiv.innerHTML = `<div class="empty-msg">No XRD data</div>`;
      }
    } catch (err) {
      console.error("XRD load failed:", exp.experiment_id, err);
      plotDiv.innerHTML = `<div class="empty-msg">No XRD data</div>`;
    }
  }
}

function renderLinePlotElement(target, x, y, xlabel, ylabel) {
  Plotly.react(
    target,
    [{
      x,
      y,
      type: "scatter",
      mode: "lines",
      line: { width: 2 }
    }],
    {
      margin: { l: 46, r: 12, t: 10, b: 42 },
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      xaxis: {
        title: xlabel,
        showgrid: false,
        zeroline: false
      },
      yaxis: {
        title: ylabel,
        showgrid: false,
        zeroline: false
      },
      showlegend: false
    },
    { responsive: true, displaylogo: false }
  );
}