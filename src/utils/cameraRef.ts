import * as THREE from 'three';

// Module-level refs — set by a component inside the Canvas, called from outside
export const cameraActions = {
  reset: () => {},
  top: () => {},
  front: () => {},
  // Frames the camera to the model's bounding box so the product is a consistent
  // size and fully visible (never cropped, never tiny) regardless of dimensions —
  // used by the screenshot capture (cart image + PDF).
  fitView: () => {},
  // snapshot()/restore() bracket a capture: save the user's current camera before
  // fitView() reframes for the screenshot, then put it back so the live viewer
  // isn't left "stuck" at the capture pose.
  snapshot: () => {},
  restore: () => {},
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
  cameraActions.fitView = () => {
    const grp = (window as any).__chaseGroup as THREE.Group | undefined;
    const cam = camera as THREE.PerspectiveCamera;
    if (!grp) { cameraActions.reset(); return; }
    const box = new THREE.Box3().setFromObject(grp);
    if (box.isEmpty()) { cameraActions.reset(); return; }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = Math.max(sphere.radius, 0.001);
    // Fit the bounding sphere to whichever FOV dimension is tighter (handles any
    // canvas aspect), then add an 18% margin so the product never touches edges.
    const halfV = ((Number(cam.fov) || 45) * Math.PI / 180) / 2;
    const aspect = Number(cam.aspect) || 1;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const dist = (radius / Math.sin(Math.min(halfV, halfH))) * 1.18;
    // Keep the same isometric view direction as reset(), only scale the distance.
    const dir = new THREE.Vector3(1.5, 1.2, 1.5).normalize();
    // Temporarily lift the orbit distance clamps so even the smallest product frames
    // to the same size (restored immediately; the captured frame keeps this pose).
    const prevMin = controls.minDistance;
    const prevMax = controls.maxDistance;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.target.copy(sphere.center);
    cam.position.copy(sphere.center.clone().add(dir.multiplyScalar(dist)));
    // NOTE: intentionally do NOT touch cam.near/cam.far here. The camera's near/far
    // are set once on the Canvas (small near, tight far) and must stay put — setting
    // a large near would slice the model at the near plane when zooming in after a
    // capture. fitView only repositions the camera now.
    controls.update();
    controls.minDistance = prevMin;
    controls.maxDistance = prevMax;
  };

  let savedView: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  cameraActions.snapshot = () => {
    savedView = { pos: camera.position.clone(), target: controls.target.clone() };
  };
  cameraActions.restore = () => {
    if (!savedView) return;
    camera.position.copy(savedView.pos);
    controls.target.copy(savedView.target);
    controls.update();
    savedView = null;
  };
}
