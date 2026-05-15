import * as THREE from 'three';

// Module-level refs — set by a component inside the Canvas, called from outside
export const cameraActions = {
  reset: () => {},
  top: () => {},
  front: () => {},
};

export function bindCameraActions(camera: THREE.Camera, controls: any) {
  cameraActions.reset = () => {
    controls.target.set(0, 0.04, 0);
    camera.position.set(1.5, 1.2, 1.5);
    controls.update();
  };
  cameraActions.top = () => {
    controls.target.set(0, 0.04, 0);
    camera.position.set(0.01, 4, 0);
    controls.update();
  };
  cameraActions.front = () => {
    controls.target.set(0, 0.04, 0);
    camera.position.set(3.5, 0.5, 0);
    controls.update();
  };
}
