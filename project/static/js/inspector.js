import { $ } from "./dom.js";
import {
  extractInspectorSummary,
  extractTopPhasesText,
  buildPhaseSlices,
  getAtrExperiment,
  getXrdExperiments
} from "./inspector-data.js";
import {
  setInspectorLoading,
  clearParametersCard,
  clearPhaseComposition,
  clearAtrSection,
  clearXrdSection,
  prepareCollapsedSections,
  renderParametersCard,
  renderPhaseComposition,
  renderLinePlotElement
} from "./inspector-render.js";

let currentInspectorToken = 0;
let currentSample = null;
let atrLoadedForSample = null;
let xrdLoadedForSample = null;
let currentAtrSpectrum = null;
let currentXrdSpectra = new Map();
const ZIF_BASE_PATH = String(window.ZIF_BASE_PATH || "");

function apiUrl(path) {
  return `${ZIF_BASE_PATH}${path}`;
}

function toNumericArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

function downloadSpectrumCsv(filename, x, y, xLabel, yLabel) {
  const rows = [[xLabel, yLabel]];
  const n = Math.min(x.length, y.length);

  for (let i = 0; i < n; i += 1) {
    rows.push([x[i], y[i]]);
  }

  const csv = rows.map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function wireDownloadButtons() {
  const atrDownloadBtn = $("atrDownloadBtn");
  if (!atrDownloadBtn) return;

  atrDownloadBtn.disabled = !currentAtrSpectrum;
  atrDownloadBtn.onclick = () => {
    if (!currentAtrSpectrum) return;

    downloadSpectrumCsv(
      `${currentAtrSpectrum.name}.csv`,
      currentAtrSpectrum.x,
      currentAtrSpectrum.y,
      "wavenumber_cm^-1",
      "absorbance"
    );
  };
}

function extractSpectrumXY(data, mode = "generic") {
  if (!data || typeof data !== "object") {
    return { x: [], y: [] };
  }

  let x = [];
  let y = [];

  if (Array.isArray(data.x) || Array.isArray(data.y)) {
    x = toNumericArray(data.x);
    y = toNumericArray(data.y);
  }

  if (!x.length || !y.length) {
    if (mode === "atr") {
      x = toNumericArray(
        data.wavenumber ||
          data.wavenumbers ||
          data.wn ||
          data.cm_1 ||
          data.cm1
      );
      y = toNumericArray(
        data.absorbance ||
          data.abs ||
          data.intensity ||
          data.y
      );
    } else if (mode === "xrd") {
      x = toNumericArray(
        data.two_theta ||
          data.twoTheta ||
          data["2theta"] ||
          data.theta ||
          data.x
      );
      y = toNumericArray(
        data.intensity ||
          data.counts ||
          data.y
      );
    }
  }

  if ((!x.length || !y.length) && Array.isArray(data.points)) {
    x = toNumericArray(data.points.map((p) => p?.x ?? p?.[0]));
    y = toNumericArray(data.points.map((p) => p?.y ?? p?.[1]));
  }

  if ((!x.length || !y.length) && Array.isArray(data.data)) {
    x = toNumericArray(data.data.map((p) => p?.x ?? p?.[0]));
    y = toNumericArray(data.data.map((p) => p?.y ?? p?.[1]));
  }

  const n = Math.min(x.length, y.length);
  return {
    x: x.slice(0, n),
    y: y.slice(0, n)
  };
}

export async function loadInspector(sampleId, dataset = "primary") {
  const token = ++currentInspectorToken;
  setInspectorLoading(sampleId);

  try {
    const res = await fetch(
      apiUrl(`/api/sample/${encodeURIComponent(sampleId)}?dataset=${encodeURIComponent(dataset)}`)
    );
    if (!res.ok) {
      throw new Error(`Failed sample load: ${res.status}`);
    }

    const data = await res.json();

    if (token !== currentInspectorToken) return;

    currentSample = data;
    atrLoadedForSample = null;
    xrdLoadedForSample = null;
    currentAtrSpectrum = null;
    currentXrdSpectra = new Map();
    wireDownloadButtons();

    const sampleTitle = $("sampleTitle");
    if (sampleTitle) {
      sampleTitle.textContent = data.id || sampleId;
    }

    const summary = extractInspectorSummary(data);
    const topPhasesText = extractTopPhasesText(data);
    const slices = buildPhaseSlices(data);

    renderParametersCard(summary, topPhasesText, data.id || sampleId);
    renderPhaseComposition(slices);

    prepareCollapsedSections();
    wireLazySections(token);

    await loadATRForPoint(data, token);
    await loadExperimentCards(data, token);
  } catch (err) {
    if (token !== currentInspectorToken) return;

    console.error("loadInspector failed:", err);

    const sampleTitle = $("sampleTitle");
    if (sampleTitle) {
      sampleTitle.textContent = sampleId;
    }

    clearParametersCard();
    clearPhaseComposition();
    clearAtrSection("No ATR data");
    clearXrdSection("No repeated experiments found.");
  }
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

      await loadExperimentCards(currentSample, token);
      xrdLoadedForSample = currentSample.id;
    };
  }
}

async function loadATRForPoint(sample, token) {
  const atrDiv = $("atrPlot");
  if (!atrDiv) return;

  const atrExp = getAtrExperiment(sample);

  if (!atrExp?.experiment_id) {
    if (token !== currentInspectorToken) return;
    currentAtrSpectrum = null;
    wireDownloadButtons();
    clearAtrSection("No ATR data");
    return;
  }

  try {
    const url = apiUrl(`/api/spectrum/atr/${encodeURIComponent(atrExp.experiment_id)}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed ATR load: ${res.status}`);
    }

    const data = await res.json();

    if (token !== currentInspectorToken) return;

    if (!data?.x?.length || !data?.y?.length) {
      currentAtrSpectrum = null;
      wireDownloadButtons();
      clearAtrSection("No ATR data");
      return;
    }

    currentAtrSpectrum = {
      name: atrExp.experiment_id || sample.id || "atr_spectrum",
      x: data.x,
      y: data.y
    };
    wireDownloadButtons();
    renderLinePlotElement(atrDiv, data.x, data.y, "Wavenumber / cm^-1", "Absorbance");
  } catch (err) {
    if (token !== currentInspectorToken) return;
    console.error("ATR load failed:", err);
    currentAtrSpectrum = null;
    wireDownloadButtons();
    clearAtrSection("No ATR data");
  }
}

async function loadExperimentCards(sample, token) {
  const cards = $("experimentCards");
  if (!cards) return;
  if (token !== currentInspectorToken) return;

  const experiments = getXrdExperiments(sample);

  if (!experiments.length) {
    currentXrdSpectra = new Map();
    clearXrdSection("No repeated experiments found.");
    return;
  }

  cards.innerHTML = "";
  const seen = new Set();
  currentXrdSpectra = new Map();

  for (const exp of experiments) {
    if (token !== currentInspectorToken) return;
    if (!exp?.experiment_id || seen.has(exp.experiment_id)) continue;

    seen.add(exp.experiment_id);

    const card = document.createElement("div");
    card.className = "experiment-card";

    const head = document.createElement("div");
    head.className = "experiment-card-head";
    card.appendChild(head);

    const title = document.createElement("div");
    title.className = "experiment-title";
    title.textContent = exp.experiment_id;
    head.appendChild(title);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "ghost-btn download-btn";
    downloadBtn.textContent = "Download CSV";
    downloadBtn.disabled = true;
    head.appendChild(downloadBtn);

    const plotDiv = document.createElement("div");
    plotDiv.className = "experiment-mini-plot";
    card.appendChild(plotDiv);

    cards.appendChild(card);

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (token !== currentInspectorToken) return;

    try {
      const xrdRes = await fetch(apiUrl(`/api/spectrum/xrd/${encodeURIComponent(exp.experiment_id)}`));
      if (!xrdRes.ok) {
        throw new Error(`HTTP ${xrdRes.status}`);
      }

      const xrd = await xrdRes.json();
      if (token !== currentInspectorToken) return;

      const { x, y } = extractSpectrumXY(xrd, "xrd");

      if (x.length && y.length) {
        currentXrdSpectra.set(exp.experiment_id, { x, y });
        downloadBtn.disabled = false;
        downloadBtn.onclick = () => {
          const spectrum = currentXrdSpectra.get(exp.experiment_id);
          if (!spectrum) return;

          downloadSpectrumCsv(
            `${exp.experiment_id}.csv`,
            spectrum.x,
            spectrum.y,
            "two_theta_deg",
            "intensity"
          );
        };

        renderLinePlotElement(plotDiv, x, y, "2θ / °", "Intensity");
      } else {
        plotDiv.innerHTML = `<div class="empty-msg">No XRD data</div>`;
      }
    } catch (err) {
      console.error("XRD load failed:", exp.experiment_id, err);
      plotDiv.innerHTML = `<div class="empty-msg">No XRD data</div>`;
    }
  }
}
