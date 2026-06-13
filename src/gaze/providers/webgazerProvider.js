const WEBGAZER_CLICK_TRAINING_BUFFER_SIZE = 512;
const WEBGAZER_CLICK_DATA_WINDOW_KEYS = [
  'screenXClicksArray',
  'screenYClicksArray',
  'eyeFeaturesClicks',
  'dataClicks',
];

function expandDataWindow(dataWindow, DataWindow, windowSize) {
  if (dataWindow?.windowSize >= windowSize) {
    return dataWindow;
  }

  const existingData = Array.isArray(dataWindow?.data) ? dataWindow.data : [];
  return new DataWindow(windowSize, existingData);
}

function expandRegressionClickTrainingBuffers(webgazer, windowSize = WEBGAZER_CLICK_TRAINING_BUFFER_SIZE) {
  const DataWindow = webgazer?.util?.DataWindow;
  const regressions = webgazer?.getRegression?.();

  if (typeof DataWindow !== 'function' || !Array.isArray(regressions)) {
    return;
  }

  regressions.forEach((regression) => {
    WEBGAZER_CLICK_DATA_WINDOW_KEYS.forEach((key) => {
      regression[key] = expandDataWindow(regression[key], DataWindow, windowSize);
    });
  });
}

export function createWebGazerProvider({ webgazer, onGaze, onFaceQuality }) {
  function emitUnavailableFaceQuality() {
    onFaceQuality?.({
      available: false,
      reason: 'provider-no-face-quality',
    });
  }

  function configure() {
    webgazer.saveDataAcrossSessions?.(false);
    webgazer.setRegression?.('ridge');
    webgazer.setTracker?.('TFFacemesh');
    webgazer.applyKalmanFilter?.(false);
    webgazer.showFaceOverlay?.(true);
    webgazer.showFaceFeedbackBox?.(true);
    expandRegressionClickTrainingBuffers(webgazer);
  }

  return {
    async start() {
      if (!webgazer) {
        throw new Error('WebGazer did not load.');
      }

      configure();
      webgazer.showVideoPreview?.(true);
      webgazer.showPredictionPoints?.(false);
      webgazer.setGazeListener((data) => {
        if (!data) {
          return;
        }

        onGaze({
          x: data.x,
          y: data.y,
          visible: true,
          source: 'webcam',
        });
      });
      await webgazer.begin();
      emitUnavailableFaceQuality();
      webgazer.removeMouseEventListeners?.();
    },
    async resetCalibration() {
      await webgazer.clearData?.();
      expandRegressionClickTrainingBuffers(webgazer);
    },
    recordCalibrationPoint({ x, y }) {
      webgazer.recordScreenPosition?.(x, y, 'click');
    },
    stop() {
      if (webgazer.clearGazeListener) {
        webgazer.clearGazeListener();
        return;
      }

      webgazer.setGazeListener?.(null);
    },
  };
}
