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

/**
 * glTF has no `alphaMap` slot — alpha must live in the base-colour texture's
 * alpha channel. The perforated screen-mesh panels use a separate grayscale
 * `alphaMap` for their cutout, which GLTFExporter silently drops, so the
 * screens render solid in AR. Fix: bake the alphaMap pattern into an RGBA
 * `map` (RGB = the material colour, A = the cutout pattern) and switch the
 * material to alphaTest — which the exporter writes as glTF alphaMode MASK,
 * a hard cutout that renders see-through correctly in <model-viewer> AR.
 */
function bakeScreenAlphaIntoMap(m: THREE.MeshStandardMaterial): void {
  const alphaMap = m.alphaMap;
  const srcImage = alphaMap?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!alphaMap || !srcImage) return;

  const w = srcImage.width || 64;
  const h = srcImage.height || 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(srcImage, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  // sRGB 0-255 colour, robust against Three's colour management.
  const hex = m.color ? m.color.getHexString() : '888888';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  for (let i = 0; i < data.length; i += 4) {
    // Screen texture is black (transparent) with white strokes (opaque) —
    // alphaMap reads luminance as alpha, so use the red channel as the mask.
    data[i + 3] = data[i];
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = alphaMap.wrapS;
  tex.wrapT = alphaMap.wrapT;
  tex.repeat.copy(alphaMap.repeat);
  tex.offset.copy(alphaMap.offset);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  m.map = tex;
  m.alphaMap = null;
  m.alphaTest = m.alphaTest > 0 ? m.alphaTest : 0.5;
  m.transparent = false; // alphaTest → glTF MASK mode (hard cutout, AR-correct)
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
        if (m.alphaMap) {
          // Perforated screen mesh — keep it see-through in AR.
          bakeScreenAlphaIntoMap(m);
        } else {
          m.transparent = false;
        }
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
