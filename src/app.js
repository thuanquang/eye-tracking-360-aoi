import * as THREE from 'three';
import { createAppController } from './app/appController.js?v=youtube-2d-1';

createAppController({
  document,
  window,
  THREE,
}).start();
