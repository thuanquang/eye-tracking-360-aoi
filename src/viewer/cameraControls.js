import { normalizeYaw } from '../aois/aoiMath.js';

export function clampCameraPitch(value) {
  return Math.min(85, Math.max(-85, value));
}

export function getNextCameraFromDrag({
  cameraYaw,
  cameraPitch,
  dx,
  dy,
  sensitivity = 0.12,
}) {
  return {
    cameraYaw: normalizeYaw(cameraYaw - dx * sensitivity),
    cameraPitch: clampCameraPitch(cameraPitch - dy * sensitivity),
  };
}

export function shouldAllowCameraDrag(projection) {
  return projection !== 'flat';
}
