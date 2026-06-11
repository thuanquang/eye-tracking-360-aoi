# Notebook AOI Generation

`google-colab-auto-aoi.ipynb` generates reviewable polygon AOIs from a study video in Google Colab.

## Inputs

- The source study video exported or selected in the browser app.
- A `colab-aoi-job-*.json` file exported from the app's Google Colab AOI panel.

The job JSON supplies the video projection, stereo layout, detection prompts, frame sample interval, polygon point budget, polygon simplification epsilon, and analysis padding.

## Output

The notebook downloads `generated-colab-aois.json`. The file contains polygon AOIs with keyframed points that can be imported through **Import Colab AOIs** or **Load AOI JSON** in the browser app.

Each generated AOI includes:

- `shape: "polygon"`
- top-level `points` from the first keyframe
- time-keyframed `points` and `maskScore`
- `analysisPaddingPx` from the exported policy plus app-readable `analysisPadding`
- generation metadata for Florence-2, SAM 2, sampling, projection, stereo layout, and detection count

## Review Warning

These AOIs are machine-generated candidates. Review every polygon in the browser app before using it for participant analysis, especially around occlusions, reflective surfaces, stereo crops, and 360 panorama wraparound boundaries.
