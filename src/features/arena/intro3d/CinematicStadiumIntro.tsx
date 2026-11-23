import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Volume2, VolumeX, SkipForward } from 'lucide-react';
import { StadiumIntroAudio } from './introAudio';
import { createIntroTextures } from './proceduralTextures';
import { buildStadium, STADIUM_CONSTANTS } from './stadiumBuilder';
import {
  BALL_RADIUS,
  buildFootballPlayer,
  buildMatchFootball,
  createParticlePool,
} from './playerAndBallBuilder';
import { buildLogoBadge3D } from './logoReveal3d';

export type CinematicIntroPhase =
  | 'dark'
  | 'lights'
  | 'player'
  | 'action'
  | 'goal'
  | 'logo'
  | 'title'
  | 'ready';

interface CinematicStadiumIntroProps {
  active: boolean;
  replayNonce: number;
  reducedMotion: boolean;
  audioEnabled: boolean;
  onToggleAudio: (nextState: boolean) => void;
  onPhaseChange: (phase: CinematicIntroPhase) => void;
  onDomHeroBlendChange: (blend: number) => void; // 0..1 when DOM hero UI fades seamlessly in
  onComplete: () => void;
  onSkip: () => void;
}

const TOTAL_INTRO_DURATION = 11.8;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerpVec(
  out: THREE.Vector3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  t: number
): THREE.Vector3 {
  out.set(
    ax + (bx - ax) * t,
    ay + (by - ay) * t,
    az + (bz - az) * t
  );
  return out;
}

function getPhaseForTime(t: number): CinematicIntroPhase {
  if (t < 1.7) return 'dark';
  if (t < 3.55) return 'lights';
  if (t < 5.45) return 'player';
  if (t < 7.45) return 'action';
  if (t < 9.25) return 'goal';
  if (t < 10.65) return 'logo';
  if (t < TOTAL_INTRO_DURATION) return 'title';
  return 'ready';
}

const SCENE_CHAPTER_LABELS: Record<CinematicIntroPhase, string> = {
  dark: '01 · Entering Arena',
  lights: '02 · Floodlight Ignition',
  player: '03 · Touching Turf',
  action: '04 · Match Tempo',
  goal: '05 · Top Corner',
  logo: '06 · THE GRID',
  title: '07 · Welcome to The Pitch',
  ready: '',
};

export function CinematicStadiumIntro({
  active,
  replayNonce,
  reducedMotion,
  audioEnabled,
  onToggleAudio,
  onPhaseChange,
  onDomHeroBlendChange,
  onComplete,
  onSkip,
}: CinematicStadiumIntroProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<StadiumIntroAudio | null>(null);
  const darkVeilRef = useRef<HTMLDivElement | null>(null);
  const flashVeilRef = useRef<HTMLDivElement | null>(null);

  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<CinematicIntroPhase>(() =>
    active && !reducedMotion ? 'dark' : 'ready'
  );
  const [progressRatio, setProgressRatio] = useState(0);

  // Live reactive refs for loop without triggering effect teardown
  const activeRef = useRef(active);
  activeRef.current = active;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const timelineTimeRef = useRef<number>(active && !reducedMotion ? 0 : TOTAL_INTRO_DURATION);
  const completedEmittedRef = useRef<boolean>(!active || reducedMotion);
  const pointerParallaxRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cuesFiredRef = useRef<Set<string>>(new Set());

  const callbacksRef = useRef({
    onPhaseChange,
    onDomHeroBlendChange,
    onComplete,
  });
  callbacksRef.current = { onPhaseChange, onDomHeroBlendChange, onComplete };

  // Initialize audio controller cleanly
  useEffect(() => {
    const audio = new StadiumIntroAudio();
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  // Sync user sound toggle cleanly
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.setEnabled(audioEnabled);
  }, [audioEnabled]);

  // Reset timeline on Replay Intro or Skip Intro
  useEffect(() => {
    if (reducedMotion || !active) {
      timelineTimeRef.current = TOTAL_INTRO_DURATION;
      completedEmittedRef.current = true;
      setCurrentPhase('ready');
      setProgressRatio(1);
      callbacksRef.current.onDomHeroBlendChange(1);
      callbacksRef.current.onPhaseChange('ready');
      audioRef.current?.fadeOutBed(0.5);
      return;
    }

    timelineTimeRef.current = 0;
    completedEmittedRef.current = false;
    cuesFiredRef.current.clear();
    setCurrentPhase('dark');
    setProgressRatio(0);
    callbacksRef.current.onDomHeroBlendChange(0);
    callbacksRef.current.onPhaseChange('dark');
    if (audioEnabled) {
      audioRef.current?.startStadiumBed();
    }
  }, [active, replayNonce, reducedMotion, audioEnabled]);

  // Main Three.js WebGL Lifecycle
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    if (typeof window === 'undefined') return;

    let renderer: THREE.WebGLRenderer | null = null;
    let isSoftwareGl = false;

    try {
      const probeCanvas = document.createElement('canvas');
      const gl =
        probeCanvas.getContext('webgl2', { powerPreference: 'high-performance' }) ||
        probeCanvas.getContext('webgl', { powerPreference: 'high-performance' });
      if (!gl) {
        setWebglUnavailable(true);
        callbacksRef.current.onDomHeroBlendChange(1);
        callbacksRef.current.onPhaseChange('ready');
        callbacksRef.current.onComplete();
        return;
      }
      const rendererStr = String(gl.getParameter(gl.RENDERER) || '');
      isSoftwareGl = /SwiftShader|llvmpipe|Software Rasterizer|WARP/i.test(rendererStr);
    } catch {
      setWebglUnavailable(true);
      callbacksRef.current.onDomHeroBlendChange(1);
      callbacksRef.current.onPhaseChange('ready');
      callbacksRef.current.onComplete();
      return;
    }

    const isMobile = window.innerWidth < 768;
    const maxDpr = isSoftwareGl ? 1 : isMobile ? 1.5 : Math.min(window.devicePixelRatio || 1, 2);

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setWebglUnavailable(true);
      callbacksRef.current.onDomHeroBlendChange(1);
      callbacksRef.current.onPhaseChange('ready');
      callbacksRef.current.onComplete();
      return;
    }

    renderer.setPixelRatio(maxDpr);
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const domEl = renderer.domElement;
    domEl.style.display = 'block';
    domEl.style.width = '100%';
    domEl.style.height = '100%';
    container.appendChild(domEl);

    const onContextLost = (event: Event) => {
      event.preventDefault();
    };
    const onContextRestored = () => {
      renderer?.setSize(
        container.clientWidth || window.innerWidth,
        container.clientHeight || window.innerHeight
      );
    };
    domEl.addEventListener('webglcontextlost', onContextLost);
    domEl.addEventListener('webglcontextrestored', onContextRestored);

    // Scene & Exponential Night Atmospheric Fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040711);
    scene.fog = new THREE.FogExp2(0x050915, 0.0135);

    // PMREM metallic & leather reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.5;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(46, Math.max(0.3, width / height), 0.1, 160);

    // Build Procedural Textures, Stadium, Player, Ball, Particle Pool & 3D Logo Badge
    const textures = createIntroTextures(renderer.capabilities.getMaxAnisotropy());
    const stadium = buildStadium(textures, isMobile);
    const player = buildFootballPlayer();
    const ball = buildMatchFootball(textures);
    const particlePool = createParticlePool(isMobile ? 80 : 180, textures.particleSprite);
    const logoBadge = buildLogoBadge3D();

    scene.add(
      stadium.group,
      player.root,
      ball.group,
      ball.shadowPlane,
      particlePool.points,
      logoBadge.group
    );

    // Track previous ball coords for exact physical rolling rotation
    const prevBallPos = new THREE.Vector3(0, BALL_RADIUS, 2.2);
    const camPos = new THREE.Vector3();
    const camTarget = new THREE.Vector3();
    const tempOrigin = new THREE.Vector3();
    let lastReportedPhase: CinematicIntroPhase = currentPhase;
    let lastDomBlend = -1;
    let lastTick = performance.now();
    let lastUiSync = 0;
    let rafId = 0;
    let paceTimerId = 0;
    let contextActive = true;

    const triggerCueOnce = (cueId: string, fn: () => void) => {
      if (cuesFiredRef.current.has(cueId)) return;
      cuesFiredRef.current.add(cueId);
      fn();
    };

    const handleResize = () => {
      if (!renderer || !container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      if (w <= 0 || h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const handlePointerMove = (e: PointerEvent) => {
      if (timelineTimeRef.current < TOTAL_INTRO_DURATION) return;
      const nx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      const ny = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      pointerParallaxRef.current.x = nx;
      pointerParallaxRef.current.y = ny;
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    const applyTimelineFrame = (t: number, dt: number, nowMs: number) => {
      const mobileAspectExtra = camera.aspect < 0.85 ? (0.85 - camera.aspect) * 14 : 0;
      let targetFov = 46 + mobileAspectExtra;
      let flashOpacity = 0;
      let darkVeilOpacity = 0;

      // Reset net outside goal impact window
      if (t < 8.3 || t > 10.9) {
        stadium.resetNorthNet();
      }

      // -------------------------------------------------------------
      // FLOODLIGHT SEQUENTIAL IGNITION (Scene 02 & onwards)
      // -------------------------------------------------------------
      const p0 = t < 1.72 ? 0.04 : smoothstep(1.72, 1.94, t) * 1.05;
      const p1 = t < 2.12 ? 0.04 : smoothstep(2.12, 2.34, t) * 1.05;
      const p2 = t < 2.5 ? 0.03 : smoothstep(2.5, 2.78, t) * 1.0;
      const p3 = t < 2.55 ? 0.03 : smoothstep(2.55, 2.84, t) * 1.0;

      if (t >= 1.72 && activeRef.current) {
        triggerCueOnce('tower0', () => audioRef.current?.playFloodlightIgnition(0));
      }
      if (t >= 2.12 && activeRef.current) {
        triggerCueOnce('tower1', () => audioRef.current?.playFloodlightIgnition(1));
      }
      if (t >= 2.5 && activeRef.current) {
        triggerCueOnce('tower23', () => audioRef.current?.playFloodlightIgnition(2));
      }

      stadium.setTowerPowers([p0, p1, p2, p3]);

      // -------------------------------------------------------------
      // SCENE 01 — THE DARK STADIUM (0.0 -> 1.70)
      // -------------------------------------------------------------
      if (t < 1.7) {
        darkVeilOpacity = 1 - smoothstep(0.05, 1.05, t);
        const u = smoothstep(0, 1.7, t);
        lerpVec(camPos, 0, 11.4, 24.5, 0, 8.6, 16.5, u);
        lerpVec(camTarget, 0, 1.6, -4.0, 0, 1.3, -6.5, u);
        targetFov = 48 + mobileAspectExtra;

        player.root.visible = false;
        ball.group.position.set(0, BALL_RADIUS, 2.2);
        ball.resetRotation();
        prevBallPos.copy(ball.group.position);
        logoBadge.setReveal(0, 0);
        stadium.setCenterFocusPower(0);
      }
      // -------------------------------------------------------------
      // SCENE 02 — STADIUM LIGHT ACTIVATION (1.70 -> 3.55)
      // -------------------------------------------------------------
      else if (t < 3.55) {
        const u = smoothstep(1.7, 3.55, t);
        // Sweeping cinematic plunge from high SE stands down toward pitch center
        const arcAngle = THREE.MathUtils.lerp(0.62, 0.28, u);
        const rad = THREE.MathUtils.lerp(18.5, 9.8, u);
        camPos.set(Math.sin(arcAngle) * rad, THREE.MathUtils.lerp(10.8, 2.45, u), Math.cos(arcAngle) * rad);
        lerpVec(camTarget, 0, 0.8, -5.0, 0, 0.45, 2.8, u);
        targetFov = THREE.MathUtils.lerp(52, 44, u) + mobileAspectExtra;

        player.root.visible = true;
        player.root.position.set(0, 0, 6.2);
        player.root.rotation.y = 0;
        player.applyPose({
          strideCycle: 0,
          strideWeight: 0,
          prepareAmount: 0.1,
          kickWindup: 0,
          kickStrike: 0,
          torsoLeanForward: 0,
          torsoTwist: 0,
        });
        ball.group.position.set(0, BALL_RADIUS, 2.2);
        prevBallPos.copy(ball.group.position);
        logoBadge.setReveal(0, 0);
        stadium.setCenterFocusPower(0);
      }
      // -------------------------------------------------------------
      // SCENE 03 — THE PLAYER ENTRANCE (3.55 -> 5.45)
      // -------------------------------------------------------------
      else if (t < 5.45) {
        player.root.visible = true;
        ball.group.position.set(0, BALL_RADIUS, 2.2);
        prevBallPos.copy(ball.group.position);
        logoBadge.setReveal(0, 0);
        stadium.setCenterFocusPower(0);

        // Player walks naturally from z=6.2 -> z=2.72
        const walkProgress = smoothstep(3.55, 4.95, t);
        const pz = THREE.MathUtils.lerp(6.2, 2.72, walkProgress);
        player.root.position.set(0, 0, pz);
        player.root.rotation.y = 0;

        const strideFade = 1 - smoothstep(4.72, 5.1, t);
        const prepareAmt = smoothstep(4.9, 5.45, t);
        player.applyPose({
          strideCycle: (t - 3.55) * 6.8,
          strideWeight: strideFade * 0.72,
          prepareAmount: prepareAmt,
          kickWindup: 0,
          kickStrike: 0,
          torsoLeanForward: 0.06,
          torsoTwist: 0,
        });

        // Footstep SFX & subtle turf dust specks
        if (t > 3.7 && activeRef.current) {
          triggerCueOnce('step1', () => {
            audioRef.current?.playFootstep(0.75);
            particlePool.emitBurst(tempOrigin.set(-0.1, 0.04, 5.4), 7, 0.9, 0.7, 0x264430);
          });
        }
        if (t > 4.2 && activeRef.current) {
          triggerCueOnce('step2', () => {
            audioRef.current?.playFootstep(0.85);
            particlePool.emitBurst(tempOrigin.set(0.1, 0.04, 4.1), 8, 1.0, 0.8, 0x264430);
          });
        }

        if (t < 4.18) {
          // Close-up of cleated boots gripping turf
          const cu = smoothstep(3.55, 4.18, t);
          lerpVec(camPos, 0.92, 0.28, pz - 0.85, 0.82, 0.3, pz - 0.55, cu);
          camTarget.set(0, 0.14, pz - 0.15);
          targetFov = 36 + mobileAspectExtra;
        } else if (t < 4.76) {
          // Low close-up on hero football with player striding toward it
          const cu = smoothstep(4.18, 4.76, t);
          lerpVec(camPos, -0.58, 0.25, 1.55, -0.78, 0.34, 1.72, cu);
          camTarget.set(0, 0.22, 2.38);
          targetFov = 38 + mobileAspectExtra;
        } else {
          // Orbital sweep around poised player preparing dribble
          const cu = smoothstep(4.76, 5.45, t);
          const orbitAngle = THREE.MathUtils.lerp(-2.25, -0.42, cu);
          const orbitR = THREE.MathUtils.lerp(2.25, 2.65, cu);
          camPos.set(
            Math.sin(orbitAngle) * orbitR,
            THREE.MathUtils.lerp(0.85, 1.15, cu),
            2.45 + Math.cos(orbitAngle) * orbitR
          );
          camTarget.set(0, 0.78, 2.2);
          targetFov = 44 + mobileAspectExtra;
        }
      }
      // -------------------------------------------------------------
      // SCENE 04 — THE FOOTBALL ACTION (5.45 -> 7.45)
      // -------------------------------------------------------------
      else if (t < 7.45) {
        const u = smoothstep(5.45, 7.45, t);
        // S-curve fast dribble from center circle toward penalty arc
        const bz = THREE.MathUtils.lerp(2.2, -8.95, u);
        const bx = Math.sin(u * Math.PI * 1.45) * -1.05 + smoothstep(0.65, 1.0, u) * 0.42;

        // Micro bounce on dribble touches
        const touchWave = Math.abs(Math.sin(u * Math.PI * 3.0));
        const by = BALL_RADIUS + (1 - touchWave) * 0.035;

        ball.group.position.set(bx, by, bz);
        ball.updateGroundRoll(bx - prevBallPos.x, bz - prevBallPos.z);
        prevBallPos.copy(ball.group.position);

        // Trigger dribble taps & turf bursts
        if (u > 0.22 && activeRef.current) {
          triggerCueOnce('dribble1', () => {
            audioRef.current?.playDribbleTap();
            particlePool.emitBurst(tempOrigin.set(bx, 0.05, bz), 12, 1.6, 1.2, 0x294c34);
          });
        }
        if (u > 0.52 && activeRef.current) {
          triggerCueOnce('dribble2', () => {
            audioRef.current?.playDribbleTap();
            particlePool.emitBurst(tempOrigin.set(bx, 0.05, bz), 14, 1.8, 1.4, 0x294c34);
          });
        }
        if (u > 0.78 && activeRef.current) {
          triggerCueOnce('dribble3', () => {
            audioRef.current?.playDribbleTap();
            particlePool.emitBurst(tempOrigin.set(bx, 0.05, bz), 14, 1.9, 1.3, 0x294c34);
          });
        }

        // Player follows just behind ball facing motion tangent
        const tangentX = Math.cos(u * Math.PI * 1.45) * -1.4;
        const headingYaw = Math.atan2(-tangentX * 0.35, 1.0);
        player.root.position.set(bx + tangentX * 0.04, 0, bz + 0.52);
        player.root.rotation.y = headingYaw * 0.55;
        player.applyPose({
          strideCycle: (t - 5.45) * 12.5,
          strideWeight: 0.96,
          prepareAmount: 0,
          kickWindup: 0,
          kickStrike: 0,
          torsoLeanForward: 0.22,
          torsoTwist: -tangentX * 0.14,
        });

        // Camera: low turf chase -> fast side tracking broadcast shot
        if (t < 6.45) {
          const cu = smoothstep(5.45, 6.45, t);
          camPos.set(
            bx + THREE.MathUtils.lerp(1.45, 2.35, cu),
            THREE.MathUtils.lerp(0.38, 0.78, cu),
            bz + THREE.MathUtils.lerp(2.35, 1.45, cu)
          );
          camTarget.set(bx, 0.34, bz - 1.3);
          targetFov = 51 + mobileAspectExtra;
        } else {
          const cu = smoothstep(6.45, 7.45, t);
          camPos.set(
            bx + THREE.MathUtils.lerp(3.2, 4.1, cu),
            THREE.MathUtils.lerp(0.95, 1.32, cu),
            bz - THREE.MathUtils.lerp(0.5, 1.8, cu)
          );
          camTarget.set(bx, 0.65, bz - 1.9);
          targetFov = 48 + mobileAspectExtra;
        }
      }
      // -------------------------------------------------------------
      // SCENE 05 — THE POWERFUL GOAL (7.45 -> 9.25)
      // -------------------------------------------------------------
      else if (t < 9.25) {
        const impactT = 8.32;
        const kickT = 7.72;

        if (t < kickT) {
          // Wind-up stride into strike
          const wu = smoothstep(7.45, kickT, t);
          const bx = THREE.MathUtils.lerp(0.35, 0.38, wu);
          const bz = THREE.MathUtils.lerp(-8.95, -9.25, wu);
          ball.group.position.set(bx, BALL_RADIUS, bz);
          ball.updateGroundRoll(bx - prevBallPos.x, bz - prevBallPos.z);
          prevBallPos.copy(ball.group.position);

          player.root.position.set(bx - 0.18, 0, bz + 0.42);
          player.root.rotation.y = -0.14;
          player.applyPose({
            strideCycle: 0,
            strideWeight: 0,
            prepareAmount: 0.25,
            kickWindup: wu,
            kickStrike: 0,
            torsoLeanForward: 0.08,
            torsoTwist: -0.3 * wu,
          });

          camPos.set(-1.35, 0.92, bz + 1.85);
          camTarget.set(0.55, 0.72, -13.5);
          targetFov = 44 + mobileAspectExtra;
        } else if (t < impactT) {
          // Explosive strike -> top-right corner flight
          const su = smoothstep(kickT, kickT + 0.14, t);
          const fu = (t - kickT) / (impactT - kickT);

          if (activeRef.current) {
            triggerCueOnce('kickStrike', () => {
              audioRef.current?.playKickStrike();
              particlePool.emitBurst(tempOrigin.set(0.38, 0.08, -9.25), 24, 3.2, 2.2, 0x2e583b);
            });
          }

          player.root.position.set(0.2, 0, -8.83);
          player.root.rotation.y = -0.1;
          player.applyPose({
            strideCycle: 0,
            strideWeight: 0,
            prepareAmount: 0,
            kickWindup: Math.max(0, 1 - su * 1.4),
            kickStrike: su,
            torsoLeanForward: 0.05,
            torsoTwist: su * 0.45,
          });

          // Ball top-corner rocket trajectory
          const startX = 0.38;
          const endX = 1.38;
          const startZ = -9.25;
          const endZ = STADIUM_CONSTANTS.GOAL_Z_NORTH - 0.72;
          const bx = THREE.MathUtils.lerp(startX, endX, fu) + Math.sin(fu * Math.PI) * 0.16;
          const bz = THREE.MathUtils.lerp(startZ, endZ, fu);
          const by = BALL_RADIUS + Math.sin(fu * Math.PI * 0.62) * 1.42;

          ball.group.position.set(bx, by, bz);
          ball.addAirSpin(-dt * 22, -dt * 9, dt * 6);
          prevBallPos.copy(ball.group.position);

          // Whip-track camera behind rising shot
          lerpVec(camPos, -1.1, 0.9, -8.4, 0.35, 1.32, -12.6, smoothstep(0, 1, fu));
          camTarget.set(bx * 0.75, Math.max(0.65, by * 0.85), -15.6);
          targetFov = THREE.MathUtils.lerp(45, 40, fu) + mobileAspectExtra;
        } else {
          // Slow-motion net impact & celebration glide
          const age = t - impactT;
          if (activeRef.current) {
            triggerCueOnce('goalImpact', () => {
              audioRef.current?.playGoalImpact();
              particlePool.emitBurst(tempOrigin.set(1.38, 1.35, STADIUM_CONSTANTS.GOAL_Z_NORTH - 0.5), 20, 2.2, 1.5, 0xe8f2ff);
            });
          }

          // Stadium flash + net wave deformation (slow-mo feel via 0.65x time dilation)
          const flash = Math.exp(-age * 7.5);
          stadium.setFlashBoost(flash * 1.15);
          flashOpacity = flash * 0.24;
          stadium.updateNorthNetDeformation(1.38, 1.38, age * 0.65);

          // Ball settles inside net
          const dropU = smoothstep(0, 0.58, age);
          const settleY = THREE.MathUtils.lerp(1.42, BALL_RADIUS, dropU * dropU);
          const settleZ = THREE.MathUtils.lerp(
            STADIUM_CONSTANTS.GOAL_Z_NORTH - 0.78,
            STADIUM_CONSTANTS.GOAL_Z_NORTH - 0.48,
            dropU
          );
          ball.group.position.set(1.38 - dropU * 0.08, settleY, settleZ);
          ball.addAirSpin(dt * 4 * (1 - dropU), dt * 2 * (1 - dropU), 0);

          // Micro camera shake during first 0.28s of net impact
          const shakeAmp = Math.max(0, 0.08 * (1 - age / 0.28));
          const sx = Math.sin(age * 68) * shakeAmp;
          const sy = Math.cos(age * 54) * shakeAmp;

          // Transition camera push upward/backward framing goal into logo stage
          const cu = smoothstep(0, 0.93, age);
          lerpVec(camPos, 0.42 + sx, 1.32 + sy, -12.4, 0.0, 2.35, 3.8, cu);
          lerpVec(camTarget, 1.1, 1.25, -15.6, 0.0, 1.55, 0.0, cu);
          targetFov = THREE.MathUtils.lerp(40, 45, cu) + mobileAspectExtra;
        }
      }
      // -------------------------------------------------------------
      // SCENE 06 — THE GRID LOGO REVEAL (9.25 -> 10.65)
      // -------------------------------------------------------------
      else if (t < 10.65) {
        const u = smoothstep(9.25, 10.65, t);
        player.root.visible = false;
        stadium.setFlashBoost(0);
        stadium.setCenterFocusPower(smoothstep(0, 0.45, u) * 1.15);

        if (t > 9.32 && activeRef.current) {
          triggerCueOnce('logoChord', () => audioRef.current?.playLogoReveal());
        }

        // 3D Logo Badge enters sharply under converging floodlights
        const badgeReveal = smoothstep(0.05, 0.5, u);
        logoBadge.setReveal(badgeReveal, Math.sin(u * Math.PI) * 0.7);
        logoBadge.group.position.set(
          0,
          THREE.MathUtils.lerp(1.45, 2.15, badgeReveal),
          0.4
        );
        logoBadge.group.rotation.y = THREE.MathUtils.lerp(0.55, 0, smoothstep(0.05, 0.62, u));
        logoBadge.group.scale.setScalar(THREE.MathUtils.lerp(0.84, 1.0, badgeReveal));

        // Hero football rolls cleanly onto turf foreground from left to resting spot
        const rollU = smoothstep(0.18, 0.96, u);
        const easedRoll = 1 - Math.pow(1 - rollU, 2.6);
        const bx = THREE.MathUtils.lerp(-4.2, -1.18, easedRoll);
        const bz = THREE.MathUtils.lerp(3.2, 2.45, easedRoll);
        ball.group.position.set(bx, BALL_RADIUS, bz);
        ball.updateGroundRoll(bx - prevBallPos.x, bz - prevBallPos.z);
        prevBallPos.copy(ball.group.position);

        lerpVec(camPos, 0, 2.15, 5.2, 0, 2.35, 6.2, u);
        camTarget.set(0, 1.75, 0.2);
        targetFov = 45 + mobileAspectExtra;
      }
      // -------------------------------------------------------------
      // SCENE 07 — BRAND TITLE & FINAL STADIUM SHOT (10.65 -> 11.80)
      // -------------------------------------------------------------
      else if (t < TOTAL_INTRO_DURATION) {
        const u = smoothstep(10.65, TOTAL_INTRO_DURATION, t);
        player.root.visible = false;
        stadium.setFlashBoost(0);
        stadium.setCenterFocusPower(THREE.MathUtils.lerp(1.15, 0.45, u));

        // Seamless cross-handoff from 3D badge -> razor-sharp DOM hero lockup
        logoBadge.setReveal(1 - smoothstep(0.12, 0.68, u), 0.25 * (1 - u));
        logoBadge.group.position.set(0, 2.15 + u * 0.2, 0.4);
        logoBadge.group.rotation.y = 0;

        // Football rests cleanly near center-left foreground
        ball.group.position.set(-1.18, BALL_RADIUS, 2.45);

        // Majestic pullback revealing entire lit stadium behind hero branding
        lerpVec(camPos, 0, 2.35, 6.2, 0, 3.6, 10.6, u);
        lerpVec(camTarget, 0, 1.75, 0.2, 0, 1.4, -3.5, u);
        targetFov = THREE.MathUtils.lerp(45, 48, u) + mobileAspectExtra;
      }
      // -------------------------------------------------------------
      // SCENE 08 — LIVE ILLUMINATED STADIUM BACKDROP (11.80+)
      // -------------------------------------------------------------
      else {
        player.root.visible = false;
        logoBadge.setReveal(0, 0);
        stadium.setFlashBoost(0);
        stadium.setCenterFocusPower(0.32);
        ball.group.position.set(-1.18, BALL_RADIUS, 2.45);

        const idleSway = Math.sin(nowMs * 0.00032);
        const px = pointerParallaxRef.current.x * 0.55;
        const py = pointerParallaxRef.current.y * 0.25;
        camPos.set(idleSway * 0.65 + px, 3.6 - py, 10.6);
        camTarget.set(px * 0.35, 1.4, -3.5);
        targetFov = 48 + mobileAspectExtra;
      }

      // Sync camera FOV cleanly
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }
      camera.position.copy(camPos);
      camera.lookAt(camTarget);

      // Update ball ground shadow & particle pool physics
      ball.updateShadowHeight(ball.group.position.y);
      particlePool.update(Math.min(0.05, dt));

      // Apply light-weight scrim/flash opacities directly on refs (zero React re-render)
      if (darkVeilRef.current) {
        darkVeilRef.current.style.opacity = darkVeilOpacity.toFixed(3);
      }
      if (flashVeilRef.current) {
        flashVeilRef.current.style.opacity = flashOpacity.toFixed(3);
      }

      // Compute seamless DOM hero title blend during Scene 07 -> 08
      const domBlend =
        t >= TOTAL_INTRO_DURATION
          ? 1
          : t < 10.72
          ? 0
          : smoothstep(10.72, 11.55, t);
      if (Math.abs(domBlend - lastDomBlend) > 0.01) {
        lastDomBlend = domBlend;
        callbacksRef.current.onDomHeroBlendChange(domBlend);
      }

      // Emit scene chapter transitions cleanly
      const nextPhase = getPhaseForTime(t);
      if (nextPhase !== lastReportedPhase) {
        lastReportedPhase = nextPhase;
        setCurrentPhase(nextPhase);
        callbacksRef.current.onPhaseChange(nextPhase);
      }

      if (t >= TOTAL_INTRO_DURATION && !completedEmittedRef.current) {
        completedEmittedRef.current = true;
        audioRef.current?.fadeOutBed(1.5);
        callbacksRef.current.onComplete();
      }
    };

    // Perform immediate initial frame draw so there is zero blank flash
    applyTimelineFrame(timelineTimeRef.current, 0.016, performance.now());
    renderer.render(scene, camera);
    setSceneReady(true);

    const scheduleNext = () => {
      if (!contextActive) return;
      if (isSoftwareGl) {
        paceTimerId = window.setTimeout(() => {
          if (contextActive) rafId = window.requestAnimationFrame(tick);
        }, 0);
      } else {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const tick = (now: number) => {
      if (!contextActive || !renderer) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
      lastTick = now;

      if (activeRef.current && !reducedRef.current && timelineTimeRef.current < TOTAL_INTRO_DURATION) {
        timelineTimeRef.current = Math.min(TOTAL_INTRO_DURATION, timelineTimeRef.current + dt);
      }

      applyTimelineFrame(timelineTimeRef.current, dt, now);
      renderer.render(scene, camera);

      // Update slim progress bar ~15fps max to avoid React overhead
      if (timelineTimeRef.current < TOTAL_INTRO_DURATION && now - lastUiSync > 65) {
        lastUiSync = now;
        setProgressRatio(clamp01(timelineTimeRef.current / TOTAL_INTRO_DURATION));
      }

      scheduleNext();
    };

    scheduleNext();

    return () => {
      contextActive = false;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (paceTimerId) window.clearTimeout(paceTimerId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      domEl.removeEventListener('webglcontextlost', onContextLost);
      domEl.removeEventListener('webglcontextrestored', onContextRestored);

      // Exhaustive Three.js resource disposal
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            for (const m of mesh.material) m.dispose();
          } else {
            mesh.material.dispose();
          }
        }
      });
      textures.dispose();
      logoBadge.dispose();
      envTarget.dispose();
      scene.clear();

      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  if (webglUnavailable) {
    return null;
  }

  const isPlayingIntro = currentPhase !== 'ready' && active && !reducedMotion;

  return (
    <>
      {/* Full-viewport Three.js WebGL Mount */}
      <div
        ref={mountRef}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Initial Dark Stadium Reveal Veil & Goal Impact Light Pulse */}
      <div
        ref={darkVeilRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[#03050c] z-[4]"
        style={{ opacity: isPlayingIntro ? 1 : 0 }}
      />
      <div
        ref={flashVeilRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-white z-[5]"
        style={{ opacity: 0 }}
      />

      {/* Clean initialization shimmer before first WebGL frame */}
      {!sceneReady && isPlayingIntro && (
        <div
          aria-live="polite"
          className="fixed inset-0 z-40 bg-[#040711] flex items-center justify-center"
        >
          <p className="text-xs font-semibold tracking-[0.22em] uppercase text-slate-400">
            Entering Stadium
          </p>
        </div>
      )}

      {/* Persistent Accessible Intro Controls (No backdrop-blur over WebGL) */}
      {isPlayingIntro && (
        <div className="fixed inset-x-0 bottom-5 sm:bottom-7 z-50 px-4 sm:px-6 flex items-end justify-between gap-4 pointer-events-none">
          {/* Scene Chapter Indicator & Timeline Bar */}
          <div className="hidden sm:flex flex-col gap-1.5 min-w-[200px] max-w-xs bg-[#070A14]/88 border border-white/10 rounded-md px-3.5 py-2.5">
            <span className="text-[11px] font-semibold tracking-[0.16em] uppercase text-[#c4d835]">
              {SCENE_CHAPTER_LABELS[currentPhase]}
            </span>
            <div className="h-[2px] w-full bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#c4d835] transition-[width] duration-75"
                style={{ width: `${Math.round(progressRatio * 100)}%` }}
              />
            </div>
          </div>

          {/* Sound Toggle & Skip Intro Buttons (>=44px touch targets) */}
          <div className="ml-auto flex items-center gap-2.5 pointer-events-auto">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleAudio(!audioEnabled);
              }}
              aria-pressed={audioEnabled}
              aria-label={audioEnabled ? 'Mute stadium sound' : 'Enable stadium sound'}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] text-xs font-semibold uppercase tracking-wider text-slate-200 bg-[#0E1428]/95 hover:bg-[#182246] border border-white/20 rounded-md shadow-[0_10px_28px_rgba(4,8,24,0.75)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
            >
              {audioEnabled ? (
                <Volume2 className="w-4 h-4 text-[#c4d835]" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400" />
              )}
              <span>{audioEnabled ? 'Sound On' : 'Sound Off'}</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSkip();
              }}
              aria-label="Skip 3D stadium intro and go to homepage"
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-bold uppercase tracking-wider text-white bg-[#0E1428]/95 hover:bg-[#c4d835] hover:text-[#070A14] border border-[#c4d835]/75 rounded-md shadow-[0_12px_30px_rgba(4,8,24,0.8)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span>Skip Intro</span>
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
