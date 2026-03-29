export const $ = (id) => document.getElementById(id);

export function updateViewControls() {
  const mode = document.querySelector('input[name="viewMode"]:checked')?.value || "3d";

  const layerMultiCard = $("layerMultiCard");
  const layerFocusCard = $("layerFocusCard");

  if (layerMultiCard) layerMultiCard.style.display = mode === "3d" ? "block" : "none";
  if (layerFocusCard) layerFocusCard.style.display = mode === "2d" ? "block" : "none";
}