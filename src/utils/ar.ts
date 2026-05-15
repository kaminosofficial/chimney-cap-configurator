import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { CapConfig } from '../store/configStore.js';

export const SC = 0.02;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
  }
  return btoa(binary);
}

export function exportToGLB(grp: THREE.Group): Promise<string> {
  return new Promise((resolve, reject) => {
    const exportGroup = grp.clone();
    const scale = 0.0254 / SC;
    exportGroup.scale.set(scale, scale, scale);
    exportGroup.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.envMap = null;
        m.envMapIntensity = 0;
        m.side = THREE.DoubleSide;
        (m as any).normalMap = null;
        m.transparent = false;
        m.depthWrite = true;
        m.needsUpdate = true;
        mesh.material = m;
      }
    });
    exportGroup.updateMatrixWorld(true);
    const exporter = new GLTFExporter();
    exporter.parse(exportGroup, (result) => {
      if (result instanceof ArrayBuffer) {
        resolve('data:model/gltf-binary;base64,' + arrayBufferToBase64(result));
      } else {
        const json = JSON.stringify(result);
        resolve('data:model/gltf+json;base64,' + btoa(unescape(encodeURIComponent(json))));
      }
    }, (err) => reject(err), { binary: true });
  });
}

export function getConfigState(config: Partial<CapConfig>): string {
  const state: any = {
    m: config.mount,
    lt: config.lid_type,
    l: config.length,
    w: config.width,
    vs: config.vertical_skirt,
    hs: config.horizontal_skirt,
    de: config.drip_edge ? 1 : 0,
    fw: config.flange_width,
    sh: config.screen_height,
    lo: config.lid_overhang,
    lp: config.lid_pitch,
    sc: config.seam_count,
    mat: config.material,
    pc: config.powder_coat ? 1 : 0,
    pcc: config.powder_coat_color,
  };
  return btoa(JSON.stringify(state));
}

export function applyConfigState(base64: string): Partial<CapConfig> {
  try {
    const s = JSON.parse(atob(base64));
    return {
      mount: s.m || 'skirt',
      lid_type: s.lt || 'hip_ridge',
      length: parseFloat(s.l) || 36,
      width: parseFloat(s.w) || 24,
      vertical_skirt: parseFloat(s.vs) || 3,
      horizontal_skirt: parseFloat(s.hs) || 2,
      drip_edge: !!s.de,
      flange_width: parseFloat(s.fw) || 1.5,
      screen_height: parseFloat(s.sh) || 10,
      lid_overhang: parseFloat(s.lo) || 4,
      lid_pitch: parseFloat(s.lp) || 5,
      seam_count: parseFloat(s.sc) || 4,
      material: s.mat || 'stainless',
      powder_coat: !!s.pc,
      powder_coat_color: s.pcc || '#0B0E0F',
    };
  } catch {
    return {};
  }
}
