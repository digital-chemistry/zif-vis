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

function toNumericArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
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

export async function loadInspector(sampleId) {
  const token = ++currentInspectorToken;
  setInspectorLoading(sampleId);

  try {
    const res = await fetch(`/api/sample/${encodeURIComponent(sampleId)}`);
    if (!res.ok) {
      throw new Error(`Failed sample load: ${res.status}`);
    }

    const data = await res.json();

    if (token !== currentInspectorToken) return;

    currentSample = data;
    atrLoadedForSample = null;
    xrdLoadedForSample = null;

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

  console.log("wireLazySections", {
    atrDetails,
    xrdDetails,
    currentSample
  });

  if (atrDetails) {
    atrDetails.ontoggle = async () => {
      console.log("ATR toggled", {
        open: atrDetails.open,
        currentSample,
        atrLoadedForSample
      });

      if (!atrDetails.open || !currentSample) return;
      if (atrLoadedForSample === currentSample.id) return;

      await loadATRForPoint(currentSample, token);
      atrLoadedForSample = currentSample.id;
    };
  }

  if (xrdDetails) {
    xrdDetails.ontoggle = async () => {
      console.log("XRD toggled", {
        open: xrdDetails.open,
        currentSample,
        xrdLoadedForSample
      });

      if (!xrdDetails.open || !currentSample) return;
      if (xrdLoadedForSample === currentSample.id) return;

      await loadExperimentCards(currentSample, token);
      xrdLoadedForSample = currentSample.id;
    };
  }
}
async function loadATRForPoint(sample, token) {
  const atrDiv = $("atrPlot");
  console.log("loadATRForPoint called", { sample, atrDiv });

  if (!atrDiv) return;

  const atrExp = getAtrExperiment(sample);
  console.log("resolved ATR experiment", atrExp);

  if (!atrExp?.experiment_id) {
    if (token !== currentInspectorToken) return;
    clearAtrSection("No ATR data");
    return;
  }

  try {
    const url = `/api/spectrum/atr/${encodeURIComponent(atrExp.experiment_id)}`;
    console.log("fetching ATR", url);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed ATR load: ${res.status}`);
    }

    const data = await res.json();
    console.log("ATR response", data);

    if (token !== currentInspectorToken) return;

    if (!data?.x?.length || !data?.y?.length) {
      clearAtrSection("No ATR data");
      return;
    }

    renderLinePlotElement(atrDiv, data.x, data.y, "Wavenumber / cm⁻¹", "Absorbance");
  } catch (err) {
    if (token !== currentInspectorToken) return;
    console.error("ATR load failed:", err);
    clearAtrSection("No ATR data");
  }
}

async function loadExperimentCards(sample, token) {
  const cards = $("experimentCards");
  if (!cards) return;
  if (token !== currentInspectorToken) return;

  const experiments = getXrdExperiments(sample);
  console.log("XRD experiments resolved:", experiments, sample);

  if (!experiments.length) {
    clearXrdSection("No repeated experiments found.");
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
      if (!xrdRes.ok) {
        throw new Error(`HTTP ${xrdRes.status}`);
      }

      const xrd = await xrdRes.json();
      if (token !== currentInspectorToken) return;

      console.log("XRD spectrum response:", exp.experiment_id, xrd);

      const { x, y } = extractSpectrumXY(xrd, "xrd");

      if (x.length && y.length) {
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

