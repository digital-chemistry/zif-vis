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
      `.phase-check[data-phase="${phase