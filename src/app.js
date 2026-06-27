import * as THREE from 'three';
import { createAppController } from './app/appController.js?v=nguyen-hue-updated-angle-1';

createAppController({
  document,
  window,
  THREE,
}).start();
