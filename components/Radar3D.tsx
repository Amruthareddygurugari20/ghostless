"use client";

import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PALETTE, radiusForScore, VERDICT_COLOR, verdictFor, type Job } from "@/lib/jobs";

/* ------------------------------------------------------------------ */
/* Types + small helpers                                               */
/* ------------------------------------------------------------------ */

export interface Radar3DProps {
  jobs: Job[];
  activeId: string;
  onActivate: (id: string) => void;
  reducedMotion: boolean;
  /** Phone layout: radar sits in its own block, no labels, no view offset. */
  compact: boolean;
}

type Ctrl = {
  rot: number;
  vel: number;
  auto: boolean;
  dragging: boolean;
  moved: boolean;
  lastX: number;
  downX: number;
  pointerX: number;
  pointerY: number;
  introStart: number;
  introT: number;
};
type CtrlRef = RefObject<Ctrl>;
type LabelRefs = RefObject<Record<string, HTMLDivElement | null>>;
/** Screen rects (viewport px) that floating labels must never cover, plus the canvas origin. */
type Avoid = { rects: DOMRect[]; originX: number; originY: number; frame: number; placed: [number, number, number, number][] };
type AvoidRef = RefObject<Avoid>;

const INTRO_SECONDS = 2.5;
const DISC_R = 5;
const YOU_Y = 0.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** HDR color (values > 1) so Bloom picks it up. */
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const glowVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const glowFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    gl_FragColor = vec4(uColor * uIntensity, pow(f, uPower) * uOpacity);
  }
`;

const flatVert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const radialFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uInner;
  uniform float uPeak;
  uniform float uOuter;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float a;
    if (uPeak <= 0.0) a = 1.0 - smoothstep(0.0, uOuter, r);
    else a = r < uPeak ? smoothstep(uInner, uPeak, r) : 1.0 - smoothstep(uPeak, uOuter, r);
    gl_FragColor = vec4(uColor, a * uOpacity);
  }
`;
const dashFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDashes;
  varying vec2 vP;
  void main() {
    float d = fract(atan(vP.y, vP.x) / 6.2831853 * uDashes);
    if (d > 0.55) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;
const sweepFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLen;
  uniform float uR;
  uniform float uOpacity;
  varying vec2 vP;
  void main() {
    float ang = atan(vP.y, vP.x);
    if (ang < 0.0) ang += 6.2831853;
    float t = clamp(ang / uLen, 0.0, 1.0);
    float r = length(vP) / uR;
    float a = pow(t, 2.6) * smoothstep(0.02, 0.22, r) * (1.0 - smoothstep(0.93, 1.0, r));
    gl_FragColor = vec4(uColor, a * uOpacity);
  }
`;
const beamFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHalf;
  uniform float uOpacity;
  varying vec2 vP;
  void main() {
    float x = vP.x;
    float a = smoothstep(-uHalf, -uHalf * 0.55, x) * (1.0 - smoothstep(uHalf * 0.85, uHalf, x));
    float edge = 1.0 - abs(vP.y) / 0.02;
    gl_FragColor = vec4(uColor, a * clamp(edge, 0.0, 1.0) * uOpacity);
  }
`;
const pillarVert = /* glsl */ `
  uniform float uH;
  varying float vY;
  void main() {
    vY = position.y / uH;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const pillarFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vY;
  void main() {
    float a = 0.12 + 0.7 * pow(vY, 2.0) + 0.5 * (1.0 - smoothstep(0.0, 0.12, vY));
    gl_FragColor = vec4(uColor, a * uOpacity);
  }
`;
const ghostVert = /* glsl */ `
  uniform float uTime;
  uniform float uBodyH;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    vec3 p = position;
    if (p.y < 0.0) {
      float t = -p.y / uBodyH;
      float ang = atan(p.z, p.x);
      float wave = sin(ang * 5.0 + uTime * 2.2) * 0.5 + 0.5;
      p.y -= t * t * wave * 0.13;
      p.xz *= 1.0 - t * t * (1.0 - wave) * 0.18;
    }
    vY = p.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const ghostFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(1.0 - f, 1.7);
    float a = (0.16 + rim * 0.95) * uOpacity;
    a *= smoothstep(-0.55, -0.12, vY);
    vec3 c = mix(uColor, vec3(1.0), rim * 0.2) * 1.5;
    gl_FragColor = vec4(c, a);
  }
`;
const dustVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPR;
  uniform float uMotion;
  varying float vAlpha;
  varying float vMix;
  void main() {
    vec3 p = position;
    float t = uTime * uMotion;
    p.y += sin(t * 0.4 + aSeed * 6.2831) * 0.18;
    p.x += sin(t * 0.21 + aSeed * 12.0) * 0.12;
    p.z += cos(t * 0.17 + aSeed * 9.0) * 0.12;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (34.0 * (0.35 + aSeed)) * uPR / -mv.z;
    vAlpha = 0.45 + 0.4 * sin(t * 1.3 + aSeed * 40.0);
    vMix = aSeed;
  }
`;
const dustFrag = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  varying float vAlpha;
  varying float vMix;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(mix(uA, uB, vMix), a * vAlpha * 0.55);
  }
`;

type U = Record<string, THREE.IUniform>;
function shader(vertexShader: string, fragmentShader: string, uniforms: U, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...opts,
  });
}
const glowMat = (color: string, intensity: number, power: number, opacity = 1) =>
  shader(glowVert, glowFrag, {
    uColor: { value: new THREE.Color(color) },
    uIntensity: { value: intensity },
    uPower: { value: power },
    uOpacity: { value: opacity },
  });
const radialMat = (color: THREE.Color, opacity: number, inner: number, peak: number, outer: number, side: THREE.Side = THREE.FrontSide) =>
  shader(
    flatVert,
    radialFrag,
    {
      uColor: { value: color },
      uOpacity: { value: opacity },
      uInner: { value: inner },
      uPeak: { value: peak },
      uOuter: { value: outer },
    },
    { side }
  );
const basicGlow = (color: THREE.Color, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

/* ------------------------------------------------------------------ */
/* Canvas root                                                         */
/* ------------------------------------------------------------------ */

export default function Radar3D(props: Radar3DProps) {
  const labelEls = useRef<Record<string, HTMLDivElement | null>>({});
  return (
    <div className="relative h-full w-full overflow-hidden">
    <Canvas
      className="radar-canvas"
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: 34, near: 0.1, far: 400, position: [0, 40, 4] }}
    >
      <color attach="background" args={[PALETTE.bg]} />
      <Scene {...props} labelEls={labelEls} />
    </Canvas>
      {!props.compact &&
        props.jobs
          .filter((j) => j.label)
          .map((j) => (
            <div
              key={j.id}
              ref={(el) => {
                labelEls.current[j.id] = el;
              }}
              aria-hidden="true"
              className="orb-label pointer-events-none absolute left-0 top-0"
              style={{ opacity: 0 }}
            >
              <span>{j.title.length > 28 ? `${j.title.slice(0, 27)}…` : j.title}</span>
              <span style={{ color: VERDICT_COLOR[verdictFor(j.score)] }}>{j.score}</span>
            </div>
          ))}
    </div>
  );
}

function Scene({ jobs, activeId, onActivate, reducedMotion, compact, labelEls }: Radar3DProps & { labelEls: LabelRefs }) {
  const ctrl = useRef<Ctrl>({
    rot: 0.35,
    vel: 0,
    auto: true,
    dragging: false,
    moved: false,
    lastX: 0,
    downX: 0,
    pointerX: 0,
    pointerY: 0,
    introStart: -1,
    introT: 0,
  });
  const world = useRef<THREE.Group>(null);
  const { gl } = useThree();

  // Keep labels off the text: track the rects of hero / header / card.
  const avoid = useRef<Avoid>({ rects: [], originX: 0, originY: 0, frame: -1, placed: [] });
  useEffect(() => {
    const update = () => {
      const o = gl.domElement.getBoundingClientRect();
      avoid.current.rects = Array.from(document.querySelectorAll("[data-label-avoid]")).map((e) => e.getBoundingClientRect());
      avoid.current.originX = o.left;
      avoid.current.originY = o.top;
    };
    update();
    const id = window.setInterval(update, 800);
    window.addEventListener("resize", update);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", update);
    };
  }, [gl]);

  // Drag-to-rotate (horizontal), plus pointer position for the subtle tilt.
  useEffect(() => {
    const el = gl.domElement;
    const c = ctrl.current;
    const down = (e: PointerEvent) => {
      c.dragging = true;
      c.moved = false;
      c.lastX = e.clientX;
      c.downX = e.clientX;
      c.vel = 0;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        c.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
        c.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
      }
      if (!c.dragging) return;
      const dx = e.clientX - c.lastX;
      c.lastX = e.clientX;
      if (!c.moved && Math.abs(e.clientX - c.downX) > 5) {
        c.moved = true;
        c.auto = false;
        el.classList.add("is-dragging");
      }
      if (c.moved) {
        const k = 0.0065;
        c.rot += dx * k;
        c.vel = THREE.MathUtils.clamp(dx * k, -0.035, 0.035);
      }
    };
    const up = () => {
      c.dragging = false;
      el.classList.remove("is-dragging");
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  useFrame((state, delta) => {
    const c = ctrl.current;
    const dt = Math.min(delta, 0.05);
    if (c.introStart < 0) c.introStart = state.clock.elapsedTime;
    c.introT = reducedMotion ? 99 : state.clock.elapsedTime - c.introStart;
    if (!c.dragging) {
      c.rot += c.vel;
      c.vel *= Math.pow(0.9, dt * 60);
      if (c.auto && !reducedMotion) c.rot += dt * 0.05;
    }
    if (world.current) world.current.rotation.y = c.rot;
  });

  return (
    <>
      <CameraRig ctrl={ctrl} reducedMotion={reducedMotion} compact={compact} />
      <Stars radius={90} depth={60} count={2400} factor={3.4} saturation={0} fade speed={reducedMotion ? 0 : 0.5} />
      <ambientLight intensity={0.08} />
      <hemisphereLight args={["#2a3a44", "#000000", 0.35]} />

      <group ref={world}>
        <Disc />
        <Rings />
        <Sweep reducedMotion={reducedMotion} />
        <You reducedMotion={reducedMotion} />
        {jobs.map((job, i) => (
          <JobNode
            key={job.id}
            job={job}
            index={i}
            active={job.id === activeId}
            onActivate={onActivate}
            ctrl={ctrl}
            reducedMotion={reducedMotion}
            labelEls={labelEls}
            avoid={avoid}
          />
        ))}
        <Dust reducedMotion={reducedMotion} />
      </group>

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.16} luminanceSmoothing={0.35} radius={0.72} />
        <Vignette offset={0.28} darkness={0.72} eskil={false} />
      </EffectComposer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Camera: intro fly-in, framing per layout, mouse tilt                */
/* ------------------------------------------------------------------ */

function CameraRig({ ctrl, reducedMotion, compact }: { ctrl: CtrlRef; reducedMotion: boolean; compact: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  // Frame the disc. Phones: it fills its own block. Desktop: fit it into the
  // free area right of the hero, below the header and above the job card
  // (mirrors the overlay's CSS sizes), so it never sits behind the text.
  const { base, offX, offY } = useMemo(() => {
    const w = size.width;
    const H = size.height;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const elev = THREE.MathUtils.degToRad(compact ? 36 : 31);
    let dist: number;
    let offX = 0;
    let offY = 0;
    if (compact) {
      const distW = (2 * DISC_R + 0.6) / 0.84 / 2 / (tanV * (w / H));
      const distH = 7.2 / 0.92 / 2 / tanV;
      dist = Math.max(distW, distH) * 0.92;
      offY = H * 0.07;
    } else {
      const clamp = THREE.MathUtils.clamp;
      const heroRight = clamp(w * 0.044, 28, 72) + Math.min(600, w * 0.44);
      const margin = clamp(w * 0.024, 20, 36);
      const cardTop = H - margin - 390;
      const xMin = heroRight + 32;
      const xMax = w - 24;
      const yMin = 96;
      const yMax = cardTop + 60; // let the near rim tuck slightly behind the card
      // W = on-screen rim width in px. Visual block spans ~0.33W above and ~0.30W below rim center.
      const W = Math.max(240, Math.min(xMax - xMin, (yMax - yMin) / 0.63, w * 0.39));
      const cx = (xMin + xMax) / 2;
      const cy = yMin + 0.33 * W + Math.max(0, yMax - yMin - 0.63 * W) / 2;
      dist = (2 * DISC_R * H) / (2 * tanV * W);
      offX = -(cx - w / 2);
      offY = -(cy - 0.075 * W - H / 2);
    }
    return { base: new THREE.Vector3(0, Math.sin(elev) * dist, Math.cos(elev) * dist), offX, offY };
  }, [size.width, size.height, compact, camera.fov]);

  useLayoutEffect(() => {
    camera.setViewOffset(size.width, size.height, offX, offY, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, offX, offY]);

  const tilt = useRef({ x: 0, y: 0 });
  const v = useMemo(
    () => ({ start: new THREE.Vector3(), pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0.35, 0), axis: new THREE.Vector3(0, 1, 0) }),
    []
  );

  useFrame((_, delta) => {
    const c = ctrl.current;
    const dt = Math.min(delta, 0.05);
    const p = reducedMotion ? 1 : clamp01(c.introT / INTRO_SECONDS);
    const e = easeOutCubic(p);
    tilt.current.x = THREE.MathUtils.damp(tilt.current.x, compact ? 0 : c.pointerX, 2.5, dt);
    tilt.current.y = THREE.MathUtils.damp(tilt.current.y, compact ? 0 : c.pointerY, 2.5, dt);

    v.start.set(0, base.length() * 2.8, base.z * 0.12);
    v.pos.lerpVectors(v.start, base, e);
    v.pos.applyAxisAngle(v.axis, (1 - e) * 0.9);
    v.pos.x += tilt.current.x * 0.9;
    v.pos.y += tilt.current.y * 0.6;
    camera.position.copy(v.pos);
    camera.lookAt(v.look);
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Disc                                                                */
/* ------------------------------------------------------------------ */

function Disc() {
  const m = useMemo(
    () => ({
      centerSheen: radialMat(new THREE.Color(PALETTE.real), 0.05, 0, 0, 3.4),
      edgeSheen: radialMat(new THREE.Color(PALETTE.cyan), 0.06, 3.2, 4.96, 5.0),
      rim: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.cyan, 2.4), toneMapped: false }),
      rimLow: basicGlow(hdr(PALETTE.cyan, 1.2), 0.35),
      under: radialMat(new THREE.Color(PALETTE.cyan), 0.2, 4.5, 5.05, 6.0, THREE.DoubleSide),
    }),
    []
  );
  return (
    <group>
      <mesh position-y={-0.08}>
        <cylinderGeometry args={[DISC_R, DISC_R - 0.08, 0.16, 160, 1]} />
        <meshStandardMaterial color="#0a1116" metalness={0.92} roughness={0.3} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} material={m.centerSheen}>
        <circleGeometry args={[DISC_R, 96]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.005} material={m.edgeSheen}>
        <circleGeometry args={[DISC_R, 128]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} material={m.rim}>
        <torusGeometry args={[DISC_R, 0.022, 10, 220]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position-y={-0.16} material={m.rimLow}>
        <torusGeometry args={[DISC_R - 0.08, 0.01, 8, 200]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.42} material={m.under}>
        <ringGeometry args={[3.9, 6.8, 160]} />
      </mesh>
    </group>
  );
}

function Rings() {
  const rGhost = radiusForScore(35);
  const m = useMemo(() => {
    const solid = (hex: string, k: number, o: number) => basicGlow(hdr(hex, k), o);
    return {
      r90: solid(PALETTE.real, 1.1, 0.75),
      r75: solid(PALETTE.real, 0.8, 0.5),
      r50: solid(PALETTE.maybe, 0.8, 0.42),
      ghost: shader(flatVert, dashFrag, {
        uColor: { value: hdr(PALETTE.ghost, 1.6) },
        uOpacity: { value: 0.9 },
        uDashes: { value: 96 },
      }),
      band: radialMat(new THREE.Color(PALETTE.ghost), 0.16, rGhost, rGhost + 0.18, 4.97),
      spokes: new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
      ticks: new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
  }, [rGhost]);

  const lines = useMemo(() => {
    const spoke: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spoke.push(Math.cos(a) * 0.75, 0.012, Math.sin(a) * 0.75, Math.cos(a) * 4.95, 0.012, Math.sin(a) * 4.95);
    }
    const tick: number[] = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const r0 = i % 10 === 0 ? 4.7 : 4.84;
      tick.push(Math.cos(a) * r0, 0.012, Math.sin(a) * r0, Math.cos(a) * 4.95, 0.012, Math.sin(a) * 4.95);
    }
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute("position", new THREE.Float32BufferAttribute(spoke, 3));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(tick, 3));
    return { spokes: g1, ticks: g2 };
  }, []);

  const ring = (r: number, w: number) => [r - w, r + w, 192] as [number, number, number];

  return (
    <group>
      <group rotation-x={-Math.PI / 2} position-y={0.01}>
        <mesh material={m.r90}>
          <ringGeometry args={ring(radiusForScore(90), 0.011)} />
        </mesh>
        <mesh material={m.r75}>
          <ringGeometry args={ring(radiusForScore(75), 0.009)} />
        </mesh>
        <mesh material={m.r50}>
          <ringGeometry args={ring(radiusForScore(50), 0.009)} />
        </mesh>
        <mesh material={m.band}>
          <ringGeometry args={[rGhost, 4.97, 192]} />
        </mesh>
        <mesh material={m.ghost}>
          <ringGeometry args={ring(rGhost, 0.013)} />
        </mesh>
      </group>
      <lineSegments geometry={lines.spokes} material={m.spokes} />
      <lineSegments geometry={lines.ticks} material={m.ticks} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Sweep beam                                                          */
/* ------------------------------------------------------------------ */

function Sweep({ reducedMotion }: { reducedMotion: boolean }) {
  const g = useRef<THREE.Group>(null);
  const len = 0.95;
  const R = 4.9;
  const m = useMemo(
    () => ({
      wedge: shader(flatVert, sweepFrag, {
        uColor: { value: hdr(PALETTE.real, 1.0) },
        uLen: { value: len },
        uR: { value: R },
        uOpacity: { value: 0.34 },
      }),
      beam: shader(flatVert, beamFrag, {
        uColor: { value: hdr(PALETTE.real, 3.2) },
        uHalf: { value: (R - 0.35) / 2 },
        uOpacity: { value: 1 },
      }),
    }),
    []
  );
  useFrame((_, dt) => {
    if (!reducedMotion && g.current) g.current.rotation.y += Math.min(dt, 0.05) * 0.55;
  });
  const mid = (R + 0.35) / 2;
  return (
    <group ref={g} rotation-y={1.2}>
      <group rotation-x={-Math.PI / 2} position-y={0.02}>
        <mesh material={m.wedge}>
          <circleGeometry args={[R, 72, 0, len]} />
        </mesh>
        <mesh material={m.beam} position={[Math.cos(len) * mid, Math.sin(len) * mid, 0.002]} rotation-z={len}>
          <planeGeometry args={[R - 0.35, 0.04]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Center "YOU"                                                        */
/* ------------------------------------------------------------------ */

function You({ reducedMotion }: { reducedMotion: boolean }) {
  const halo = useRef<THREE.Mesh>(null);
  const o1 = useRef<THREE.Group>(null);
  const o2 = useRef<THREE.Group>(null);
  const m = useMemo(
    () => ({
      core: new THREE.MeshBasicMaterial({ color: hdr("#E6FFF5", 3.2), toneMapped: false }),
      g1: glowMat(PALETTE.real, 1.7, 1.2),
      g2: glowMat(PALETTE.real, 1.0, 2.8, 0.32),
      halo: radialMat(hdr(PALETTE.real, 1.3), 0.5, 0.42, 0.62, 1.05),
      ringE: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.real, 2.0), toneMapped: false, transparent: true, opacity: 0.8 }),
      ringC: new THREE.MeshBasicMaterial({ color: hdr(PALETTE.cyan, 2.0), toneMapped: false, transparent: true, opacity: 0.7 }),
      bead: new THREE.MeshBasicMaterial({ color: hdr("#ffffff", 4), toneMapped: false }),
      floor: radialMat(new THREE.Color(PALETTE.real), 0.13, 0, 0, 1.6),
    }),
    []
  );
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const k = reducedMotion ? 0.4 : Math.sin(t * 2.1) * 0.5 + 0.5;
    if (halo.current) halo.current.scale.setScalar(1 + k * 0.35);
    m.halo.uniforms.uOpacity.value = 0.42 - k * 0.27;
    if (!reducedMotion) {
      if (o1.current) o1.current.rotation.z += dt * 1.1;
      if (o2.current) o2.current.rotation.z -= dt * 0.8;
    }
  });
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.015} material={m.floor}>
        <circleGeometry args={[1.6, 64]} />
      </mesh>
      <group position-y={YOU_Y}>
        <mesh material={m.core}>
          <sphereGeometry args={[0.16, 32, 24]} />
        </mesh>
        <mesh material={m.g1}>
          <sphereGeometry args={[0.3, 32, 24]} />
        </mesh>
        <mesh material={m.g2}>
          <sphereGeometry args={[0.68, 32, 24]} />
        </mesh>
        <Billboard>
          <mesh ref={halo} material={m.halo}>
            <planeGeometry args={[2.2, 2.2]} />
          </mesh>
        </Billboard>
        <group rotation={[1.25, 0.25, 0]}>
          <mesh material={m.ringE}>
            <torusGeometry args={[0.5, 0.006, 8, 160]} />
          </mesh>
          <group ref={o1}>
            <mesh material={m.bead} position={[0.5, 0, 0]}>
              <sphereGeometry args={[0.025, 12, 8]} />
            </mesh>
          </group>
        </group>
        <group rotation={[1.95, -0.45, 0]}>
          <mesh material={m.ringC}>
            <torusGeometry args={[0.68, 0.005, 8, 160]} />
          </mesh>
          <group ref={o2}>
            <mesh material={m.bead} position={[0, 0.68, 0]}>
              <sphereGeometry args={[0.022, 12, 8]} />
            </mesh>
          </group>
        </group>
        <pointLight color={PALETTE.real} intensity={9} distance={9} decay={1.6} position-y={0.35} />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

function makeGhostGeometry(R: number, bodyH: number) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * R, Math.cos(a) * R));
  }
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(R * (1 + 0.14 * t), -t * bodyH));
  }
  const g = new THREE.LatheGeometry(pts, 56);
  g.computeVertexNormals();
  return g;
}

interface JobNodeProps {
  job: Job;
  index: number;
  active: boolean;
  onActivate: (id: string) => void;
  ctrl: CtrlRef;
  reducedMotion: boolean;
  labelEls: LabelRefs;
  avoid: AvoidRef;
}

function JobNode({ job, index, active, onActivate, ctrl, reducedMotion, labelEls, avoid }: JobNodeProps) {
  const verdict = verdictFor(job.score);
  const color = VERDICT_COLOR[verdict];
  const isGhost = verdict === "ghost";
  const r = radiusForScore(job.score);
  const ang = THREE.MathUtils.degToRad(job.angle);
  const x = Math.cos(ang) * r;
  const z = -Math.sin(ang) * r;
  const h = isGhost ? 0.78 : 0.82 + ((job.score * 7) % 10) * 0.035;
  const seed = index * 1.37 + 0.3;
  // During the intro orbs rise one by one; jobs added later (a new search) rise from "now".
  const [riseStart] = useState(() => {
    const t = ctrl.current.introT;
    return t > 2 ? t + 0.15 + index * 0.09 : 1.5 + index * 0.2;
  });

  const [hovered, setHovered] = useState(false);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const root = useRef<THREE.Group>(null);
  // Mount at the first position; later score changes (AI review) glide there.
  const [startPos] = useState<[number, number, number]>(() => [x, 0, z]);
  const orb = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Group>(null);
  const pillar = useRef<THREE.Mesh>(null);
  const pings = useRef<(THREE.Mesh | null)[]>([]);
  const select = useRef<THREE.Mesh>(null);
  const size = useThree((s) => s.size);
  const anim = useRef({ lift: 0, grow: 1, sel: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const m = useMemo(() => {
    const pillarGeo = new THREE.CylinderGeometry(0.011, 0.011, h, 8, 1, true);
    pillarGeo.translate(0, h / 2, 0);
    return {
      core: new THREE.MeshBasicMaterial({ color: hdr("#ffffff", 2.6), toneMapped: false }),
      s1: glowMat(color, 2.4, 0.9),
      s2: glowMat(color, 1.2, 2.2, 0.6),
      pillarGeo,
      pillar: shader(pillarVert, pillarFrag, {
        uColor: { value: hdr(color, 1.4) },
        uOpacity: { value: 0.7 },
        uH: { value: h },
      }),
      ping: [basicGlow(hdr(color, 1.4), 0), basicGlow(hdr(color, 1.4), 0)],
      select: basicGlow(hdr(color, 1.8), 0),
      ghostGeo: makeGhostGeometry(0.24, 0.36),
      ghostBody: shader(ghostVert, ghostFrag, {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uBodyH: { value: 0.36 },
      }, { side: THREE.DoubleSide }),
      eye: new THREE.MeshBasicMaterial({ color: "#050309", transparent: true, opacity: 0.95, depthWrite: false }),
      aura: glowMat(color, 1.0, 1.8, 0.45),
    };
  }, [color, h]);

  useEffect(() => () => {
    gl.domElement.style.cursor = "";
  }, [gl]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const c = ctrl.current;
    const rise = reducedMotion ? 1 : clamp01((c.introT - riseStart) / 0.8);
    const sel = hovered || active;
    const a = anim.current;
    a.lift = THREE.MathUtils.damp(a.lift, sel ? 0.3 : 0, 8, dt);
    a.grow = THREE.MathUtils.damp(a.grow, sel ? 1.25 : 1, 8, dt);
    a.sel = THREE.MathUtils.damp(a.sel, active ? 1 : 0, 6, dt);

    if (root.current) {
      const k = reducedMotion ? 60 : 3;
      root.current.position.x = THREE.MathUtils.damp(root.current.position.x, x, k, dt);
      root.current.position.z = THREE.MathUtils.damp(root.current.position.z, z, k, dt);
    }

    const bob = reducedMotion ? 0 : isGhost ? Math.sin(t * 1.15 + seed) * 0.09 : Math.sin(t * 0.9 + seed) * 0.03;
    if (orb.current) {
      orb.current.position.y = h + a.lift + bob - (1 - easeOutCubic(rise)) * 0.9;
      orb.current.scale.setScalar(Math.max(0.0001, a.grow * easeOutBack(rise)));
    }
    if (pillar.current) pillar.current.scale.y = Math.max(0.0001, easeOutCubic(rise));

    // Floor ping waves
    for (let k = 0; k < 2; k++) {
      const mesh = pings.current[k];
      if (!mesh) continue;
      const p = reducedMotion ? 0.4 : (t * 0.42 + k * 0.5 + seed) % 1;
      mesh.scale.setScalar(0.08 + p * 0.62);
      m.ping[k].opacity = reducedMotion ? (k === 0 ? 0.25 * rise : 0) : Math.pow(1 - p, 2) * 0.7 * rise;
    }
    if (select.current) {
      select.current.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(t * 3) * 0.06));
      m.select.opacity = a.sel * 0.9 * rise;
    }

    // Ghost: face the camera-ish, slow turn, flicker, animated tips
    if (isGhost && ghost.current && orb.current) {
      const parent = orb.current.parent;
      if (parent) {
        tmp.copy(camera.position);
        parent.worldToLocal(tmp);
        const yaw = Math.atan2(tmp.x - (root.current?.position.x ?? x), tmp.z - (root.current?.position.z ?? z));
        ghost.current.rotation.y = yaw + (reducedMotion ? 0 : Math.sin(t * 0.35 + seed) * 0.6);
      }
      ghost.current.rotation.z = reducedMotion ? 0 : Math.sin(t * 0.8 + seed) * 0.08;
      let flick = 1;
      if (!reducedMotion) {
        flick = 0.82 + 0.18 * Math.sin(t * 3.1 + seed);
        const n = Math.sin(Math.floor(t * 9 + seed * 10) * 12.9898) * 43758.5453;
        if (n - Math.floor(n) > 0.94) flick *= 0.4;
      }
      m.ghostBody.uniforms.uOpacity.value = flick;
      m.ghostBody.uniforms.uTime.value = reducedMotion ? 0 : t;
      m.aura.uniforms.uOpacity.value = 0.45 * flick;
    }

    // Screen-space glass label that follows the orb
    const el = job.label ? labelEls.current[job.id] : null;
    if (el && orb.current) {
      orb.current.getWorldPosition(tmp);
      tmp.y += isGhost ? 0.62 : 0.42;
      tmp.project(camera);
      const sx = (tmp.x * 0.5 + 0.5) * size.width;
      const sy = (-tmp.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      const w = el.offsetWidth;
      const hh = el.offsetHeight;
      const av = avoid.current;
      const { rects, originX, originY } = av;
      // Labels also avoid each other: reset the placed list once per frame.
      if (av.frame !== state.clock.elapsedTime) {
        av.frame = state.clock.elapsedTime;
        av.placed = [];
      }
      const l = originX + sx - w / 2 - 10;
      const r2 = originX + sx + w / 2 + 10;
      const top = originY + sy - hh - 10;
      const bottom = originY + sy + 10;
      let blocked = tmp.z > 1 || sx - w / 2 < 4 || sx + w / 2 > size.width - 4;
      for (const rc of rects) {
        if (l < rc.right && r2 > rc.left && top < rc.bottom && bottom > rc.top) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        for (const [pl, pt, pr, pb] of av.placed) {
          if (l < pr && r2 > pl && top < pb && bottom > pt) {
            blocked = true;
            break;
          }
        }
      }
      if (!blocked) av.placed.push([l, top, r2, bottom]);
      el.style.opacity = blocked ? "0" : String(clamp01((rise - 0.6) / 0.4));
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (ctrl.current.dragging && ctrl.current.moved) return;
    setHovered(true);
    onActivate(job.id);
    gl.domElement.style.cursor = "pointer";
  };
  const out = () => {
    setHovered(false);
    gl.domElement.style.cursor = "";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return;
    onActivate(job.id);
  };

  return (
    <>
      <group ref={root} position={startPos}>
        {!isGhost && (
          <>
            <mesh ref={pillar} geometry={m.pillarGeo} material={m.pillar} />
            {[0, 1].map((k) => (
              <mesh
                key={k}
                ref={(el) => {
                  pings.current[k] = el;
                }}
                rotation-x={-Math.PI / 2}
                position-y={0.02}
                material={m.ping[k]}
              >
                <ringGeometry args={[0.9, 1, 64]} />
              </mesh>
            ))}
          </>
        )}
        <mesh ref={select} rotation-x={-Math.PI / 2} position-y={0.025} material={m.select}>
          <ringGeometry args={[0.26, 0.29, 64]} />
        </mesh>

        <group ref={orb} position-y={h}>
          {isGhost ? (
            <group ref={ghost}>
              <mesh geometry={m.ghostGeo} material={m.ghostBody} />
              <mesh material={m.eye} position={[-0.078, 0.05, 0.222]} scale={[1, 1.45, 0.6]} renderOrder={3}>
                <sphereGeometry args={[0.034, 16, 12]} />
              </mesh>
              <mesh material={m.eye} position={[0.078, 0.05, 0.222]} scale={[1, 1.45, 0.6]} renderOrder={3}>
                <sphereGeometry args={[0.034, 16, 12]} />
              </mesh>
              <mesh material={m.aura}>
                <sphereGeometry args={[0.62, 24, 16]} />
              </mesh>
            </group>
          ) : (
            <>
              <mesh material={m.core}>
                <sphereGeometry args={[0.07, 20, 14]} />
              </mesh>
              <mesh material={m.s1}>
                <sphereGeometry args={[0.15, 24, 16]} />
              </mesh>
              <mesh material={m.s2}>
                <sphereGeometry args={[0.34, 24, 16]} />
              </mesh>
            </>
          )}

          {/* Generous invisible hit target */}
          <mesh onPointerOver={over} onPointerOut={out} onClick={click}>
            <sphereGeometry args={[isGhost ? 0.42 : 0.38, 12, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>

        </group>
      </group>

      {verdict === "real" && (
        <ReferralPath end={[x, h, z]} radius={r} riseStart={riseStart} seed={seed} ctrl={ctrl} reducedMotion={reducedMotion} />
      )}
    </>
  );
}

function ReferralPath({
  end,
  radius,
  riseStart,
  seed,
  ctrl,
  reducedMotion,
}: {
  end: [number, number, number];
  radius: number;
  riseStart: number;
  seed: number;
  ctrl: CtrlRef;
  reducedMotion: boolean;
}) {
  const pulse = useRef<THREE.Group>(null);
  const { curve, geo, m } = useMemo(() => {
    const a = new THREE.Vector3(0, YOU_Y, 0);
    const b = new THREE.Vector3(...end);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 1.0 + radius * 0.25;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    return {
      curve,
      geo: new THREE.TubeGeometry(curve, 90, 0.0065, 6, false),
      m: {
        tube: basicGlow(hdr(PALETTE.real, 1.5), 0),
        core: new THREE.MeshBasicMaterial({ color: hdr("#E6FFF5", 4), toneMapped: false, transparent: true }),
        glow: glowMat(PALETTE.real, 2.0, 1.3, 1),
      },
    };
    // end is a fresh array each render; its values are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end[0], end[1], end[2], radius]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const o = reducedMotion ? 1 : clamp01((ctrl.current.introT - riseStart - 0.5) / 0.8);
    m.tube.opacity = 0.38 * o;
    if (pulse.current) {
      if (reducedMotion) {
        pulse.current.visible = false;
        return;
      }
      const p = (t * 0.32 + seed) % 1;
      curve.getPointAt(p, pulse.current.position);
      const s = Math.sin(Math.PI * p) * o;
      pulse.current.scale.setScalar(Math.max(0.0001, s));
    }
  });

  return (
    <>
      <mesh geometry={geo} material={m.tube} />
      <group ref={pulse}>
        <mesh material={m.core}>
          <sphereGeometry args={[0.035, 12, 8]} />
        </mesh>
        <mesh material={m.glow}>
          <sphereGeometry args={[0.12, 16, 12]} />
        </mesh>
      </group>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Dust                                                                */
/* ------------------------------------------------------------------ */

function Dust({ reducedMotion, count = 320 }: { reducedMotion: boolean; count?: number }) {
  const gl = useThree((s) => s.gl);
  const { geo, mat } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const rr = Math.sqrt(Math.random()) * 5.4;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * rr;
      pos[i * 3 + 1] = 0.15 + Math.random() * 2.6;
      pos[i * 3 + 2] = Math.sin(a) * rr;
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const mat = shader(dustVert, dustFrag, {
      uTime: { value: 0 },
      uPR: { value: 1 },
      uMotion: { value: 1 },
      uA: { value: hdr(PALETTE.real, 0.9) },
      uB: { value: hdr(PALETTE.cyan, 0.9) },
    });
    return { geo, mat };
  }, [count]);

  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uPR.value = gl.getPixelRatio();
    mat.uniforms.uMotion.value = reducedMotion ? 0 : 1;
  });

  return <points geometry={geo} material={mat} />;
}
