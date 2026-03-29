import { PHASE_LABELS } from "./constants.js";

export function normalisePhase(phase) {
  let s = String(phase || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");

  if (s === "sodalite") s = "sod";
  if (s === "diamondoid") s = "dia";
  if (s === "amorphous") s = "am";
  if (s === "unclassified") s = "u13";

  return s || "unknown";
}

export function displayPhase(phase) {
  const key = normalisePhase(phase);
  return PHASE_LABELS[key] || String(phase || "N/A").trim() || "N/A";
}

export function numericOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatValShort(v, digits = 2) {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "N/A";
  return Number(v).toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeId(text) {
  return String(text || "plot").replace(/[^a-zA-Z0-9_]/g, "_");
}

export function normaliseWash(point) {
  const code = String(point.wash_code || point.wash || "").trim().toUpperCase();
  if (code === "EW" || code === "WW") return code;

  const raw = String(point.washing || "").trim().toLowerCase();
  if (raw.includes("eth")) return "EW";
  if (raw.includes("water")) return "WW";

  return "";
}

export function ternaryXYFromPoint(p) {
  const m = Number(p.metal);
  const l = Number(p.ligand);
  const b = Number(p.bsa);

  if (
    Number.isFinite(m) &&
    Number.isFinite(l) &&
    Number.isFinite(b) &&
    (m + l + b) > 0
  ) {
    const total = m + l + b;
    const mm = m / total;
    const ll = l / total;
    const bb = b / total;

    return {
      x: ll + 0.5 * bb,
      y: (Math.sqrt(3) / 2) * bb
    };
  }

  return {
    x: Number(p.x),
    y: Number(p.y)
  };
}