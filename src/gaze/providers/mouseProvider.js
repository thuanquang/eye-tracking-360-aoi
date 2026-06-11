export function createMouseProvider({ viewer, onGaze }) {
  let active = false;

  function handlePointerMove(event) {
    if (!active) {
      return;
    }

    const rect = viewer.getBoundingClientRect();
    onGaze({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      visible: true,
      source: 'mouse',
    });
  }

  return {
    start() {
      active = true;
      viewer.addEventListener('pointermove', handlePointerMove);
    },
    stop() {
      active = false;
      viewer.removeEventListener('pointermove', handlePointerMove);
    },
  };
}
