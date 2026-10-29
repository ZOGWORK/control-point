// The Prints library's 3D preview: STL, 3MF and OBJ in the browser. Loaded
// with React.lazy, so three.js only downloads when someone opens a preview.
// Drag to orbit, scroll or pinch to zoom; the arrow keys turn the model for
// keyboard users.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AlertTriangle } from 'lucide-react';
import { apiFetch } from '../services/api';
import { addLights, disposeObject, fitCamera, parseModel, type PreviewKind } from './printModel';

export default function PrintViewer({ url, kind, name, onLoaded }: {
  url: string;
  kind: PreviewKind;
  name: string;
  /** Called once with the file's bytes after it renders (the page draws a missing thumbnail from them). */
  onLoaded?: (buffer: ArrayBuffer) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let cancelled = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let model: THREE.Object3D | null = null;
    let ro: ResizeObserver | null = null;
    let onKey: ((e: KeyboardEvent) => void) | null = null;
    (async () => {
      try {
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`Couldn't download the file (HTTP ${res.status}).`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const parsed = parseModel(buffer, kind);
        if (cancelled) { disposeObject(parsed.group); return; }
        model = parsed.group;
        const scene = new THREE.Scene();
        addLights(scene);
        scene.add(model);
        const maxDim = Math.max(parsed.size.x, parsed.size.z, 1);
        const grid = new THREE.GridHelper(maxDim * 2.4, 24, 0x4a4a52, 0x2c2c33);
        scene.add(grid);
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
        fitCamera(camera, parsed.size);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        el.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('aria-hidden', 'true');
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, parsed.size.y * 0.45, 0);
        controls.update();
        const resize = () => {
          const w = el.clientWidth || 1, h = el.clientHeight || 1;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer?.setSize(w, h);
        };
        resize();
        ro = new ResizeObserver(resize);
        ro.observe(el);
        onKey = (e: KeyboardEvent) => {
          if (!controls || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const step = Math.PI / 24;
          const offset = camera.position.clone().sub(controls.target);
          const sph = new THREE.Spherical().setFromVector3(offset);
          if (e.key === 'ArrowLeft') sph.theta -= step;
          if (e.key === 'ArrowRight') sph.theta += step;
          if (e.key === 'ArrowUp') sph.phi = Math.max(0.1, sph.phi - step);
          if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI - 0.1, sph.phi + step);
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
          controls.update();
        };
        el.addEventListener('keydown', onKey);
        const animate = () => { raf = requestAnimationFrame(animate); controls?.update(); renderer?.render(scene, camera); };
        animate();
        const s = parsed.size;
        setInfo(`${parsed.triangles.toLocaleString()} triangles · about ${Math.round(s.x)} × ${Math.round(s.z)} × ${Math.round(s.y)} (file units)`);
        setState('ready');
        loaded.current?.(buffer);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Couldn't show this model.");
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (onKey) el.removeEventListener('keydown', onKey);
      controls?.dispose();
      if (model) disposeObject(model);
      if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    };
  }, [url, kind]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={mount}
        tabIndex={0}
        role="img"
        aria-label={`3D preview of ${name}. Use the arrow keys to turn it.`}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[#1b1b1f] outline-none focus-visible:ring-2 focus-visible:ring-accent/60 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full"
      >
        {state === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-zinc-400" aria-live="polite">
            <div className="size-8 animate-spin rounded-full border-2 border-white/10 border-t-[#ffc700] motion-reduce:animate-none" aria-hidden />
            Loading the model…
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center" role="alert">
            <AlertTriangle className="size-8 text-orange-300" aria-hidden />
            <p className="text-sm font-medium text-zinc-100">Couldn't show this model</p>
            <p className="max-w-sm text-sm text-zinc-400">{error}</p>
          </div>
        )}
      </div>
      <p className="mt-2 min-h-5 text-xs text-muted-foreground">{state === 'ready' ? `${info} · Drag to turn, scroll or pinch to zoom` : ''}</p>
    </div>
  );
}
