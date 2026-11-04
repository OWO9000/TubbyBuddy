import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { Cosmetic, Slot } from "../api";
import { MOOD_POSES, onCompanionReact, type CompanionReaction, type Mood3D } from "./companionEvents";
import { furFor, recolor, recolorImage, type Fur } from "./furColors";

export const MODEL_URL = "/models/tubby.vrm";
const POSE_BONES = [...new Set(Object.values(MOOD_POSES).flatMap((p) => Object.keys(p)))];

export interface Companion3DProps {
  mood: Mood3D;
  equipped?: Partial<Record<Slot, Cosmetic>>;
  size?: number;
  label?: string;
  onError?: (e: unknown) => void;
  onReady?: () => void;
}

const MOOD_EXPRESSION: Record<Mood3D, { name: string; weight: number } | null> = {
  neutral: null,
  happy: { name: "happy", weight: 0.8 },
  worried: { name: "sad", weight: 1 },
  angry: { name: "angry", weight: 1 },
  proud: { name: "relaxed", weight: 1 },
  surprised: { name: "Surprised", weight: 1 },
};

// The bundled model ships these presets with no binds; setValue is harmless and lets a richer model drop in.
const EXPRESSION_NAMES = ["happy", "sad", "angry", "relaxed", "Surprised", "blink"];

/** Small original effect glyphs per mood (viewBox 0 0 100 100), shown beside the head. */
const MOOD_FX: Partial<Record<Mood3D, JSX.Element>> = {
  happy: <g fill="#ff5c96"><path d="M30 40c-8-12-26-4-16 10l16 14 16-14c10-14-8-22-16-10z" /><path d="M74 18c-5-8-17-3-11 6l11 10 11-10c6-9-6-14-11-6z" opacity=".8" /></g>,
  worried: <path d="M50 14C42 34 34 44 34 56a16 16 0 0 0 32 0c0-12-8-22-16-42z" fill="#8cd2ff" stroke="#28598c" strokeWidth="4" />,
  angry: <g fill="none" stroke="#eb283c" strokeWidth="9" strokeLinecap="round"><path d="M22 38q16 0 16-16" /><path d="M62 22q0 16 16 16" /><path d="M78 62q-16 0-16 16" /><path d="M38 78q0-16-16-16" /></g>,
  proud: <g fill="#ffd65a"><path d="M30 10l5 15 15 5-15 5-5 15-5-15-15-5 15-5z" /><path d="M72 40l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" /><path d="M60 8l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></g>,
  surprised: <g fill="#ffd65a" stroke="#3c1432" strokeWidth="3"><path d="M30 10h14l-3 44h-8z" /><circle cx="37" cy="68" r="7" /><path d="M64 26h10l-2 30h-6z" /><circle cx="69" cy="66" r="5" /></g>,
};

// Seven original flame silhouettes (viewBox 0 0 64 64), filled with the shared gradient.
const FLAMES: { d: string; x: number; s: number; delay: number }[] = [
  { d: "M32 4c4 10 16 16 16 32a16 16 0 0 1-32 0c0-8 4-13 8-17 0 6 3 9 6 9-2-9 0-17 2-24z", x: 44, s: 0.16, delay: 0 },
  { d: "M30 8c7 8 14 14 14 28a14 14 0 0 1-28 0c0-7 3-11 7-15-1 5 2 8 5 8-3-8-1-15 2-21z", x: 30, s: 0.12, delay: 0.15 },
  { d: "M34 6c3 9 15 15 15 30a15 15 0 0 1-30 0c0-8 5-12 8-16 1 5 3 8 6 8-1-8 0-16 1-22z", x: 58, s: 0.13, delay: 0.3 },
  { d: "M31 12c5 7 11 11 11 23a11 11 0 0 1-22 0c0-6 3-9 6-12 0 4 2 6 4 6-2-6 0-12 1-17z", x: 20, s: 0.1, delay: 0.45 },
  { d: "M33 10c6 8 12 13 12 25a12 12 0 0 1-24 0c0-6 4-10 6-13 1 4 2 7 5 7-2-7-1-13 1-19z", x: 68, s: 0.11, delay: 0.6 },
  { d: "M32 16c4 6 9 9 9 19a9 9 0 0 1-18 0c0-5 2-8 5-10 0 3 2 5 3 5-1-5 0-10 1-14z", x: 38, s: 0.09, delay: 0.75 },
  { d: "M32 14c5 6 10 10 10 21a10 10 0 0 1-20 0c0-5 3-9 5-11 1 3 2 5 4 5-2-6-1-11 1-15z", x: 52, s: 0.09, delay: 0.4 },
];

export default function Companion3D({ mood, equipped = {}, size = 220, label, onError, onReady }: Companion3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const fur = furFor(equipped.color);
  const furKey = equipped.color?.id ?? "";
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const handleRef = useRef<{ setSize: (s: number) => void; setFur: (f: Fur | null) => void; setAccessory?: (id?: string) => void } | null>(null);
  const furRef = useRef(fur);
  furRef.current = fur;
  const accessoryRef = useRef(equipped.accessory?.id);
  accessoryRef.current = equipped.accessory?.id;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (e) {
      onErrorRef.current?.(e);
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(sizeRef.current, sizeRef.current);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.5, 1.5, 2);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    handleRef.current = {
      setSize: (s: number) => {
        renderer.setSize(s, s);
        camera.aspect = 1;
        camera.updateProjectionMatrix();
      },
      setFur: (f: Fur | null) => applyFur(f),
    };

    // Fur colors: an HSV hue shift of the base and shade textures plus MToon's shade color, so the pink
    // shading doesn't bleed through. White, black and the outline are left untouched.
    const originals = new Map<THREE.Material, { maps: Record<string, THREE.Texture>; shade: THREE.Color | null }>();
    const recolored = new Map<string, THREE.Texture>();
    const applyFur = (f: Fur | null) => {
      for (const [mat, orig] of originals) {
        const m = mat as unknown as Record<string, unknown> & { needsUpdate: boolean; uniformsNeedUpdate?: boolean; shadeColorFactor?: THREE.Color };
        for (const [key, tex] of Object.entries(orig.maps)) {
          let next: THREE.Texture = tex;
          const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
          if (f && img && img.width) {
            const k = `${tex.uuid}:${f.shift}:${f.sat}:${f.val}`;
            let ct = recolored.get(k);
            if (!ct) {
              ct = new THREE.CanvasTexture(recolorImage(img, f));
              ct.colorSpace = tex.colorSpace;
              ct.flipY = tex.flipY;
              ct.wrapS = tex.wrapS;
              ct.wrapT = tex.wrapT;
              ct.offset.copy(tex.offset);
              ct.repeat.copy(tex.repeat);
              recolored.set(k, ct);
            }
            next = ct;
          }
          m[key] = next;
        }
        if (orig.shade && m.shadeColorFactor) {
          const [r, g, b] = f ? recolor(orig.shade.r, orig.shade.g, orig.shade.b, f) : [orig.shade.r, orig.shade.g, orig.shade.b];
          m.shadeColorFactor.setRGB(r, g, b);
        }
        m.needsUpdate = true;
        m.uniformsNeedUpdate = true;
      }
    };

    const clock = new THREE.Clock();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let vrm: VRM | null = null;
    let disposed = false;
    let readyFired = false;
    let visible = true;

    // ---- 3D cosmetics ---------------------------------------------------------------------
    // Props are built from primitives and parented to the head bone, oriented in head-local space
    // (Y = toward HeadTop_End, Z = the direction the cat faces). No external asset/license needed.
    let accessoryGroup: THREE.Group | null = null;
    const buildAccessory = (id: string): THREE.Group | null => {
      if (!vrm) return null;
      const head = vrm.humanoid.rawHumanBones.head?.node;
      if (!head) return null;
      const headWorld = head.getWorldPosition(new THREE.Vector3());
      // Compute the real bounds of the vertices weighted to the head bone. The cat's head is much
      // wider than the bone length, so guesses based on HeadTop_End alone put props inside the mesh.
      const headBox = new THREE.Box3();
      vrm.scene.updateMatrixWorld(true);
      vrm.scene.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh || !mesh.skeleton || !mesh.geometry?.attributes?.position) return;
        const headIndex = mesh.skeleton.bones.indexOf(head as THREE.Bone);
        if (headIndex < 0) return;
        const pos = mesh.geometry.attributes.position;
        const si = mesh.geometry.attributes.skinIndex;
        const sw = mesh.geometry.attributes.skinWeight;
        if (!si || !sw) return;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          let w = 0;
          for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === headIndex) w += sw.getComponent(i, k);
          if (w < 0.4) continue;
          v.fromBufferAttribute(pos, i);
          if (typeof mesh.applyBoneTransform === "function") mesh.applyBoneTransform(i, v);
          else (mesh as unknown as { boneTransform: (i: number, v: THREE.Vector3) => void }).boneTransform(i, v);
          mesh.localToWorld(v);
          headBox.expandByPoint(v);
        }
      });
      if (headBox.isEmpty()) headBox.setFromCenterAndSize(headWorld, new THREE.Vector3(0.5, 0.4, 0.4));
      const size = headBox.getSize(new THREE.Vector3());
      const center = headBox.getCenter(new THREE.Vector3());
      const W = Math.max(0.2, size.x);
      const H = Math.max(0.18, size.y);
      const D = Math.max(0.18, size.z);
      const cx = center.x - headWorld.x;
      const cy = center.y - headWorld.y;
      const cz = center.z - headWorld.z;
      const topY = headBox.max.y - headWorld.y;
      const bottomY = headBox.min.y - headWorld.y;
      const frontZ = headBox.max.z - headWorld.z;
      const rightX = headBox.max.x - headWorld.x;
      const group = new THREE.Group();
      // Work in world-aligned axes (Y up, Z toward the camera/front) inside the head bone.
      group.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert());
      const mats: THREE.Material[] = [];
      const mat = (color: number, metalness = 0, roughness = 0.5) => {
        const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
        mats.push(m);
        return m;
      };
      const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        group.add(mesh);
        return mesh;
      };

      if (id === "acc-crown") {
        const gold = mat(0xffcf3f, 0.55, 0.3);
        const y = topY + H * 0.03;
        add(new THREE.CylinderGeometry(W * 0.33, W * 0.34, H * 0.1, 18, 1, true), gold, cx, y, cz);
        add(new THREE.TorusGeometry(W * 0.34, W * 0.03, 8, 24), gold, cx, y - H * 0.05, cz, Math.PI / 2);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(new THREE.ConeGeometry(W * 0.07, H * 0.2, 5), gold, cx + Math.cos(a) * W * 0.3, y + H * 0.12, cz + Math.sin(a) * W * 0.3);
        }
        add(new THREE.SphereGeometry(W * 0.045, 10, 8), mat(0xff5f8f, 0.2, 0.3), cx, y + H * 0.02, cz + W * 0.34);
      } else if (id === "acc-glasses") {
        const dark = mat(0x232d3a, 0.1, 0.45);
        const y = cy + H * 0.06;
        const z = frontZ + D * 0.02;
        add(new THREE.TorusGeometry(W * 0.15, W * 0.028, 8, 24), dark, cx - W * 0.19, y, z);
        add(new THREE.TorusGeometry(W * 0.15, W * 0.028, 8, 24), dark, cx + W * 0.19, y, z);
        add(new THREE.BoxGeometry(W * 0.14, W * 0.035, W * 0.035), dark, cx, y, z);
        add(new THREE.BoxGeometry(W * 0.26, W * 0.035, W * 0.035), dark, cx - W * 0.44, y, z - D * 0.25, 0, 0.3, 0);
        add(new THREE.BoxGeometry(W * 0.26, W * 0.035, W * 0.035), dark, cx + W * 0.44, y, z - D * 0.25, 0, -0.3, 0);
      } else if (id === "acc-scarf") {
        const red = mat(0xd94a4a, 0.05, 0.7);
        const y = bottomY - H * 0.04;
        add(new THREE.TorusGeometry(W * 0.31, H * 0.065, 10, 26), red, cx, y, cz + D * 0.05, Math.PI / 2);
        add(new THREE.BoxGeometry(W * 0.14, H * 0.32, D * 0.07), red, cx + W * 0.06, y - H * 0.17, frontZ - D * 0.12, 0.08, 0, 0.1);
      } else if (id === "acc-headphones") {
        const dark = mat(0x27313d, 0.15, 0.45);
        const y = cy + H * 0.12;
        add(new THREE.TorusGeometry(W * 0.46, W * 0.045, 8, 32, Math.PI), dark, cx, y, cz);
        add(new THREE.CylinderGeometry(W * 0.16, W * 0.16, W * 0.12, 18), dark, cx - W * 0.5, y - H * 0.02, cz, 0, 0, Math.PI / 2);
        add(new THREE.CylinderGeometry(W * 0.16, W * 0.16, W * 0.12, 18), dark, cx + W * 0.5, y - H * 0.02, cz, 0, 0, Math.PI / 2);
      } else if (id === "acc-bow") {
        const pink = mat(0xff6fa5, 0.05, 0.5);
        const x = rightX + W * 0.02;
        const y = cy + H * 0.3;
        const z = frontZ - D * 0.1;
        add(new THREE.ConeGeometry(W * 0.12, W * 0.3, 8), pink, x, y, z, 0, 0, Math.PI / 2 - 0.6);
        add(new THREE.ConeGeometry(W * 0.12, W * 0.3, 8), pink, x, y, z, 0, 0, -Math.PI / 2 + 0.6);
        add(new THREE.SphereGeometry(W * 0.075, 10, 8), mat(0xe94b86, 0.1, 0.4), x, y, z);
        add(new THREE.BoxGeometry(W * 0.05, H * 0.22, D * 0.04), mat(0xd94f88, 0, 0.6), x - W * 0.01, y - H * 0.14, z, 0.1, 0, -0.15);
      } else if (id === "acc-flowers") {
        const y = topY - H * 0.02;
        add(new THREE.TorusGeometry(W * 0.36, W * 0.03, 8, 28), mat(0x4e9b52, 0.05, 0.7), cx, y, cz, Math.PI / 2);
        const petals = [0xfff3d1, 0xffc6dd, 0xfff3d1, 0xffc6dd, 0xfff3d1, 0xffc6dd];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          add(new THREE.SphereGeometry(W * 0.06, 10, 8), mat(petals[i], 0, 0.6), cx + Math.cos(a) * W * 0.36, y + H * 0.03, cz + Math.sin(a) * W * 0.36);
          add(new THREE.SphereGeometry(W * 0.028, 8, 6), mat(0xffc93c, 0.1, 0.4), cx + Math.cos(a) * W * 0.36, y + H * 0.05, cz + Math.sin(a) * W * 0.36);
        }
      } else {
        return null;
      }
      group.userData.mats = mats;
      return group;
    };
    const applyAccessory = (id?: string) => {
      if (!vrm) return;
      const head = vrm.humanoid.rawHumanBones.head?.node;
      if (!head) return;
      if (accessoryGroup) {
        head.remove(accessoryGroup);
        accessoryGroup.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose?.();
          if (mesh.material instanceof THREE.Material) mesh.material.dispose();
        });
        accessoryGroup = null;
      }
      if (!id) return;
      const next = buildAccessory(id);
      if (next) {
        accessoryGroup = next;
        head.add(next);
      }
    };

    const st = {
      time: 0,
      weights: {} as Record<string, number>,
      nextBlink: 2 + Math.random() * 2,
      blinkT: -1,
      override: null as { mood: Mood3D; until: number } | null,
      after: null as { mood: Mood3D; until: number } | null,
      hopT: -1,
      shakeUntil: 0,
      flameUntil: 0,
      waveUntil: 0,
      waveLen: 1.9,
      burning: false,
      idle: { hy: 0, hz: 0, sx: 0, cx: 0 },
    };

    const react = (r: CompanionReaction) => {
      const t = st.time;
      if (r === "wave" || r === "hello") {
        // "hello" is the big first-meeting wave: longer, with a little hop at the start.
        const len = r === "hello" ? 3.4 : 1.9;
        st.override = { mood: "happy", until: t + len + 0.4 };
        st.after = null;
        st.waveLen = len;
        st.waveUntil = t + len;
        if (r === "hello" && !reduceMotion) st.hopT = 0;
      } else if (r === "earn") {
        st.override = { mood: "happy", until: t + 2.2 };
        st.after = null;
        if (!reduceMotion) st.hopT = 0;
      } else if (r === "burn") {
        st.override = { mood: "angry", until: t + 1.2 };
        st.after = { mood: "worried", until: t + 3.2 };
        st.flameUntil = t + 2.2;
        st.shakeUntil = t + 0.6;
      } else {
        st.override = { mood: "surprised", until: t + 1.5 };
        st.after = null;
      }
    };
    const unsub = onCompanionReact(react);
    if (handleRef.current) handleRef.current.setAccessory = applyAccessory;

    const onContextLost = (e: Event) => {
      e.preventDefault();
      onErrorRef.current?.(e);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((en) => en.isIntersecting);
    });
    observer.observe(wrap);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader
      .loadAsync(MODEL_URL)
      .then((gltf) => {
        if (disposed) return;
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (!loaded) {
          onErrorRef.current?.(new Error(`No VRM found in ${MODEL_URL}`));
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        const combine = (VRMUtils as unknown as { combineSkeletons?: (root: THREE.Object3D) => void }).combineSkeletons;
        if (typeof combine === "function") combine(gltf.scene);
        VRMUtils.rotateVRM0(loaded);
        scene.add(loaded.scene);
        vrm = loaded;
        applyAccessory(accessoryRef.current);
        loaded.scene.traverse((o) => {
          const mats = (o as THREE.Mesh).material;
          if (!mats) return;
          for (const mat of Array.isArray(mats) ? mats : [mats]) {
            if (originals.has(mat)) continue;
            const maps: Record<string, THREE.Texture> = {};
            const shade = (mat as unknown as { shadeColorFactor?: THREE.Color }).shadeColorFactor;
            for (const key of ["map", "shadeMultiplyTexture"]) {
              const t = (mat as unknown as Record<string, unknown>)[key];
              if (t instanceof THREE.Texture) maps[key] = t;
            }
            originals.set(mat, { maps, shade: shade ? shade.clone() : null });
          }
        });
        if (furRef.current) applyFur(furRef.current);
        // Frame on the neutral pose so the camera never jumps between moods.
        setPose(loaded, MOOD_POSES.neutral, 1);
        loaded.update(0);
        const box = new THREE.Box3().setFromObject(loaded.scene);
        const center = box.getCenter(new THREE.Vector3());
        const dims = box.getSize(new THREE.Vector3());
        const dist = (Math.max(dims.x, dims.y) * 1.3) / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
        center.y += dims.y * 0.06; // headroom for hats and mood effects
        camera.position.set(center.x, center.y, center.z + dist);
        camera.near = dist / 100;
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        camera.lookAt(center);
      })
      .catch((e) => {
        if (!disposed) onErrorRef.current?.(e);
      });

    const setPose = (v: VRM, pose: (typeof MOOD_POSES)[Mood3D], k: number) => {
      const nb = v.humanoid.normalizedHumanBones as Record<string, { node: THREE.Object3D } | undefined>;
      for (const bone of POSE_BONES) {
        const node = nb[bone]?.node;
        if (!node) continue;
        const r = pose[bone] ?? [0, 0, 0];
        node.rotation.x += (r[0] - node.rotation.x) * k;
        node.rotation.y += (r[1] - node.rotation.y) * k;
        node.rotation.z += (r[2] - node.rotation.z) * k;
      }
    };
    let shownFx: Mood3D | null = null;

    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const headW = new THREE.Vector3();
    const hq = new THREE.Quaternion();
    const pt = { x: 0, y: 0 };

    /** ay: vertical anchor of the element in % (-50 = centered on the point, -85 = sits on top of it). */
    const place = (el: HTMLElement | null, x: number, y: number, ay = -50) => {
      if (!el) return;
      el.style.opacity = "1";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${ay}%)`;
    };

    const project = (world: THREE.Vector3) => {
      tmp.copy(world).project(camera);
      const s = sizeRef.current;
      pt.x = (tmp.x * 0.5 + 0.5) * s;
      pt.y = (-tmp.y * 0.5 + 0.5) * s;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible || document.hidden || !vrm) return;
      const cur = vrm;
      st.time += dt;
      const t = st.time;
      if (st.override && t >= st.override.until) {
        st.override = st.after;
        st.after = null;
      }
      const active = st.override ? st.override.mood : moodRef.current;
      const bones = cur.humanoid.normalizedHumanBones;
      // Strip last frame's idle offsets, ease toward the mood pose, then layer idle motion back on top.
      const head0 = bones.head?.node;
      const spine0 = bones.spine?.node;
      const chest0 = bones.chest?.node;
      if (head0) { head0.rotation.y -= st.idle.hy; head0.rotation.z -= st.idle.hz; }
      if (spine0) spine0.rotation.x -= st.idle.sx;
      if (chest0) chest0.rotation.x -= st.idle.cx;
      st.idle = { hy: 0, hz: 0, sx: 0, cx: 0 };
      setPose(cur, MOOD_POSES[active], Math.min(1, dt * 7));
      if (t < st.waveUntil && !reduceMotion) {
        // A short greeting wave: raise the right arm and swing the forearm.
        const p = Math.min(1, Math.max(0, 1 - (st.waveUntil - t) / st.waveLen));
        const swing = Math.sin(p * Math.PI * 2 * Math.round(st.waveLen * 1.6)) * 0.5 * Math.min(1, Math.sin(p * Math.PI) * 2.2);
        const upper = bones.rightUpperArm?.node;
        const fore = bones.rightLowerArm?.node;
        if (upper) {
          upper.rotation.z = -0.25;
          upper.rotation.x = 0.1;
        }
        if (fore) fore.rotation.z = -1.25 + swing;
        const head = bones.head?.node;
        if (head) head.rotation.z += 0.06 * Math.sin(p * Math.PI * 3);
      }
      if (active !== shownFx) {
        shownFx = active;
        if (fxRef.current) fxRef.current.dataset.mood = active;
      }
      if (!reduceMotion) {
        const breath = Math.sin((t / 3.5) * Math.PI * 2);
        const spine = bones.spine?.node;
        const chest = bones.chest?.node;
        st.idle.sx = breath * 0.02;
        if (spine) spine.rotation.x += st.idle.sx;
        if (chest) {
          st.idle.cx = breath * 0.015;
          chest.rotation.x += st.idle.cx;
          const s = 1 + breath * 0.008;
          chest.scale.set(s, s, s);
        }
        const head = bones.head?.node;
        if (head) {
          st.idle.hy = Math.sin(t * 0.7) * 0.08;
          st.idle.hz = Math.sin(t * 0.9 + 1) * 0.06;
          head.rotation.y += st.idle.hy;
          head.rotation.z += st.idle.hz;
        }
        cur.scene.position.y = breath * 0.006;
      } else {
        cur.scene.position.y = 0;
      }
      if (st.hopT >= 0 && !reduceMotion) {
        st.hopT += dt;
        const p = st.hopT / 0.5;
        if (p >= 1) st.hopT = -1;
        else cur.scene.position.y += 0.04 * 4 * p * (1 - p);
      }
      if (t < st.shakeUntil && !reduceMotion) {
        cur.scene.position.x = (Math.random() - 0.5) * 0.03;
      } else {
        cur.scene.position.x = 0;
      }
      let blinkTarget = 0;
      if (active !== "happy") {
        st.nextBlink -= dt;
        if (st.nextBlink <= 0) {
          st.blinkT = 0;
          st.nextBlink = 2.5 + Math.random() * 3;
        }
      } else {
        st.blinkT = -1;
      }
      if (st.blinkT >= 0) {
        st.blinkT += dt;
        const p = st.blinkT / 0.15;
        if (p >= 1) st.blinkT = -1;
        else blinkTarget = Math.sin(p * Math.PI);
      }
      const em = cur.expressionManager;
      if (em) {
        const target = MOOD_EXPRESSION[active];
        const k = Math.min(1, dt * 8);
        for (const name of EXPRESSION_NAMES) {
          const want = name === "blink" ? blinkTarget : target && target.name === name ? target.weight : 0;
          const prev = st.weights[name] ?? 0;
          const next = prev + (want - prev) * k;
          st.weights[name] = next;
          if (em.getExpression(name)) em.setValue(name, next);
        }
      }
      cur.update(dt);
      const raw = cur.humanoid.rawHumanBones;
      const headRaw = raw.head?.node;
      if (headRaw) {
        headRaw.getWorldPosition(headW);
        // The head bone sits at the base of the big cat head; the mood glyph floats by the right ear
        // and follows the head's rotation.
        headRaw.getWorldQuaternion(hq);
        // VRM 0 models face -Z before rotateVRM0, so the cat's left (screen right) is -X in head space.
        tmp2.set(-0.32, 0.42, 0).applyQuaternion(hq).add(headW);
        project(tmp2);
        place(fxRef.current, pt.x, pt.y);
      }
      const burning = t < st.flameUntil;
      if (burning !== st.burning) {
        st.burning = burning;
        wrap.classList.toggle("burning", burning);
      }
      renderer.render(scene, camera);
      if (!readyFired) {
        readyFired = true;
        onReadyRef.current?.();
      }
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsub();
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      handleRef.current = null;
      renderer.dispose();
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setSize(size);
  }, [size]);

  useEffect(() => {
    handleRef.current?.setFur(furRef.current);
  }, [furKey]);

  useEffect(() => {
    handleRef.current?.setAccessory?.(equipped.accessory?.id);
  }, [equipped.accessory?.id]);

  const px = (f: number) => Math.round(size * f);
  return (
    <div ref={wrapRef} className="companion3d" role="img" aria-label={label ?? `Companion feeling ${mood}`} style={{ position: "relative", width: size, height: size }}>
      <canvas ref={canvasRef} />
      <div ref={fxRef} className="mood-fx" aria-hidden="true" style={{ width: px(0.24), height: px(0.24), opacity: 0 }}>
        {Object.entries(MOOD_FX).map(([m, g]) => (
          <svg key={m} viewBox="0 0 100 100" data-fx={m}>{g}</svg>
        ))}
      </div>
      <div className="flames" aria-hidden="true">
        <svg width="0" height="0" aria-hidden="true">
          <defs>
            <linearGradient id="c3flame" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ff5a1f" />
              <stop offset="1" stopColor="#ffc24b" />
            </linearGradient>
          </defs>
        </svg>
        {FLAMES.map((f, i) => (
          <span key={i} style={{ left: `${f.x}%`, width: px(f.s), animationDelay: `${f.delay}s` }}>
            <svg viewBox="0 0 64 64">
              <path d={f.d} fill="url(#c3flame)" />
            </svg>
          </span>
        ))}
      </div>
    </div>
  );
}
