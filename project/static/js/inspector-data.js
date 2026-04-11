import { PHASE_COLORS, PHASE_LABELS } from "./constants.js";
import { normalisePhase, numericOrNull, formatValShort } from "./formatters.js";

function firstDefinedNumeric(...values) {
  for (const value of values) {
    const n = numericOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function firstDefinedString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickExperimentId(exp) {
  if (!exp || typeof exp !== "object") return null;

  return firstDefinedString(
    exp.experiment_id,
    exp.experimentId,
    exp.id,
    exp.file,
    exp.filename,
    exp.file_name,
    exp.path,
    exp.name
  );
}

function stripExtension(value) {
  if (!value) return null;
  return String(value).replace(/\.[^.]+$/, "");
}

function isAtrExperiment(exp) {
  if (!exp || typeof exp !== "object") return false;

  if (exp.has_atr === true || exp.is_atr === true) return true;

  const type = String(exp.type || exp.experiment_type || exp.kind || exp.modality || "")
    .trim()
    .toLowerCase();

  if (type.includes("atr") || type.includes("ir")) return true;

  const id = String(
    exp.experiment_id ||
      exp.experimentId ||
      exp.id ||
      exp.file ||
      exp.filename ||
      exp.file_name ||
      ""
  ).toLowerCase();

  return id.includes("atr") || id.includes("ftir") || id.includes("ir");
}

function isXrdExperiment(exp) {
  if (!exp || typeof exp !== "object") return false;

  if (exp.has_xrd === true || exp.is_xrd === true) return true;

  const type = String(exp.type || exp.experiment_type || exp.kind || exp.modality || "")
    .trim()
    .toLowerCase();

  if (type.includes("xrd")) return true;

  const id = String(
    exp.experiment_id ||
      exp.experimentId ||
      exp.id ||
      exp.file ||
      exp.filename ||
      exp.file_name ||
      ""
  ).toLowerCase();

  return id.includes("xrd");
}

export function extractInspectorSummary(point) {
  return {
    eeMean: firstDefinedNumeric(
      point?.encapsulation_efficiency?.mean,
      point?.encapsulation_efficiency,
      point?.ee
    ),

    eeErr: firstDefinedNumeric(
      point?.encapsulation_efficiency?.error_bar,
      point?.encapsulation_efficiency?.std,
      point?.ee_error,
      point?.error_bar,
      point?.ee_std
    ),

    lcPercent: firstDefinedNumeric(
      point?.LC_percent,
      point?.lc_percent
    ),

    ratio: firstDefinedNumeric(
      point?.ir_data?.ratio_selected_peaks,
      point?.protein_ratio
    ),

    crystMean: firstDefinedNumeric(
      point?.crystallinity?.fractions?.crystalline?.mean,
      point?.crystalline_fraction,
      point?.crystallinity_fractions?.crystalline,
      point?.crystallinity
    ),

    crystStd: firstDefinedNumeric(
      point?.crystallinity?.fractions?.crystalline?.std,
      point?.crystallinity?.fractions?.crystalline?.error_bar,
      point?.crystallinity_std,
      point?.crystallinity_error
    ),

    amorphMean: firstDefinedNumeric(
      point?.crystallinity?.fractions?.amorphous?.mean,
      point?.amorphous_fraction,
      point?.crystallinity_fractions?.amorphous,
      point?.amorphousness
    ),

    amorphStd: firstDefinedNumeric(
      point?.crystallinity?.fractions?.amorphous?.std,
      point?.crystallinity?.fractions?.amorphous?.error_bar,
      point?.amorphousness_std,
      point?.amorphousness_error
    )
  };
}

export function extractDetectedPhases(point) {
  const phaseComp = point?.phase_composition || {};

  return Object.entries(phaseComp)
    .map(([name, obj]) => ({
      key: normalisePhase(name),
      name: PHASE_LABELS[normalisePhase(name)] || name,
      mean: firstDefinedNumeric(obj?.mean, obj),
      std: firstDefinedNumeric(obj?.std)
    }))
    .filter((phase) => phase.mean != null && phase.mean > 0)
    .sort((a, b) => b.mean - a.mean);
}

export function extractTopPhasesText(point) {
  const phases = extractDetectedPhases(point);

  if (!phases.length) {
    return "None detected";
  }

  return phases
    .map((phase) => {
      const meanPct = phase.mean * 100;
      const stdPct = phase.std == null ? null : phase.std * 100;

      if (stdPct == null) {
        return `${phase.name} ${formatValShort(meanPct, 1)}%`;
      }

      return `${phase.name} ${formatValShort(meanPct, 1)} ± ${formatValShort(stdPct, 1)}%`;
    })
    .join("; ");
}

export function buildPhaseSlices(sample) {
  const summary = extractInspectorSummary(sample);
  const result = [];

  const hasCrystalline = summary.crystMean != null && summary.crystMean > 0;
  const hasAmorphous = summary.amorphMean != null && summary.amorphMean > 0;

  if (hasAmorphous) {
    result.push({
      key: "am",
      label: "Amorphous",
      value: summary.amorphMean,
      color: PHASE_COLORS.am || "#B2B2B2"
    });
  }

  const rawPhases = extractDetectedPhases(sample).map((phase) => ({
    key: phase.key,
    label: phase.name,
    raw: phase.mean,
    color: PHASE_COLORS[phase.key] || PHASE_COLORS.unknown || "#8B8B8B"
  }));

  const rawTotal = rawPhases.reduce((sum, phase) => sum + phase.raw, 0);

  if (hasCrystalline && rawTotal > 0) {
    rawPhases.forEach((phase) => {
      const withinCrystalline = phase.raw / rawTotal;
      const finalValue = summary.crystMean * withinCrystalline;

      if (finalValue > 0) {
        result.push({
          key: phase.key,
          label: phase.label,
          value: finalValue,
          color: phase.color
        });
      }
    });
  }

  return result;
}

export function getAtrExperiment(sample) {
  const experiments = Array.isArray(sample?.experiments) ? sample.experiments : [];
  const atrExperiment = experiments.find((exp) => exp?.has_atr);

  if (atrExperiment?.experiment_id) {
    return {
      experiment_id: atrExperiment.experiment_id
    };
  }

  if (sample?.first_experiment_id) {
    return {
      experiment_id: sample.first_experiment_id
    };
  }

  return null;
}

export function getXrdExperiments(sample) {
  const explicitExperiments = Array.isArray(sample?.experiments) ? sample.experiments : [];

  if (explicitExperiments.length) {
    return explicitExperiments
      .filter((exp) => exp?.has_xrd && (exp?.xrd_file || exp?.experiment_id))
      .map((exp) => ({
        experiment_id: stripExtension(exp?.xrd_file) || pickExperimentId(exp)
      }))
      .filter((exp) => exp.experiment_id);
  }

  if (sample?.measurements && typeof sample.measurements === "object") {
    return Object.values(sample.measurements)
      .map((value) => ({
        experiment_id: stripExtension(value)
      }))
      .filter((exp) => exp.experiment_id);
  }

  return [];
}
