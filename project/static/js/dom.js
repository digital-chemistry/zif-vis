export const $ = (id) => document.getElementById(id);

export function getSelectedMulti(id) {
  const el = $(id);
  if (!el) return [];
  return [...el.selectedOptions].map(opt => opt.value);
}

export function updateViewControls() {
  const mode = $("viewMode")?.value || "3d";

  const layerMultiCard = $("layerMultiCard");
  const layerFocusCard = $("layerFocusCard");
  const spacingCard = $("spacingCard");

  if (layerMultiCard) layerMultiCard.style.display = mode === "3d" ? "block" : "none";
  if (layerFocusCard) layerFocusCard.style.display = mode === "2d" ? "block" : "none";
  if (spacingCard) spacingCard.style.display = mode === "3d" ? "block" : "none";
}