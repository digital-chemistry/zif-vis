import argparse
import json
from copy import deepcopy
from pathlib import Path


def _numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def phase_composition_uses_percent_units(phase_comp):
    if not isinstance(phase_comp, dict) or not phase_comp:
        return False

    for phase_values in phase_comp.values():
        if isinstance(phase_values, dict):
            mean = phase_values.get("mean")
            std = phase_values.get("std")
            if (_numeric(mean) and abs(mean) > 1.0) or (_numeric(std) and abs(std) > 1.0):
                return True
        elif _numeric(phase_values) and abs(phase_values) > 1.0:
            return True

    return False


def normalise_phase_composition(phase_comp):
    if not phase_composition_uses_percent_units(phase_comp):
        return deepcopy(phase_comp), False

    cleaned = {}
    for phase_name, phase_values in phase_comp.items():
        if isinstance(phase_values, dict):
            cleaned_values = deepcopy(phase_values)
            for key in ("mean", "std"):
                value = cleaned_values.get(key)
                if _numeric(value):
                    cleaned_values[key] = value / 100.0
            cleaned[phase_name] = cleaned_values
        elif _numeric(phase_values):
            cleaned[phase_name] = phase_values / 100.0
        else:
            cleaned[phase_name] = deepcopy(phase_values)

    return cleaned, True


def sanitise_payload(payload):
    cleaned = deepcopy(payload)
    changed_points = []

    for point_id, entry in cleaned.items():
        if not isinstance(entry, dict):
            continue
        phase_comp = entry.get("phase_composition")
        normalised, changed = normalise_phase_composition(phase_comp)
        if changed:
            entry["phase_composition"] = normalised
            changed_points.append(point_id)

    return cleaned, changed_points


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}_sanitized{input_path.suffix}")


def main():
    parser = argparse.ArgumentParser(
        description="Normalize mixed phase_composition units (percent vs fraction) in a manual ZIF JSON."
    )
    parser.add_argument(
        "input_json",
        help="Path to the source JSON file to sanitize."
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Where to write the sanitized JSON. Defaults to a *_sanitized.json sibling."
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the input file instead of writing a separate sanitized copy."
    )
    args = parser.parse_args()

    input_path = Path(args.input_json)
    if not input_path.exists():
        raise FileNotFoundError(f"Input JSON not found: {input_path}")

    output_path = input_path if args.in_place else Path(args.output) if args.output else default_output_path(input_path)

    with input_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    cleaned, changed_points = sanitise_payload(payload)

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(cleaned, handle, indent=4)
        handle.write("\n")

    print(f"Input:  {input_path}")
    print(f"Output: {output_path}")
    print(f"Points normalized: {len(changed_points)}")
    if changed_points:
        preview = ", ".join(changed_points[:10])
        if len(changed_points) > 10:
            preview += ", ..."
        print(f"Examples: {preview}")


if __name__ == "__main__":
    main()
