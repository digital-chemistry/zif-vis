import { $, } from "./dom.js";
import { displayPhase, formatValShort, escapeHtml } from "./formatters.js";

let currentInspectorToken = 0;

export async function loadInspector(sampleId) {
  const token = ++currentInspectorToken;
  setInspectorLoading(sampleId);

  try {
    const res = await fetch(`/api/sample/${encodeURIComponent(sampleId)}`);
    if (!res.ok) throw new Error(`Failed sample load: ${res.status}`);

    const data = await res.json();
    if (token !== currentInspectorToken) return;

    $("sampleTitle").textContent = data.id || sampleId;
    $("eeVal").textContent = formatValShort(data.ee, 2);
    $("crystVal").textContent = formatValShort(data.crystallinity, 2);
    $("phaseVal").textContent = displayPhase(data.primary_phase || data.phase);
    $("detectedVal").textContent = data.detected_phases || "N/A";
    $("proteinVal").textContent = formatValShort(data.protein_ratio, 2);
    $("washVal").textContent = data.washing || data.wash || "N/A";
    $("concVal").textContent = formatValShort(data.concentration, 1);
    $("signalVal").textContent = data.experiments?.[0]?.signal_class || "N/A";

    await loadATRForPoint(data, token);
    await loadExperimentCards(data.experiments || [], token);
  } catch (err) {
    if (token !== currentInspectorToken) return;
    console.error(err);
    $("sampleTitle").textContent = sampleId;
  }
}

function setInspectorLoading(sampleId) {
  $("sampleTitle").textContent = sampleId;
  $("eeVal").textContent = "Loading...";
  $("crystVal").textContent = "Loading...";
  $("phaseVal").textContent = "Loading...";
  $("detectedVal").textContent = "Loading...";
  $("proteinVal").textContent = "Loading...";
  $("washVal").textContent = "Loading...";
  $("concVal").textContent = "Loading...";
  $("signalVal").textContent = "Loading...";

  const atrDiv = $("atrPlot");
  if (atrDiv) atrDiv.innerHTML = `<div class="empty-msg">Loading ATR data...</div>`;

  const cards = $("experimentCards");
  if (cards) cards.innerHTML = `<div class="empty-msg">Loading repeated experiments...</div>`;
}

async function loadATRForPoint(sample, token) {
  const atrDiv = $("atrPlot");
  if (!atrDiv) return;

  const atrExp = (sample.experiments || []).find(e => e.has_atr);

  if (!atrExp) {
    if (token !== currentInspectorToken) return;
    Plotly.purge(atrDiv);
    atrDiv.innerHTML = `<div class="empty-msg">No ATR data</div>`;
    return;
  }

  // Debugging: verify which ATR file is being targeted
  console.log("Attempting ATR load for:", atrExp.experiment_id, "File:", atrExp.atr_file);

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

    const meta = document.createElement("div");
    meta.className = "experiment-meta";
    meta.innerHTML =
      `<b>Detected phases:</b> ${escapeHtml(exp.detected_phases || exp.phase_label || "N/A")}<br>` +
      `<b>Primary phase:</b> ${escapeHtml(displayPhase(exp.primary_phase || exp.phase))}<br>` +
      `<b>Signal class:</b> ${escapeHtml(exp.signal_class || "N/A")}<br>` +
      `<b>Crystallinity:</b> ${escapeHtml(formatValShort(exp.crystallinity, 3))}`;
    card.appendChild(meta);

    const plotDiv = document.createElement("div");
    plotDiv.className = "experiment-mini-plot";
    card.appendChild(plotDiv);

    cards.appendChild(card);

    await new Promise(resolve => setTimeout(resolve, 0));
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
      if (token !== currentInspectorToken) return;
      console.error("XRD fetch failed for", exp.experiment_id, err);
      plotDiv.innerHTML = `<div class="empty-msg">No XRD data</div>`;
    }
  }
}

function renderLinePlotElement(el, x, y, xTitle, yTitle) {
  Plotly.newPlot(
    el,
    [{
      type: "scatter",
      mode: "lines",
      x: x || [],
      y: y || [],
      line: { width: 2 }
    }],
    {
      margin: { l: 55, r: 15, t: 10, b: 45 },
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      xaxis: { title: xTitle, automargin: true },
      yaxis: { title: yTitle, automargin: true }
    },
    { responsive: true, displaylogo: false }
  );
}