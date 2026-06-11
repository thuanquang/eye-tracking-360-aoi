import * as THREE from 'three';
import { createAppController } from './app/appController.js';

createAppController({
  document,
  window,
  THREE,
}).start();
