export const $ = (id) => document.getElementById(id);

export function getCheckedRadio(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function getPhaseThresholds() {
  const result = {};
  document.querySelectorAll(".phase-slider").forEach((slider) => {
    const phase = slider.dataset.phase;
    if (!phase) return;

    const checked = document.querySelector(
      `.phase-check[data-phase="${phase}"]`
    )?.checked;
    const threshold = Number(slider.value || 0);
    if (checked) result[phase] = threshold / 100;
  });
  return result;
}

export function readAllState(viewerState = {}) {
  const mode = getCheckedRadio("viewMode", "3d");
  const selectedLayers =
    mode === "3d"
      ? (Array.isArray(viewerState.selectedLayers) ? viewerState.selectedLayers : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
  const layerCheckboxCount = document.querySelectorAll(".layer-check").length;

  return {
    mode,
    dataLayer: getCheckedRadio("dataLayer", "experimental"),
    washing: getCheckedRadio("washing", "ethanol"),
    colourBy: $("colourBy")?.value || "phase",
    phaseFilterBasis: getCheckedRadio("phaseFilterBasis", "relative"),
    phaseThresholds: getPhaseThresholds(),
    selectedLayers,
    selectedLayersExplicitlyEmpty:
      mode === "3d" &&
      layerCheckboxCount > 0 &&
      selectedLayers.length === 0,
    layerCheckboxCount,
    layerFocus: $("layerFocus")?.value || "",
    crystBalance: Number($("crystBalance")?.value ?? 0),
    proteinThreshold: Number($("proteinThreshold")?.value ?? 0),
    eeThreshold: Number($("eeThreshold")?.value ?? 0),
    spacingScale: Number($("spacingScale")?.value ?? 1),
    markerScale3D: Number($("markerScale3D")?.value ?? 1.8),
    amorphousOpacity: Number($("amorphousOpacity")?.value ?? 0.7),
    sliceMode: $("sliceMode")?.value || "off",
    sliceAxisA: $("sliceAxisA")?.value || "metal",
    sliceAxisB: $("sliceAxisB")?.value || "ligand",
    sliceValueA: Number($("sliceValueA")?.value ?? 50),
    sliceValueB: Number($("sliceValueB")?.value ?? 20),
    showInterlayerGuides: Boolean($("showInterlayerGuides")?.checked),
    searchPosition: {
      metal: $("posMetal")?.value ?? "",
      ligand: $("posLigand")?.value ?? "",
      bsa: $("posBsa")?.value ?? "",
      concentration: $("posConcentration")?.value ?? ""
    }
  };
}

export function getThemeTokens() {
  const styles = window.getComputedStyle(document.documentElement);
  return {
    bg: styles.getPropertyValue("--bg").trim(),
    panel: styles.getPropertyValue("--panel").trim(),
    card: styles.getPropertyValue("--card").trim(),
    border: styles.getPropertyValue("--border").trim(),
    text: styles.getPropertyValue("--text").trim(),
    muted: styles.getPropertyValue("--muted").trim(),
    accent: styles.getPropertyValue("--accent").trim(),
    danger: styles.getPropertyValue("--danger").trim()
  };
}

export function updateViewControls(uiState = readAllState()) {
  const layerMultiCard = $("layerMultiCard");
  const layerFocusCard = $("layerFocusCard");

  if (layerMultiCard) layerMultiCard.style.display = uiState.mode === "3d" ? "block" : "none";
  if (layerFocusCard) layerFocusCard.style.display = uiState.mode === "2d" ? "block" : "none";
}
