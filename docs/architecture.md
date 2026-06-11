# AOI Prototype Architecture

The app is a static browser prototype. `src/app.js` is the entrypoint and delegates to `src/app/appController.js`.

## Domains

- `src/aois`: AOI schema, geometry, projection, import, and detection output conversion.
- `src/gaze`: raw gaze providers, calibration, correction, validation, and quality monitoring.
- `src/recording`: sample construction, export payloads, replay, and analysis metrics.
- `src/viewer`: projection metadata and camera interaction helpers.
- `src/app`: browser orchestration, DOM lookup, initial state, and constants.

## Rule

Pure behavior belongs in domain modules with Node tests. Browser orchestration belongs in the controller and Playwright smoke tests.
