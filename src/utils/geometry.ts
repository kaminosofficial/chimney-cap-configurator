import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import type { CapConfig, Mat } from '../store/configStore.js';

export const SC = 0.02;

export const PITCHED_SKIRT_ANGLE_DEG    = 55;
export const TOP_MOUNT_BOLT_SPACING_IN  = 6;
export const TOP_MOUNT_BOLT_HEAD_DIA_IN = 0.5;
export const STANDING_SEAM_RIB_HEIGHT_IN = 1.25;
export const STANDING_SEAM_RIB_SPACING_IN = 8;
export const SCREEN_POST_THICKNESS_IN   = 0.75;
export const DRIP_EDGE_DROP_IN          = 0.5;

export function mkMat(
  mat: Mat,
  pc: boolean,
  pcCol: string
): THREE.MeshStandardMaterial {
  if (mat === 'copper') return new THREE.MeshStandardMaterial({ color: '#e09a72', metalness: 0.85, roughness: 0.15, envMapIntensity: 1.2 });
  if (pc) return new THREE.MeshStandardMaterial({ color: pcCol, metalness: 0.3, roughness: 0.6 });
  return new THREE.MeshStandardMaterial({ color: '#888d91', metalness: 0.85, roughness: 0.2, envMapIntensity: 1.5 });
}

let screenTex: THREE.CanvasTexture | null = null;
function getScreenTexture(): THREE.CanvasTexture {
  if (screenTex) return screenTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000'; // transparent in alpha map
  ctx.fillRect(0, 0, 64, 128);
  ctx.strokeStyle = '#ffffff'; // opaque in alpha map
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(64, 64);
  ctx.lineTo(32, 128);
  ctx.lineTo(0, 64);
  ctx.closePath();
  ctx.stroke();
  screenTex = new THREE.CanvasTexture(canvas);
  screenTex.wrapS = THREE.RepeatWrapping;
  screenTex.wrapT = THREE.RepeatWrapping;
  screenTex.anisotropy = 4;
  return screenTex;
}

export function buildCap(capRoot: THREE.Group, config: CapConfig) {
  capRoot.clear();

  const t = 0.0239 * SC;
  const mat = mkMat(config.material, config.powder_coat, config.powder_coat_color);
  const w = config.width * SC;
  const l = config.length * SC;

  // 1. Mount Group
  const mountGroup = new THREE.Group();
  mountGroup.name = 'mount';
  capRoot.add(mountGroup);

  // -- Skirt Mount --
  const mountSkirt = new THREE.Group();
  mountSkirt.name = 'mount_skirt';
  mountGroup.add(mountSkirt);

  const hs = config.horizontal_skirt * SC;
  const vs = config.vertical_skirt * SC;
  const hw = w / 2;
  const hl = l / 2;
  const baseInset = SCREEN_POST_THICKNESS_IN * SC;
  const hw_in = hw - baseInset;
  const hl_in = hl - baseInset;

  function createMiteredFlange(
    hw_i: number, hl_i: number,
    hw_o: number, hl_o: number,
    thickness: number, py: number, name: string,
    hasHoles: boolean = false
  ) {
    const group = new THREE.Group();
    group.name = name;
    const gap = 0.05 * SC; // microscopic gap to show seam

    function addTrapezoid(x1: number, z1: number, x2: number, z2: number, x3: number, z3: number, x4: number, z4: number, side: 'N'|'S'|'E'|'W') {
      const shape = new THREE.Shape();
      shape.moveTo(x1, z1);
      shape.lineTo(x2, z2);
      shape.lineTo(x3, z3);
      shape.lineTo(x4, z4);
      shape.lineTo(x1, z1);

      if (hasHoles) {
        const holeRadius = 0.125 * SC; // 1/4" diameter holes
        const holeSpacing = 1.0 * SC;  // 1.0" spacing for dense zigzag
        const widthF = hw_o - hw_i;
        const pad = 0.5 * SC;

        if (side === 'N' || side === 'S') {
           const zA = side === 'N' ? -(hl_i + widthF * 0.33) : hl_i + widthF * 0.33;
           const zB = side === 'N' ? -(hl_i + widthF * 0.66) : hl_i + widthF * 0.66;
           const maxXA = hw_i + widthF * 0.33;
           const maxXB = hw_i + widthF * 0.66;
           
           const count = Math.floor((hw_o * 2) / holeSpacing);
           const actualSpacing = (hw_o * 2) / count;

           let staggered = false;
           for (let i = 0; i <= count; i++) {
              const x = -hw_o + i * actualSpacing;
              const z = staggered ? zA : zB;
              const maxX = staggered ? maxXA : maxXB;
              if (x >= -maxX + pad && x <= maxX - pad) {
                const h = new THREE.Path();
                h.absarc(x, z, holeRadius, 0, Math.PI*2, false);
                shape.holes.push(h);
              }
              staggered = !staggered;
           }
        }
        if (side === 'E' || side === 'W') {
           const xA = side === 'W' ? -(hw_i + widthF * 0.33) : hw_i + widthF * 0.33;
           const xB = side === 'W' ? -(hw_i + widthF * 0.66) : hw_i + widthF * 0.66;
           const maxZA = hl_i + widthF * 0.33;
           const maxZB = hl_i + widthF * 0.66;
           
           const count = Math.floor((hl_o * 2) / holeSpacing);
           const actualSpacing = (hl_o * 2) / count;

           let staggered = false;
           for (let i = 0; i <= count; i++) {
              const z = -hl_o + i * actualSpacing;
              const x = staggered ? xA : xB;
              const maxZ = staggered ? maxZA : maxZB;
              if (z >= -maxZ + pad && z <= maxZ - pad) {
                const h = new THREE.Path();
                h.absarc(x, z, holeRadius, 0, Math.PI*2, false);
                shape.holes.push(h);
              }
              staggered = !staggered;
           }
        }
      }

      const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = py;
      mesh.castShadow = true;
      group.add(mesh);
    }

    // North
    addTrapezoid(
      -hw_o + gap, -(hl_o),
       hw_o - gap, -(hl_o),
       hw_i - gap, -(hl_i),
      -hw_i + gap, -(hl_i),
      'N'
    );
    // South
    addTrapezoid(
       hw_o - gap,  (hl_o),
      -hw_o + gap,  (hl_o),
      -hw_i + gap,  (hl_i),
       hw_i - gap,  (hl_i),
      'S'
    );
    // East
    addTrapezoid(
       hw_o, -(hl_o) + gap,
       hw_o,  (hl_o) - gap,
       hw_i,  (hl_i) - gap,
       hw_i, -(hl_i) + gap,
      'E'
    );
    // West
    addTrapezoid(
      -hw_o,  (hl_o) - gap,
      -hw_o, -(hl_o) + gap,
      -hw_i, -(hl_i) + gap,
      -hw_i,  (hl_i) - gap,
      'W'
    );

    return group;
  }

  // horizontal flange
  const meshH = createMiteredFlange(hw_in, hl_in, hw + hs, hl + hs, t, 0, 'mount_skirt_horizontal');
  mountSkirt.add(meshH);

  // vertical flange
  function makeSkirtVert(width: number, length: number, height: number, py: number) {
    const sV = new THREE.Shape();
    sV.moveTo(-width/2, -length/2);
    sV.lineTo(width/2, -length/2);
    sV.lineTo(width/2, length/2);
    sV.lineTo(-width/2, length/2);
    sV.lineTo(-width/2, -length/2);
    const hV = new THREE.Path();
    hV.moveTo(-width/2 + t, -length/2 + t);
    hV.lineTo(-width/2 + t, length/2 - t);
    hV.lineTo(width/2 - t, length/2 - t);
    hV.lineTo(width/2 - t, -length/2 + t);
    hV.lineTo(-width/2 + t, -length/2 + t);
    sV.holes.push(hV);
    const gV = new THREE.ExtrudeGeometry(sV, { depth: height, bevelEnabled: false });
    const mV = new THREE.Mesh(gV, mat);
    mV.rotation.x = Math.PI / 2;
    mV.position.y = py;
    mV.castShadow = true;
    return mV;
  }

  function makeLidPerimeterReturn(width: number, length: number, height: number, py: number) {
    const hW = width / 2;
    const hL = length / 2;
    const yTop = py;
    const yBottom = py - height;
    const verts: number[] = [];

    const addQuad = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
      verts.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
    };

    addQuad([-hW, yTop, -hL], [ hW, yTop, -hL], [ hW, yBottom, -hL], [-hW, yBottom, -hL]); // North
    addQuad([ hW, yTop,  hL], [-hW, yTop,  hL], [-hW, yBottom,  hL], [ hW, yBottom,  hL]); // South
    addQuad([ hW, yTop, -hL], [ hW, yTop,  hL], [ hW, yBottom,  hL], [ hW, yBottom, -hL]); // East
    addQuad([-hW, yTop,  hL], [-hW, yTop, -hL], [-hW, yBottom, -hL], [-hW, yBottom,  hL]); // West

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  const slopedMat = mat.clone();
  slopedMat.side = THREE.DoubleSide;

  function makeDripEdge(innerW: number, innerL: number, drop: number, py: number) {
    const geo = new THREE.BufferGeometry();
    const hW1 = innerW / 2;
    const hL1 = innerL / 2;
    const hW2 = hW1 + drop;
    const hL2 = hL1 + drop;
    const y1 = py;
    const y2 = py - drop;
    
    const verts = new Float32Array([
      // North
      -hW1, y1, -hL1, hW1, y1, -hL1, hW2, y2, -hL2, -hW2, y2, -hL2,
      // South
      hW1, y1, hL1, -hW1, y1, hL1, -hW2, y2, hL2, hW2, y2, hL2,
      // East
      hW1, y1, -hL1, hW1, y1, hL1, hW2, y2, hL2, hW2, y2, -hL2,
      // West
      -hW1, y1, hL1, -hW1, y1, -hL1, -hW2, y2, -hL2, -hW2, y2, hL2,
    ]);
    const indices = [
      0, 2, 1, 0, 3, 2,
      4, 6, 5, 4, 7, 6,
      8, 10, 9, 8, 11, 10,
      12, 14, 13, 12, 15, 14,
    ];
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, slopedMat);
    mesh.castShadow = true;
    return mesh;
  }
  const meshV = makeSkirtVert(w + 2*hs, l + 2*hs, vs, 0);
  meshV.name = 'mount_skirt_vertical';
  mountSkirt.add(meshV);

  // drip edge
  const dripDrop = DRIP_EDGE_DROP_IN * SC;
  const meshDrip = makeDripEdge(w + 2*hs, l + 2*hs, dripDrop, -vs);
  meshDrip.name = 'mount_skirt_drip_edge';
  mountSkirt.add(meshDrip);


  // -- Pitched Skirt Mount --
  const mountPitchedSkirt = new THREE.Group();
  mountPitchedSkirt.name = 'mount_pitched_skirt';
  mountGroup.add(mountPitchedSkirt);

  const angle = PITCHED_SKIRT_ANGLE_DEG * Math.PI / 180;

  const dropY = hs * Math.tan(angle);
  
  // build 4 slanted planes for the sloped flange
  // (slopedMat is now defined earlier)
  const psGeo = new THREE.BufferGeometry();
  // We can just build a single mesh with 4 trapezoids
  const psVerts = new Float32Array([
    // North
    -hw, 0, -hl,
    hw, 0, -hl,
    hw + hs, -dropY, -(hl + hs),
    -(hw + hs), -dropY, -(hl + hs),
    // South
    hw, 0, hl,
    -hw, 0, hl,
    -(hw + hs), -dropY, hl + hs,
    hw + hs, -dropY, hl + hs,
    // East
    hw, 0, -hl,
    hw, 0, hl,
    hw + hs, -dropY, hl + hs,
    hw + hs, -dropY, -(hl + hs),
    // West
    -hw, 0, hl,
    -hw, 0, -hl,
    -(hw + hs), -dropY, -(hl + hs),
    -(hw + hs), -dropY, hl + hs,
  ]);
  const psIndices = [
    0, 2, 1, 0, 3, 2,
    4, 6, 5, 4, 7, 6,
    8, 10, 9, 8, 11, 10,
    12, 14, 13, 12, 15, 14,
  ];
  psGeo.setAttribute('position', new THREE.BufferAttribute(psVerts, 3));
  psGeo.setIndex(psIndices);
  psGeo.computeVertexNormals();
  const psMesh = new THREE.Mesh(psGeo, slopedMat);
  psMesh.name = 'mount_pitched_skirt_sloped';
  psMesh.castShadow = true;
  mountPitchedSkirt.add(psMesh);

  // add flat inner base for pitched skirt
  const psBaseMesh = createMiteredFlange(hw_in, hl_in, hw, hl, t, 0, 'mount_pitched_skirt_inner_base');
  mountPitchedSkirt.add(psBaseMesh);

  const psMeshV = makeSkirtVert(w + 2*hs, l + 2*hs, vs, -dropY);
  psMeshV.name = 'mount_pitched_skirt_vertical';
  mountPitchedSkirt.add(psMeshV);

  const psMeshDrip = makeDripEdge(w + 2*hs, l + 2*hs, dripDrop, -dropY - vs);
  psMeshDrip.name = 'mount_pitched_skirt_drip_edge';
  mountPitchedSkirt.add(psMeshDrip);


  // -- Top Mount --
  const mountTopMount = new THREE.Group();
  mountTopMount.name = 'mount_top_mount';
  mountGroup.add(mountTopMount);

  const fw = config.flange_width * SC;
  const tmMesh = createMiteredFlange(hw_in, hl_in, hw + fw, hl + fw, t, 0, 'mount_top_mount_flange', true);
  mountTopMount.add(tmMesh);


  // 2. Screen Cage
  const screenCageGroup = new THREE.Group();
  screenCageGroup.name = 'screen_cage';
  capRoot.add(screenCageGroup);

  const sh = config.screen_height * SC;
  const postThickness = SCREEN_POST_THICKNESS_IN * SC;

  let visiblePostHeight = sh;
  if (config.lid_type !== 'flat') {
    const isRidge = config.lid_type === 'hip_ridge' || config.lid_type === 'standing_seam';
    const shortSide = Math.min(config.width, config.length);
    const pitchHeight = (shortSide / 2) * (config.lid_pitch / 12) * SC;
    const oh = config.lid_overhang * SC;
    const pitchDrop = oh * (config.lid_pitch / 12);
    const apexY = sh + pitchHeight;
    const edgeY = sh - pitchDrop;
    const ridgeL = isRidge ? (l / 3) / 2 : 0;
    
    // Z edges (North/South)
    const zEdge = l / 2;
    const zRoofEdge = l / 2 + oh;
    const yAtZEdge = apexY - (zEdge - ridgeL) * (apexY - edgeY) / (zRoofEdge - ridgeL);
    
    // X edges (East/West)
    const xEdge = w / 2;
    const xRoofEdge = w / 2 + oh;
    const yAtXEdge = apexY - xEdge * (apexY - edgeY) / xRoofEdge;
    
    visiblePostHeight = Math.min(sh, yAtZEdge - 0.05 * SC, yAtXEdge - 0.05 * SC);
  }
  visiblePostHeight = Math.max(postThickness, visiblePostHeight);
  const postGeo = new THREE.BoxGeometry(postThickness, visiblePostHeight, postThickness);
  postGeo.translate(0, visiblePostHeight / 2, 0);

  const corners = [
    { name: 'screen_corner_post_NW', x: -hw + postThickness/2, z: -hl + postThickness/2 },
    { name: 'screen_corner_post_NE', x: hw - postThickness/2, z: -hl + postThickness/2 },
    { name: 'screen_corner_post_SW', x: -hw + postThickness/2, z: hl - postThickness/2 },
    { name: 'screen_corner_post_SE', x: hw - postThickness/2, z: hl - postThickness/2 },
  ];
  for (const c of corners) {
    const pMesh = new THREE.Mesh(postGeo, mat);
    pMesh.name = c.name;
    pMesh.position.set(c.x, 0, c.z);
    pMesh.castShadow = true;
    screenCageGroup.add(pMesh);
  }

  const topRailGeo = new THREE.BoxGeometry(w, postThickness, l);
  topRailGeo.translate(0, visiblePostHeight - postThickness/2, 0);
  // Hollowing out the top rail
  const trHole = new THREE.BoxGeometry(w - postThickness*2, postThickness, l - postThickness*2);
  trHole.translate(0, visiblePostHeight - postThickness/2, 0);
  const trMesh = new THREE.Mesh(topRailGeo, mat);
  trMesh.updateMatrix();
  const trHoleMesh = new THREE.Mesh(trHole, mat);
  trHoleMesh.updateMatrix();
  const csgA = CSG.fromMesh(trMesh);
  const csgB = CSG.fromMesh(trHoleMesh);
  const topRailFinal = CSG.toMesh(csgA.subtract(csgB), trMesh.matrix);
  topRailFinal.material = mat;
  topRailFinal.name = 'screen_top_rail';
  topRailFinal.castShadow = true;
  screenCageGroup.add(topRailFinal);

  // Mesh Panels - color matches cap material
  const scrColor = config.material === 'copper' ? '#c48a5a' : '#888888';
  const scrMat = new THREE.MeshStandardMaterial({
    color: scrColor,
    metalness: 0.7,
    roughness: 0.4,
    alphaMap: getScreenTexture(),
    transparent: false,
    alphaTest: 0.05,
    side: THREE.DoubleSide
  });

  function addPanel(name: string, pW: number, pX: number, pZ: number, rotY: number) {
    const pGeo = new THREE.PlaneGeometry(pW, visiblePostHeight);
    const pm = new THREE.Mesh(pGeo, scrMat.clone());
    pm.name = name;
    pm.position.set(pX, visiblePostHeight / 2, pZ);
    pm.rotation.y = rotY;
    
    // update texture tiling
    const matClone = pm.material as THREE.MeshStandardMaterial;
    matClone.alphaMap = matClone.alphaMap?.clone() || null;
    if (matClone.alphaMap) {
      matClone.alphaMap.needsUpdate = true;
      matClone.alphaMap.repeat.set(pW / SC / 0.5, visiblePostHeight / SC / 1.0);
    }
    screenCageGroup.add(pm);
  }

  addPanel('screen_panel_N', w, 0, -hl + postThickness/2, 0);
  addPanel('screen_panel_S', w, 0, hl - postThickness/2, Math.PI);
  addPanel('screen_panel_E', l, hw - postThickness/2, 0, Math.PI/2);
  addPanel('screen_panel_W', l, -hw + postThickness/2, 0, -Math.PI/2);


  // 3. Lid Group
  const lidGroup = new THREE.Group();
  lidGroup.name = 'lid';
  capRoot.add(lidGroup);

  const oh = config.lid_overhang * SC;
  const lW = w + 2*oh;
  const lL = l + 2*oh;
  const hW = lW / 2;
  const hL = lL / 2;
  const shortSide = Math.min(config.width, config.length);
  const pitchHeight = (shortSide / 2) * (config.lid_pitch / 12) * SC; // based on short side!
  const pitchDrop = oh * (config.lid_pitch / 12); // drop at the overhang
  
  const lipDrop = 0.5 * SC;

  // -- Flat Lid --
  const lidFlat = new THREE.Group();
  lidFlat.name = 'lid_flat';
  lidGroup.add(lidFlat);

  // Recreate bolt geometries for Flat Lid
  const boltWasherGeo = new THREE.CylinderGeometry(TOP_MOUNT_BOLT_HEAD_DIA_IN * SC * 0.8, TOP_MOUNT_BOLT_HEAD_DIA_IN * SC * 0.8, 0.05 * SC, 16);
  boltWasherGeo.translate(0, 0.025 * SC, 0);
  const boltHeadGeo = new THREE.CylinderGeometry(TOP_MOUNT_BOLT_HEAD_DIA_IN * SC / 2, TOP_MOUNT_BOLT_HEAD_DIA_IN * SC / 2, 0.15 * SC, 6);
  boltHeadGeo.translate(0, 0.05 * SC + 0.075 * SC, 0);

  // The flat cap: inner flat portion sits on screen rail, overhang slopes down, then small flat hem.
  const innerY = sh + t;
  const crossBreakRise = config.cross_break ? 0.5 * SC : 0;
  const flatApexY = innerY + crossBreakRise;
  const slopeDrop = oh * 0.45; // ~24° slope angle for visible overhang
  const outerY = innerY - slopeDrop;

  const hemWidth = 0.5 * SC; // Small flat horizontal sheet at the edge
  const hw_s = hw + oh - hemWidth;
  const hl_s = hl + oh - hemWidth;
  const hw_o = hw + oh;
  const hl_o = hl + oh;

  // Inner corners
  const iNW = [-hw, innerY, -hl];
  const iNE = [ hw, innerY, -hl];
  const iSE = [ hw, innerY,  hl];
  const iSW = [-hw, innerY,  hl];

  // --- Top Face ---
  const topFaceVerts: number[] = [];
  if (config.cross_break) {
    const apex = [0, flatApexY, 0];
    topFaceVerts.push(
      ...apex, ...iNE, ...iNW, // North
      ...apex, ...iSE, ...iNE, // East
      ...apex, ...iSW, ...iSE, // South
      ...apex, ...iNW, ...iSW, // West
    );
  } else {
    topFaceVerts.push(
      ...iNW, ...iNE, ...iSE,
      ...iNW, ...iSE, ...iSW,
    );
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(topFaceVerts), 3));
  topGeo.computeVertexNormals();
  const topMesh = new THREE.Mesh(topGeo, slopedMat);
  topMesh.castShadow = true;
  lidFlat.add(topMesh);

  // --- Symmetric Curved/Blunted Cone Corners ---
  const tabW = 1.0 * SC;
  const raiseY = 0.45 * SC;
  const flareOut = 0.05 * SC; 
  const bluntW = 0.15 * SC; // Wider blunt width for a visible curve
  const bluntSegments = 3;  // Number of curve segments

  // Truncated corners for N/S faces
  const sNE_N = [hw_s - tabW, outerY, -hl_s];
  const oNE_N = [hw_o - tabW, outerY, -hl_o];
  const sNW_N = [-hw_s + tabW, outerY, -hl_s];
  const oNW_N = [-hw_o + tabW, outerY, -hl_o];

  const sSE_S = [hw_s - tabW, outerY, hl_s];
  const oSE_S = [hw_o - tabW, outerY, hl_o];
  const sSW_S = [-hw_s + tabW, outerY, hl_s];
  const oSW_S = [-hw_o + tabW, outerY, hl_o];

  // Truncated corners for E/W faces
  const sNE_E = [hw_s, outerY, -hl_s + tabW];
  const oNE_E = [hw_o, outerY, -hl_o + tabW];
  const sSE_E = [hw_s, outerY, hl_s - tabW];
  const oSE_E = [hw_o, outerY, hl_o - tabW];
  
  const sNW_W = [-hw_s, outerY, -hl_s + tabW];
  const oNW_W = [-hw_o, outerY, -hl_o + tabW];
  const sSW_W = [-hw_s, outerY, hl_s - tabW];
  const oSW_W = [-hw_o, outerY, hl_o - tabW];

  // Raised tips (base coordinates before splitting)
  const rNE_base = [hw_o + flareOut, outerY + raiseY, -hl_o - flareOut];
  const rSE_base = [hw_o + flareOut, outerY + raiseY,  hl_o + flareOut];
  const rNW_base = [-hw_o - flareOut, outerY + raiseY, -hl_o - flareOut];
  const rSW_base = [-hw_o - flareOut, outerY + raiseY,  hl_o + flareOut];

  // Split tips for blunt corners
  const rNE_N = [rNE_base[0] - bluntW, rNE_base[1], rNE_base[2]];
  const rNE_E = [rNE_base[0], rNE_base[1], rNE_base[2] + bluntW];

  const rSE_S = [rSE_base[0] - bluntW, rSE_base[1], rSE_base[2]];
  const rSE_E = [rSE_base[0], rSE_base[1], rSE_base[2] - bluntW];

  const rNW_N = [rNW_base[0] + bluntW, rNW_base[1], rNW_base[2]];
  const rNW_W = [rNW_base[0], rNW_base[1], rNW_base[2] + bluntW];

  const rSW_S = [rSW_base[0] + bluntW, rSW_base[1], rSW_base[2]];
  const rSW_W = [rSW_base[0], rSW_base[1], rSW_base[2] - bluntW];

  // Slope-break points on the ridge
  const t_s = (oh - hemWidth) / oh;
  const bw_s = bluntW * t_s;

  function getRS(iPt: number[], rPt: number[]) {
    return [
      iPt[0] + (rPt[0] - iPt[0]) * t_s,
      iPt[1] + (rPt[1] - iPt[1]) * t_s,
      iPt[2] + (rPt[2] - iPt[2]) * t_s
    ];
  }
  const rNE_s_base = getRS(iNE, rNE_base);
  const rSE_s_base = getRS(iSE, rSE_base);
  const rNW_s_base = getRS(iNW, rNW_base);
  const rSW_s_base = getRS(iSW, rSW_base);

  const rNE_s_N = [rNE_s_base[0] - bw_s, rNE_s_base[1], rNE_s_base[2]];
  const rNE_s_E = [rNE_s_base[0], rNE_s_base[1], rNE_s_base[2] + bw_s];

  const rSE_s_S = [rSE_s_base[0] - bw_s, rSE_s_base[1], rSE_s_base[2]];
  const rSE_s_E = [rSE_s_base[0], rSE_s_base[1], rSE_s_base[2] - bw_s];

  const rNW_s_N = [rNW_s_base[0] + bw_s, rNW_s_base[1], rNW_s_base[2]];
  const rNW_s_W = [rNW_s_base[0], rNW_s_base[1], rNW_s_base[2] + bw_s];

  const rSW_s_S = [rSW_s_base[0] + bw_s, rSW_s_base[1], rSW_s_base[2]];
  const rSW_s_W = [rSW_s_base[0], rSW_s_base[1], rSW_s_base[2] - bw_s];

  // Bezier curve helper for rounded corners
  function getBezierPoints(p0: number[], p1: number[], p2: number[], segs: number) {
    const pts: number[][] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const t1 = 1 - t;
      const x = t1 * t1 * p0[0] + 2 * t1 * t * p1[0] + t * t * p2[0];
      const y = t1 * t1 * p0[1] + 2 * t1 * t * p1[1] + t * t * p2[1];
      const z = t1 * t1 * p0[2] + 2 * t1 * t * p1[2] + t * t * p2[2];
      pts.push([x, y, z]);
    }
    return pts;
  }

  // Generate arcs for the tips (following perimeter order)
  const arcNE_tip = getBezierPoints(rNE_N, rNE_base, rNE_E, bluntSegments);
  const arcNE_s   = getBezierPoints(rNE_s_N, rNE_s_base, rNE_s_E, bluntSegments);
  
  const arcSE_tip = getBezierPoints(rSE_E, rSE_base, rSE_S, bluntSegments);
  const arcSE_s   = getBezierPoints(rSE_s_E, rSE_s_base, rSE_s_S, bluntSegments);

  const arcNW_tip = getBezierPoints(rNW_W, rNW_base, rNW_N, bluntSegments);
  const arcNW_s   = getBezierPoints(rNW_s_W, rNW_s_base, rNW_s_N, bluntSegments);

  const arcSW_tip = getBezierPoints(rSW_S, rSW_base, rSW_W, bluntSegments);
  const arcSW_s   = getBezierPoints(rSW_s_S, rSW_s_base, rSW_s_W, bluntSegments);

  function addSlopeFan(iPt: number[], arc_s: number[][], ptsOut: number[]) {
    for (let i = 0; i < arc_s.length - 1; i++) {
      ptsOut.push(...iPt, ...arc_s[i], ...arc_s[i+1]);
    }
  }

  function addHemStrip(arc_s: number[][], arc_tip: number[][], ptsOut: number[]) {
    for (let i = 0; i < arc_s.length - 1; i++) {
      ptsOut.push(...arc_s[i], ...arc_tip[i], ...arc_tip[i+1]);
      ptsOut.push(...arc_s[i], ...arc_tip[i+1], ...arc_s[i+1]);
    }
  }

  // --- Base Slope Faces ---
  const slopeVertsArr: number[] = [
    // North (Truncated)
    ...iNW, ...sNW_N, ...sNE_N, ...iNW, ...sNE_N, ...iNE,
    // South (Truncated)
    ...iSE, ...sSE_S, ...sSW_S, ...iSE, ...sSW_S, ...iSW,
    // East (Truncated)
    ...iNE, ...sNE_E, ...sSE_E, ...iNE, ...sSE_E, ...iSE,
    // West (Truncated)
    ...iNW, ...iSW, ...sSW_W, ...iNW, ...sSW_W, ...sNW_W,
  ];

  // NE Flap
  slopeVertsArr.push(...iNE, ...sNE_N, ...arcNE_s[0]);
  slopeVertsArr.push(...iNE, ...arcNE_s[arcNE_s.length - 1], ...sNE_E);
  addSlopeFan(iNE, arcNE_s, slopeVertsArr);

  // SE Flap
  slopeVertsArr.push(...iSE, ...sSE_E, ...arcSE_s[0]);
  slopeVertsArr.push(...iSE, ...arcSE_s[arcSE_s.length - 1], ...sSE_S);
  addSlopeFan(iSE, arcSE_s, slopeVertsArr);

  // NW Flap
  slopeVertsArr.push(...iNW, ...sNW_W, ...arcNW_s[0]);
  slopeVertsArr.push(...iNW, ...arcNW_s[arcNW_s.length - 1], ...sNW_N);
  addSlopeFan(iNW, arcNW_s, slopeVertsArr);

  // SW Flap
  slopeVertsArr.push(...iSW, ...sSW_S, ...arcSW_s[0]);
  slopeVertsArr.push(...iSW, ...arcSW_s[arcSW_s.length - 1], ...sSW_W);
  addSlopeFan(iSW, arcSW_s, slopeVertsArr);

  const slopeGeo = new THREE.BufferGeometry();
  slopeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(slopeVertsArr), 3));
  slopeGeo.computeVertexNormals();
  const slopeMesh = new THREE.Mesh(slopeGeo, slopedMat);
  slopeMesh.castShadow = true;
  lidFlat.add(slopeMesh);

  // --- Flat Hem Faces ---
  const hemVertsArr: number[] = [
    // North (Truncated)
    ...sNW_N, ...oNW_N, ...oNE_N, ...sNW_N, ...oNE_N, ...sNE_N,
    // South (Truncated)
    ...sSE_S, ...oSE_S, ...oSW_S, ...sSE_S, ...oSW_S, ...sSW_S,
    // East (Truncated)
    ...sNE_E, ...oNE_E, ...oSE_E, ...sNE_E, ...oSE_E, ...sSE_E,
    // West (Truncated)
    ...sNW_W, ...sSW_W, ...oSW_W, ...sNW_W, ...oSW_W, ...oNW_W,
  ];

  // NE Hem Flap
  hemVertsArr.push(...sNE_N, ...oNE_N, ...arcNE_tip[0], ...sNE_N, ...arcNE_tip[0], ...arcNE_s[0]);
  hemVertsArr.push(...sNE_E, ...arcNE_s[arcNE_s.length - 1], ...arcNE_tip[arcNE_tip.length - 1], ...sNE_E, ...arcNE_tip[arcNE_tip.length - 1], ...oNE_E);
  addHemStrip(arcNE_s, arcNE_tip, hemVertsArr);

  // SE Hem Flap
  hemVertsArr.push(...sSE_E, ...oSE_E, ...arcSE_tip[0], ...sSE_E, ...arcSE_tip[0], ...arcSE_s[0]);
  hemVertsArr.push(...sSE_S, ...arcSE_s[arcSE_s.length - 1], ...arcSE_tip[arcSE_tip.length - 1], ...sSE_S, ...arcSE_tip[arcSE_tip.length - 1], ...oSE_S);
  addHemStrip(arcSE_s, arcSE_tip, hemVertsArr);

  // NW Hem Flap
  hemVertsArr.push(...sNW_W, ...oNW_W, ...arcNW_tip[0], ...sNW_W, ...arcNW_tip[0], ...arcNW_s[0]);
  hemVertsArr.push(...sNW_N, ...arcNW_s[arcNW_s.length - 1], ...arcNW_tip[arcNW_tip.length - 1], ...sNW_N, ...arcNW_tip[arcNW_tip.length - 1], ...oNW_N);
  addHemStrip(arcNW_s, arcNW_tip, hemVertsArr);

  // SW Hem Flap
  hemVertsArr.push(...sSW_S, ...oSW_S, ...arcSW_tip[0], ...sSW_S, ...arcSW_tip[0], ...arcSW_s[0]);
  hemVertsArr.push(...sSW_W, ...arcSW_s[arcSW_s.length - 1], ...arcSW_tip[arcSW_tip.length - 1], ...sSW_W, ...arcSW_tip[arcSW_tip.length - 1], ...oSW_W);
  addHemStrip(arcSW_s, arcSW_tip, hemVertsArr);

  const hemGeo = new THREE.BufferGeometry();
  hemGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hemVertsArr), 3));
  hemGeo.computeVertexNormals();
  const hemMesh = new THREE.Mesh(hemGeo, slopedMat);
  hemMesh.castShadow = true;
  lidFlat.add(hemMesh);

  // Bolts for the flat lid — on the inner top surface along the rail
  const lidBoltWInst = new THREE.InstancedMesh(boltWasherGeo, mat, 100);
  const lidBoltHInst = new THREE.InstancedMesh(boltHeadGeo, mat, 100);
  lidBoltWInst.name = 'lid_flat_washers';
  lidBoltHInst.name = 'lid_flat_bolts';
  lidBoltWInst.castShadow = true;
  lidBoltHInst.castShadow = true;
  lidFlat.add(lidBoltWInst);
  lidFlat.add(lidBoltHInst);
  
  let lbIdx = 0;
  const lbMat = new THREE.Matrix4();
  
  const lidBoltSpacing = 15 * SC;

  function addLidBolt(bx: number, bz: number) {
    lbMat.makeTranslation(bx, innerY, bz);
    if (lbIdx < 100) {
      lidBoltWInst.setMatrixAt(lbIdx, lbMat);
      lidBoltHInst.setMatrixAt(lbIdx, lbMat);
      lbIdx++;
    }
  }

  function addLidBoltsAlongEdge(x1: number, z1: number, x2: number, z2: number, skipFirst: boolean) {
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(1, Math.ceil(dist / lidBoltSpacing));
    const start = skipFirst ? 1 : 0;
    for (let i = start; i <= count; i++) {
      const f = i / count;
      addLidBolt(x1 + (x2 - x1) * f, z1 + (z2 - z1) * f);
    }
  }

  // Bolts on the inner rail (top of screen cage)
  const railInset = postThickness / 2;
  const bw = hw - railInset;
  const bl = hl - railInset;
  // Corner bolts first
  addLidBolt(-bw, -bl); // NW
  addLidBolt( bw, -bl); // NE
  addLidBolt( bw,  bl); // SE
  addLidBolt(-bw,  bl); // SW
  // Fill edges (skip first corner already placed)
  addLidBoltsAlongEdge(-bw, -bl, bw, -bl, true); // North
  addLidBoltsAlongEdge( bw, -bl, bw,  bl, true); // East
  addLidBoltsAlongEdge( bw,  bl,-bw,  bl, true); // South
  addLidBoltsAlongEdge(-bw,  bl,-bw, -bl, true); // West
  lidBoltWInst.count = lbIdx;
  lidBoltHInst.count = lbIdx;

  // -- Hip Lid --
  const lidHip = new THREE.Group();
  lidHip.name = 'lid_hip';
  lidGroup.add(lidHip);

  function createHipGeometry(isRidge: boolean) {
    const geo = new THREE.BufferGeometry();
    const ridgeL = isRidge ? (l / 3) / 2 : 0;
    const apexY = sh + pitchHeight;
    const edgeY = sh - pitchDrop;

    // Ridge endpoints (collapse to a single apex when not a ridge lid)
    const apexN = [0, apexY, -ridgeL];
    const apexS = [0, apexY,  ridgeL];

    const oNW = [-hW, edgeY, -hL];
    const oNE = [ hW, edgeY, -hL];
    const oSE = [ hW, edgeY,  hL];
    const oSW = [-hW, edgeY,  hL];

    const lipDrop = 0.5 * SC;
    const dNW = [-hW, edgeY - lipDrop, -hL];
    const dNE = [ hW, edgeY - lipDrop, -hL];
    const dSE = [ hW, edgeY - lipDrop,  hL];
    const dSW = [-hW, edgeY - lipDrop,  hL];

    const positions: number[] = [];
    const addTri = (p1: number[], p2: number[], p3: number[]) => {
      positions.push(...p1, ...p2, ...p3);
    };
    const addQuad = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
      addTri(p1, p2, p3);
      addTri(p1, p3, p4);
    };

    if (isRidge && ridgeL > 0) {
      addTri(apexN, oNW, oNE); // North end
      addTri(apexS, oSE, oSW); // South end
      addQuad(apexN, oNE, oSE, apexS); // East slope
      addQuad(apexN, apexS, oSW, oNW); // West slope
    } else {
      addTri(apexN, oNW, oNE); // North
      addTri(apexN, oSE, oSW); // South
      addTri(apexN, oNE, oSE); // East
      addTri(apexN, oSW, oNW); // West
    }

    // Vertical Drip Edge
    addQuad(oNW, dNW, dNE, oNE); // North lip
    addQuad(oSE, dSE, dSW, oSW); // South lip
    addQuad(oNE, dNE, dSE, oSE); // East lip
    addQuad(oSW, dSW, dNW, oNW); // West lip

    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals();
    return geo;
  }

  // Add raised seams instead of pinched flaps
  function addRaisedSeam(targetGroup: THREE.Group, p1: number[], p2: number[], startInset = 0, endInset = startInset) {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dz = p2[2] - p1[2];
    const len = Math.hypot(Math.hypot(dx, dz), dy);
    if (len <= startInset + endInset) return;

    const seamLen = len - startInset - endInset;
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const start = new THREE.Vector3(p1[0], p1[1], p1[2]).addScaledVector(dir, startInset);
    const end = new THREE.Vector3(p2[0], p2[1], p2[2]).addScaledVector(dir, -endInset);
    
    // Standing seam profile
    const seamThickness = 0.1 * SC;
    const seamHeight = STANDING_SEAM_RIB_HEIGHT_IN * SC;
    
    const seamGeo = new THREE.BoxGeometry(seamThickness, seamHeight, seamLen);
    // Align bottom center to 0,0,0
    seamGeo.translate(0, seamHeight / 2, 0);
    
    const seamMesh = new THREE.Mesh(seamGeo, mat);
    
    // Position at midpoint
    seamMesh.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
    
    // Rotate to align with p1->p2
    seamMesh.lookAt(start);
    seamMesh.castShadow = true;
    targetGroup.add(seamMesh);
  }

  // Common outer corners for slope ends
  const c_oNW = [-hW, sh - pitchDrop, -hL];
  const c_oNE = [ hW, sh - pitchDrop, -hL];
  const c_oSE = [ hW, sh - pitchDrop,  hL];
  const c_oSW = [-hW, sh - pitchDrop,  hL];
  const seamJointInset = 0.05 * SC;

  const hipGeo = createHipGeometry(false);
  const hipMesh = new THREE.Mesh(hipGeo, slopedMat);
  hipMesh.castShadow = true;
  lidHip.add(hipMesh);
  const hipApex = [0, sh + pitchHeight, 0];
  addRaisedSeam(lidHip, hipApex, c_oNW, seamJointInset);
  addRaisedSeam(lidHip, hipApex, c_oNE, seamJointInset);
  addRaisedSeam(lidHip, hipApex, c_oSE, seamJointInset);
  addRaisedSeam(lidHip, hipApex, c_oSW, seamJointInset);


  // -- Hip & Ridge Lid --
  const lidHipRidge = new THREE.Group();
  lidHipRidge.name = 'lid_hip_ridge';
  lidGroup.add(lidHipRidge);

  const ridgeGeo = createHipGeometry(true);
  const ridgeMesh = new THREE.Mesh(ridgeGeo, slopedMat);
  ridgeMesh.castShadow = true;
  lidHipRidge.add(ridgeMesh);
  
  lidHipRidge.add(makeLidPerimeterReturn(lW, lL, lipDrop, sh - pitchDrop));
  const ridgeHalf = (l / 3) / 2;
  const ridgeApexN = [0, sh + pitchHeight, -ridgeHalf];
  const ridgeApexS = [0, sh + pitchHeight,  ridgeHalf];
  addRaisedSeam(lidHipRidge, ridgeApexN, c_oNW, seamJointInset);
  addRaisedSeam(lidHipRidge, ridgeApexN, c_oNE, seamJointInset);
  addRaisedSeam(lidHipRidge, ridgeApexS, c_oSW, seamJointInset);
  addRaisedSeam(lidHipRidge, ridgeApexS, c_oSE, seamJointInset);
  addRaisedSeam(lidHipRidge, ridgeApexN, ridgeApexS, seamJointInset);

  // -- Standing Seam Lid --
  const lidStandingSeam = new THREE.Group();
  lidStandingSeam.name = 'lid_standing_seam';
  lidGroup.add(lidStandingSeam);

  const ssMesh = new THREE.Mesh(ridgeGeo, slopedMat);
  ssMesh.castShadow = true;
  lidStandingSeam.add(ssMesh);
  
  lidStandingSeam.add(makeLidPerimeterReturn(lW, lL, lipDrop, sh - pitchDrop));
  // Standing seam also uses raised seams on joints
  const ss_apexN = ridgeApexN;
  const ss_apexS = ridgeApexS;
  addRaisedSeam(lidStandingSeam, ss_apexN, c_oNW, seamJointInset);
  addRaisedSeam(lidStandingSeam, ss_apexN, c_oNE, seamJointInset);
  addRaisedSeam(lidStandingSeam, ss_apexS, c_oSW, seamJointInset);
  addRaisedSeam(lidStandingSeam, ss_apexS, c_oSE, seamJointInset);
  addRaisedSeam(lidStandingSeam, ss_apexN, ss_apexS, seamJointInset);

  type FacePoint2D = { u: number; v: number };

  function addStandingSeamsForFace(
    targetGroup: THREE.Group,
    bottomStart: number[],
    bottomEnd: number[],
    topStart: number[],
    topEnd: number[],
    isShortSide: boolean
  ) {
    const spacing = STANDING_SEAM_RIB_SPACING_IN * SC;
    const pBottomStart = new THREE.Vector3(...bottomStart);
    const pBottomEnd = new THREE.Vector3(...bottomEnd);
    const pTopStart = new THREE.Vector3(...topStart);
    const pTopEnd = new THREE.Vector3(...topEnd);

    const bottomVec = pBottomEnd.clone().sub(pBottomStart);
    const bottomLen = bottomVec.length();
    if (bottomLen <= spacing * 0.5) return;

    const seamCount = isShortSide ? 3 : 5;
    const seamIntervalCount = seamCount + 1;
    const actualSpacing = bottomLen / seamIntervalCount;
    const uAxis = bottomVec.clone().normalize();
    const bottomCenter = pBottomStart.clone().add(pBottomEnd).multiplyScalar(0.5);
    const topCenter = pTopStart.clone().add(pTopEnd).multiplyScalar(0.5);
    const riseVec = topCenter.clone().sub(bottomCenter);
    const vAxis = riseVec.addScaledVector(uAxis, -riseVec.dot(uAxis)).normalize();
    const origin = bottomCenter;

    const toFacePoint = (point: THREE.Vector3): FacePoint2D => {
      const rel = point.clone().sub(origin);
      return { u: rel.dot(uAxis), v: rel.dot(vAxis) };
    };
    const toWorldPoint = (u: number, v: number) =>
      origin.clone().addScaledVector(uAxis, u).addScaledVector(vAxis, v);

    const facePoints = [
      toFacePoint(pBottomStart),
      toFacePoint(pBottomEnd),
      toFacePoint(pTopEnd),
      toFacePoint(pTopStart),
    ];

    const intersectAtU = (u: number) => {
      const vHits: number[] = [];
      for (let i = 0; i < facePoints.length; i++) {
        const a = facePoints[i];
        const b = facePoints[(i + 1) % facePoints.length];
        const du = b.u - a.u;
        if (Math.abs(du) < 1e-6) {
          continue;
        }
        const t = (u - a.u) / du;
        if (t >= -1e-6 && t <= 1 + 1e-6) {
          vHits.push(a.v + (b.v - a.v) * t);
        }
      }
      if (vHits.length < 2) return null;
      vHits.sort((a, b) => a - b);
      return { vMin: vHits[0], vMax: vHits[vHits.length - 1] };
    };

    const topOverlap = 0.05 * SC;

    for (let i = 0; i < seamCount; i++) {
      const u = -bottomLen / 2 + actualSpacing * (i + 1);
      const hit = intersectAtU(u);
      if (!hit || hit.vMax - hit.vMin < actualSpacing * 0.25) continue;

      const start = toWorldPoint(u, hit.vMin);
      const end = toWorldPoint(u, hit.vMax);
      addRaisedSeam(
        targetGroup,
        [start.x, start.y, start.z],
        [end.x, end.y, end.z],
        0,
        topOverlap
      );
    }
  }

  const isWidthShort = w <= l;
  addStandingSeamsForFace(lidStandingSeam, c_oNW, c_oNE, ss_apexN, ss_apexN, isWidthShort);
  addStandingSeamsForFace(lidStandingSeam, c_oSE, c_oSW, ss_apexS, ss_apexS, isWidthShort);
  addStandingSeamsForFace(lidStandingSeam, c_oNE, c_oSE, ss_apexN, ss_apexS, !isWidthShort);
  addStandingSeamsForFace(lidStandingSeam, c_oSW, c_oNW, ss_apexS, ss_apexN, !isWidthShort);
}
