# Notebook AOI Generation

`google-colab-auto-aoi.ipynb` generates reviewable polygon AOIs from a study video in Google Colab.

## Inputs

- The source study video exported or selected in the browser app.
- A `colab-aoi-job-*.json` file exported from the app's Google Colab AOI panel.

The job JSON supplies the video projection, stereo layout, detection prompts, frame sample interval, polygon point budget, polygon simplification epsilon, and analysis padding.

## Workflow

1. Open `google-colab-auto-aoi.ipynb` in Google Colab.
2. Choose a GPU runtime.
3. Run the setup cell.
4. Upload the study video and `colab-aoi-job-*.json`.
5. Run the remaining cells.
6. Download `generated-colab-aois.json`.
7. Import the JSON in Admin mode with **Import Colab AOIs**.
8. Review, rename, recolor, adjust padding, or delete generated AOIs before participant collection.

## Output

The notebook downloads `generated-colab-aois.json`. The file contains polygon AOIs with keyframed points that can be imported through **Import Colab AOIs** or **Load AOI JSON** in the browser app.

Each generated AOI includes:

- `shape: "polygon"`
- top-level `points` from the first keyframe
- time-keyframed `points` and `maskScore`
- `analysisPaddingPx` from the exported policy plus app-readable `analysisPadding`
- generation metadata for Florence-2, SAM 2, sampling, projection, stereo layout, and detection count

Flat videos use full-frame coordinates. Equirectangular stereo videos use the cropped left/top eye frame for detection and polygon normalization.

## Review Warning

These AOIs are machine-generated candidates. Review every polygon in the browser app before using it for participant analysis, especially around occlusions, reflective surfaces, stereo crops, and 360 panorama wraparound boundaries.
