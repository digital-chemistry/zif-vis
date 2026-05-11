import re
from pathlib import Path


def read_xy(path: Path):
    xs, ys = [], []

    if not path.exists():
        return {"x": [], "y": []}

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#"):
                continue

            lower = line.lower()
            if lower.startswith("x=") or lower.startswith("y="):
                continue
            if "wavenumber" in lower or "absorbance" in lower or "intensity" in lower:
                continue

            parts = re.split(r"[\s,;\t]+", line)
            if len(parts) < 2:
                continue

            try:
                x = float(parts[0])
                y = float(parts[1])
            except ValueError:
                continue

            xs.append(x)
            ys.append(y)

    return {"x": xs, "y": ys}


def find_existing_file(folder: Path, stem: str):
    if not folder.exists():
        return None

    exts = [
        ".xy", ".XY", ".txt", ".TXT", ".csv", ".CSV",
        ".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG",
        ".webp", ".WEBP", ".tif", ".TIF", ".tiff", ".TIFF"
    ]

    for ext in exts:
        candidate = folder / f"{stem}{ext}"
        if candidate.exists() and candidate.is_file():
            return candidate.name

    target = str(stem).lower()
    for p in folder.glob("*"):
        if p.is_file() and p.stem.lower() == target:
            return p.name

    return None