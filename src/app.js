import * as THREE from 'three';
import { createAppController } from './app/appController.js?v=nguyen-hue-1';

createAppController({
  document,
  window,
  THREE,
}).start();
