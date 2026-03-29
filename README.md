# ZIF Biocomposite Explorer

Interactive Flask app for exploring ZIF biocomposite formulations, phase composition, crystallinity, and experiment-level spectra.

## What is in the repo

- Flask backend under `project/`
- Modular frontend assets under `project/static/` and `project/templates/`
- Main summary dataset at `project/zif_biocomposite_summary_by_point.json`
- App logo at `project/static/logo.png`

## What is intentionally not tracked

Large raw experiment asset folders stay local by default:

- `project/ATR_xy/`
- `project/XRD_xy/`
- `project/images/`

The app can still run without those folders, but ATR/XRD/image endpoints will only work when the matching local files are present.

## Setup

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

## Project structure

- `project/app.py`: Flask app entry point
- `project/routes.py`: API and page routes
- `project/data_loader.py`: dataset loading and experiment indexing
- `project/templates/`: main page layout and panels
- `project/static/js/`: plotting, filtering, and inspector logic
- `project/static/styles/`: layout and component styles

## Notes

- The development server currently runs with `debug=True`.
- A good next step for publishing is adding a production WSGI entry point and optional sample data for the ignored experiment folders.
