export function createWebGazerProvider({ webgazer, onGaze }) {
  function configure() {
    webgazer.saveDataAcrossSessions?.(false);
    webgazer.setRegression?.('ridge');
    webgazer.setTracker?.('TFFacemesh');
    webgazer.applyKalmanFilter?.(false);
    webgazer.showFaceOverlay?.(true);
    webgazer.showFaceFeedbackBox?.(true);
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
      webgazer.removeMouseEventListeners?.();
    },
    async resetCalibration() {
      await webgazer.clearData?.();
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
