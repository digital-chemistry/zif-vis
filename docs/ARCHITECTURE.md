# Architecture And Handoff Notes

This document is a practical map of the app for the next person working on it. It is written to reduce re-discovery time for both human collaborators and future Codex sessions.

## 1. Purpose

The explorer visualizes ZIF biocomposite formulations in ternary composition space and links those points to sample-level and experiment-level measurements.

Main user-facing goals:

- compare samples across `Metal / Ligand / BSA` composition
- compare concentration layers
- inspect phase assignment and crystallinity
- compare encapsulation efficiency and an ATR-derived estimated ratio
- open sample-specific ATR-IR and repeated XRD measurements in the inspector
- optionally compare measured data with a predicted composition grid

## 2. Runtime flow

The runtime is intentionally simple:

1. `project/app.py`
   Creates the Flask app, loads all data once, and registers routes.
2. `project/wsgi.py`
   Mounts the Flask app under `/zif` for production deployment.
3. `project/data_loader.py`
   Reads the master JSON and builds three main structures:
   - `points`
   - `point_details`
   - `experiment_details`
3. `project/routes.py`
   Exposes the UI page and JSON endpoints consumed by the frontend.
4. `project/static/js/app.js`
   Loads point data, wires the controls, filters the active point list, and re-renders the plot.
5. Plot modules
   Render 3D stacked ternary layers or a single 2D ternary layer.
6. `project/static/js/inspector.js`
   Loads the selected sample and lazily fetches ATR/XRD spectra for the right sidebar.

## 3. Backend file map

- `project/app.py`
  Flask app factory and local dev entry point.
- `project/wsgi.py`
  Production WSGI entry point used by Docker and Gunicorn. Mounts the explorer at `/zif`.
- `project/routes.py`
  Route registration. This is the first file to edit when adding a new API endpoint.
- `project/predictor.py`
  Prototype nearest-neighbor prediction layer for single-query predictions and predicted grid generation.
- `project/data_loader.py`
  Core transformation layer from raw JSON into UI-friendly objects.
- `project/config.py`
  Central paths for JSON and experiment folders.
- `project/io_utils.py`
  Helpers for finding and reading local raw files such as `.xy`.
- `project/transform.py`
  Ternary coordinate helpers used during data preparation.

## 4. Frontend file map

### Templates

- `project/templates/index.html`
  Page shell and asset loading.
- `project/templates/_left_sidebar.html`
  Display controls, filters, composition finder, and explanatory popovers.
- `project/templates/_plot_area.html`
  Main plot container.
- `project/templates/_right_inspector.html`
  Parameters, phase composition, ATR-IR, repeated XRD, and credits.

### JavaScript

- `project/static/js/app.js`
  Frontend entry point. If a control should trigger a re-render, it is usually wired here. It also manages the measured/predicted data-layer switching and now builds API URLs from the mounted app prefix.
- `project/static/js/filters.js`
  Reads DOM control state and filters the full point list.
- `project/static/js/plot3d.js`
  Coordinates the 3D scene, including optional inter-layer guides.
- `project/static/js/plot3d-points.js`
  Marker appearance, hover content, colorbar logic, and the special search-position marker.
- `project/static/js/plot2d.js`
  2D ternary rendering and hover/marker logic for the single-layer mode.
- `project/static/js/inspector.js`
  Sample loading, ATR/XRD fetches, lazy expansion behavior, CSV download behavior, and prefix-aware API fetches.
- `project/static/js/inspector-data.js`
  Extracts sample summary information, top phases, and experiment selections from the sample payload.
- `project/static/js/inspector-render.js`
  DOM rendering for parameter cards, phase composition, and mini line plots.

### CSS

- `project/static/styles/layout.css`
  Page layout and column structure.
- `project/static/styles/panels.css`
  Shared card, panel, accordion, and sidebar styling.
- `project/static/styles/forms.css`
  Controls, sliders, segmented toggles, and form-specific elements.
- `project/static/styles/inspector.css`
  Right-panel content and experiment cards.
- `project/static/styles/responsive.css`
  Layout adjustments for smaller screens.

## 5. Data model

The loader intentionally produces three levels of data:

### `points`

Used by `/api/points` and the plot. This is the lightweight object optimized for rendering.

Important fields:

- `id`
- `metal`, `ligand`, `bsa`
- `concentration`
- `wash`, `washing`
- `phase`, `primary_phase`
- `phase_composition`
- `crystallinity`
- `ee`
- `protein_ratio`
- `experiment_ids`
- `has_atr`, `has_xrd`
- `is_predicted` for generated prediction-grid points
- `prediction_confidence`, `distance_to_known`, `trust_band` for predicted points

### `point_details`

Used by `/api/sample/<point_id>`. This keeps the original JSON information and the frontend-friendly derived fields.

Important addition:

- `experiments`

Each selected point in the inspector uses this array to discover ATR and XRD measurements.

### `experiment_details`

Used by `/api/experiment/<experiment_id>` and fallback experiment lookups.

Important fields:

- `experiment_id`
- `point_id`
- `round`
- `atr_file`
- `xrd_file`
- `has_atr`
- `has_xrd`

## 6. Current visualization decisions

These are not accidental. They were chosen deliberately during the recent UI cleanup.

### Marker semantics

- `Phase`
  Uses the dual-marker representation in 3D:
  - large amorphous base marker
  - smaller inner marker colored by phase blend
- `Crystallinity`
  Uses a single full-size colored marker.
- `Encapsulation efficiency`
  Uses a single full-size colored marker.
- `Estimated ATR ratio`
  Uses a single full-size colored marker.
- `None`
  Uses a neutral full-size marker.

### Data layers

- `Experimental`
  Uses only measured points loaded from the JSON summary.
- `Prediction`
  Uses only generated prediction-grid points.
- `Both`
  Overlays measured and prediction-grid points.

Prediction-grid points are intentionally restricted to the experimentally covered composition domain. The app should not predict outside the physical/input region represented in the measured dataset.

### Prediction probability semantics

The prediction probability color modes are intended as contribution-presence maps:

- `Sodalite probability`
- `ZIF-C probability`
- etc.

These should be described as the likelihood of finding that phase contribution at a location, not as the probability of obtaining a phase-pure material.

Probability-like scales are clamped to `0..1` so they remain visually honest and comparable.

Reason:
The dual-marker model is helpful for phase because it simultaneously shows amorphous background and crystalline assignment. For the scalar quantities, a single full-size color mapping reads more clearly and already has a scale bar.

### Hover behavior

Hover cards are intentionally compact. They prioritize:

- sample id
- Metal / Ligand / BSA composition
- concentration layer
- wash type
- primary phase
- EE

Deeper scientific detail belongs in the right inspector rather than in the hover card.

### Help popovers

Small `?` popovers are now the standard way to explain controls and scientific terms to first-time visitors. If a new control is added, it should usually include a matching explanation.

### Inspector downloads

ATR and repeated XRD sections now support CSV download from the browser.

Implementation note:
This is handled entirely in `project/static/js/inspector.js` via `Blob` download logic. No dedicated download route is required at the moment.

## 7. Where to edit common features

### Change hover content

- `project/static/js/plot3d-points.js`
- `project/static/js/plot2d.js`

### Change which metrics appear in the inspector summary

- `project/static/js/inspector-data.js`
- `project/static/js/inspector-render.js`

### Add or revise help text

- `project/templates/_left_sidebar.html`
- `project/templates/_right_inspector.html`

### Add a new filter control

1. Add markup in `project/templates/_left_sidebar.html`
2. Read it in `project/static/js/filters.js`
3. Wire updates in `project/static/js/app.js`
4. Reflect any needed styling in `project/static/styles/forms.css`

### Change the prediction domain or predicted-grid density

- `project/predictor.py`
- `project/routes.py`
- `project/static/js/app.js`

### Change marker logic or colorbar behavior

- `project/static/js/plot3d-points.js`
- `project/static/js/plot2d.js`
- `project/static/js/constants.js`

### Change ATR/XRD download behavior

- `project/static/js/inspector.js`

## 8. Known gotchas

### UTF-8 BOM can break layout

An included template with a BOM at the beginning can create a visible layout bug in the grid. If the page suddenly shifts horizontally after a rewrite, check for hidden BOM bytes first.

### The app is frontend-driven

Most visible behavior is not controlled by Flask templates after initial page load. If something looks wrong in the plot or inspector, the fix is usually in `project/static/js/`.

### Deployment uses a mounted subpath

Production is now intended to run under `/zif/` rather than `/`.

- `project/wsgi.py` mounts the Flask app at `/zif`
- the frontend reads `window.ZIF_BASE_PATH` from the template shell
- API requests should always be built from that prefix, not hardcoded as `/api/...`

### Raw experiment folders may be local-only

The summary JSON is the minimum data required for the explorer. ATR/XRD/image content depends on local files being present and correctly named.

### Some text labels may still contain historical encoding artifacts

If you see garbled scientific symbols, treat it as an encoding cleanup task rather than a logic bug.

## 9. Good next improvements

Reasonable future work items:

- refine the scientific wording of help popovers with domain-reviewed language
- add confidence masking or fading for predicted-grid points that are far from known measured space
- export ATR and XRD plots as images in addition to CSV
- add a compact glossary for terms such as EE, crystallinity, amorphous fraction, and ATR ratio
- add tests for data loading and endpoint behavior
- add smoke tests for `/zif/` deployment behavior and static asset URLs

## 10. Suggested starting points for a future Codex session

If a future session needs to make UI changes, start by reading:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `project/templates/_left_sidebar.html`
4. `project/templates/_right_inspector.html`
5. `project/static/js/app.js`
6. `project/static/js/plot3d-points.js`
7. `project/static/js/inspector.js`

That sequence usually gives enough context to make safe changes quickly.
