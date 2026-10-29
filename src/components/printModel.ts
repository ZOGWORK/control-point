// 3D print models in the browser: parse STL, 3MF and OBJ with three.js's own
// loaders, and draw a small thumbnail for grid tiles. Only ever loaded with a
// dynamic import (the viewer is React.lazy, thumbnails import this on demand),
// so three.js stays out of the main bundle, as for CadModelViewer.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export type PreviewKind = 'stl' | '3mf' | 'obj';

const material = () => new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide });

/** The model as one group, centred on the origin, resting on y = 0, with its triangle count. */
export function parseModel(buffer: ArrayBuffer, kind: PreviewKind): { group: THREE.Group; triangles: number; size: THREE.Vector3 } {
  const group = new THREE.Group();
  if (kind === 'stl') {
    const geo = new STLLoader().parse(buffer);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, material()));
  } else if (kind === '3mf') {
    group.add(new ThreeMFLoader().parse(buffer));
  } else {
    group.add(new OBJLoader().parse(new TextDecoder().decode(buffer)));
  }
  let triangles = 0;
  group.traverse((o: any) => {
    if (!o.isMesh) return;
    // One look for every format; 3MF colours are kept.
    if (kind !== '3mf') o.material = material();
    const g = o.geometry as THREE.BufferGeometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });
  // Print files are Z-up; the viewer is Y-up.
  if (kind !== 'obj') group.rotation.x = -Math.PI / 2;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) throw new Error('This file has no printable geometry.');
  const center = box.getCenter(new THREE.Vector3());
  const outer = new THREE.Group();
  outer.add(group);
  group.position.set(-center.x, -box.min.y, -center.z);
  return { group: outer, triangles: Math.round(triangles), size: box.getSize(new THREE.Vector3()) };
}

/** A camera looking at the model from the front-right, above, fitting it in view. */
export function fitCamera(camera: THREE.PerspectiveCamera, size: THREE.Vector3) {
  const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
  const dist = (maxDim * 0.9) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(dist * 0.7, size.y * 0.5 + dist * 0.55, dist * 0.85);
  camera.near = dist / 1000;
  camera.far = dist * 50;
  camera.lookAt(0, size.y * 0.45, 0);
  camera.updateProjectionMatrix();
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a30, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc700, 0.35);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((x: any) => {
    x.geometry?.dispose?.();
    (Array.isArray(x.material) ? x.material : [x.material]).forEach((m: any) => m?.dispose?.());
  });
}

/** A 256 × 256 transparent PNG of the model, or null when the browser can't draw it (no WebGL, bad file). */
export async function drawThumbnail(buffer: ArrayBuffer, kind: PreviewKind, px = 256): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  let model: THREE.Object3D | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(px, px, false);
    const scene = new THREE.Scene();
    addLights(scene);
    const parsed = parseModel(buffer, kind);
    model = parsed.group;
    scene.add(model);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    fitCamera(camera, parsed.size);
    renderer.render(scene, camera);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  } finally {
    if (model) disposeObject(model);
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
