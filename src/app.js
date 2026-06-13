import * as THREE from 'three';
import { createAppController } from './app/appController.js?v=viewer-yaw-1';

createAppController({
  document,
  window,
  THREE,
}).start();
