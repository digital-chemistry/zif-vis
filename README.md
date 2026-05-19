# ZIF Biocomposite Explorer

**Author and maintainer:** Aleksandar Kondinski, Graz University of Technology

Interactive Flask app for exploring ZIF biocomposite formulations across ternary composition, concentration, phase assignment, crystallinity, encapsulation efficiency, ATR-IR and XRD spectra, and model-derived prediction overlays.

## Scientific role of this software

This repository provides the interactive visualisation and exploration layer for ZIF biocomposite datasets. The app enables inspection of measured and model-derived synthesis points across ternary composition space, concentration layers, phase assignment, crystallinity, encapsulation efficiency, ATR-IR descriptors, and repeated XRD measurements.

The interface links structured dataset outputs to visual exploration, allowing users to inspect individual synthesis points, compare experimental and model-derived regions, and access experiment-level spectra through a browser-based dashboard. In this role, the app serves as a presentation, inspection, and exploratory-analysis layer for ZIF biocomposite synthesis–structure–property datasets.

The app is designed to support both domain experts and first-time visitors by combining compact visual summaries with detailed inspector panels, help popovers, and direct access to spectra and downloadable CSV data where available.

## What this app shows

The explorer combines a summary dataset with repeat-level ATR-IR and XRD measurements.

- The main plot shows sample points in ternary composition space.
- The 3D view stacks concentration layers vertically.
- The 2D view isolates one concentration layer at a time.
- The right inspector explains the selected sample with parameters, phase composition, ATR-IR, and repeated XRD measurements.

The interface is intentionally usable for both domain experts and first-time visitors, so several controls now include short help popovers and the inspector carries the heavier detail.

The explorer also now supports a prediction layer:

- `Experimental` shows only measured samples.
- `Prediction` shows model-derived grid points only within the experimentally supported composition domain.
- `Both` overlays measured and predicted points together.

Prediction phase-probability views should be interpreted as model-derived likelihoods of phase contribution at a location, not as confirmed experimental measurements or as probabilities of phase-pure materials.

For details of the feature engineering, classifier, nearest-neighbour regression, and trust-band logic used by the prediction layer, see [`docs/PREDICTION_METHOD.md`](docs/PREDICTION_METHOD.md).

## Quick start

1. Create a virtual environment:

```powershell
python -m venv .venv
```

2. Activate it on Windows:

```powershell
.venv\Scripts\activate
```

3. Install dependencies:

```powershell
pip install -r requirements.txt
```

4. Run the app:

```powershell
python -m project.app
```

5. Open `http://127.0.0.1:8000`

## Quality checks

Run the lightweight backend smoke tests:

```powershell
python -m unittest discover -s tests -v
```

Check the Python package syntax:

```powershell
python scripts/check_python_syntax.py
```

If `node` is available locally, check the frontend modules for syntax errors:

```powershell
Get-ChildItem project\static\js\*.js | ForEach-Object { node --check $_.FullName }
```

The repository also now includes a GitHub Actions workflow that runs these checks automatically on pushes and pull requests.

## Docker deployment at `/zif/`

This repo is now packaged for deployment under `digital-chemistry.io/zif/`.

Local container test:

```bash
docker compose up -d --build
```

Then open:

```text
http://127.0.0.1:8000/zif/
```

Production handoff notes live in [`DEPLOY.md`](DEPLOY.md).

## Repository layout

- `project/app.py`
  Flask entry point. Loads the data once and registers routes.
- `project/routes.py`
  HTML page route plus JSON endpoints for points, prediction grid data, sample details, spectra, and images.
- `project/data_loader.py`
  Builds the frontend-friendly point summaries, detailed sample records, and experiment index.
- `project/predictor.py`
  Lightweight nearest-neighbor prototype predictor used for single-point prediction and predicted-grid generation.
- `project/templates/`
  Main layout and the three panel partials:
  - `_left_sidebar.html`
  - `_plot_area.html`
  - `_right_inspector.html`
- `project/static/js/`
  Frontend logic. Plotting, filtering, hover text, inspector loading, and downloads all live here.
- `project/static/styles/`
  Token, layout, panel, form, inspector, and responsive styles.
- `project/Exp-A.json`
  Main summary dataset used to build points and inspector content.

## Data and local assets

The repo is designed to run with the summary JSON and optional local experiment folders:

- `project/Exp-A.json`
- `project/ATR_xy/`
- `project/XRD_xy/`
- `project/images/`

The summary JSON drives the explorer even when the raw experiment folders are absent. When those folders are missing, the app still runs, but ATR, XRD, and image endpoints only return data for files that exist locally.

## How the app is organized

At runtime the flow is:

1. `project/app.py` loads all point and experiment data at startup.
2. `project/routes.py` serves `/api/points` for the plot and `/api/sample/<id>` for the inspector.
3. `project/static/js/app.js` loads points, wires controls, filters the dataset, and re-renders the plot.
4. Plot modules render either the stacked 3D view or the single-layer 2D ternary view.
5. `project/static/js/inspector.js` loads the selected sample, then lazily fetches ATR and XRD spectra for the right panel.

## Current UX conventions

These decisions are intentional and should generally be preserved unless the visualization strategy changes:

- `Color by = Phase` uses a two-layer marker model in 3D so amorphous content remains visible beneath the phase-colored core.
- Model-derived prediction grids are restricted to the experimentally covered composition domain rather than the full ternary simplex.
- Probability-like model-derived prediction views are displayed on a fixed `0..1` scale.
- `Crystallinity`, `Encapsulation efficiency`, `Estimated ATR ratio`, and `None` use single full-size colored markers instead of the two-layer phase encoding.
- Hover cards are kept compact and composition-focused. Detailed metrics belong in the right inspector.
- Help popovers are used for novice-facing controls and scientific terms.
- ATR and repeated XRD sections allow direct CSV download from the inspector.

## Developer notes

- Local development can enable debug mode with `FLASK_DEBUG=1`.
- Production Docker runs through `gunicorn` with the WSGI app mounted at `/zif`.
- The frontend is intentionally modular; avoid moving styling back into inline template `<style>` blocks.
- Be careful with file encoding when rewriting templates or static assets. A UTF-8 BOM at the start of an included template can visibly break the layout.
- If you are extending the app, start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). It documents the data model, module map, and the main extension points for future contributors.
