import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';

export type IntroPhase = 'dark' | 'lights' | 'ball' | 'logo' | 'ready';

interface InteractiveFootballCanvasProps {
  containerRef: RefObject<HTMLElement | null>;
  logoZoneRef: RefObject<HTMLDivElement | null>;
  introPhase: IntroPhase;
  reducedMotion: boolean;
  onFirstInteract?: () => void;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const PENTAGON_CENTERS: Vec3[] = [
  [0, 1, PHI],
  [0, -1, PHI],
  [0, 1, -PHI],
  [0, -1, -PHI],
  [1, PHI, 0],
  [-1, PHI, 0],
  [1, -PHI, 0],
  [-1, -PHI, 0],
  [PHI, 0, 1],
  [-PHI, 0, 1],
  [PHI, 0, -1],
  [-PHI, 0, -1],
].map(([x, y, z]) => {
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
});

function rotateVec3(v: Vec3, ax: number, ay: number, az: number): Vec3 {
  const y1 = v.y * Math.cos(ax) - v.z * Math.sin(ax);
  const z1 = v.y * Math.sin(ax) + v.z * Math.cos(ax);
  const x1 = v.x;
  const x2 = x1 * Math.cos(ay) + z1 * Math.sin(ay);
  const z2 = -x1 * Math.sin(ay) + z1 * Math.cos(ay);
  const y2 = y1;
  const x3 = x2 * Math.cos(az) - y2 * Math.sin(az);
  const y3 = x2 * Math.sin(az) + y2 * Math.cos(az);
  return { x: x3, y: y3, z: z2 };
}

export function InteractiveFootballCanvas({
  containerRef,
  logoZoneRef,
  introPhase,
  reducedMotion,
  onFirstInteract,
}: InteractiveFootballCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isHoveringBall, setIsHoveringBall] = useState(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [hintPos, setHintPos] = useState<{ x: number; y: number } | null>(null);

  const stateRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    restX: 0,
    restY: 0,
    radius: 34,
    rotX: 0.4,
    rotY: 0.6,
    rotZ: 0.2,
    lift: 0,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    lastPointerTime: 0,
    idleTimer: 0,
    introStarted: false,
    initialized: false,
    trail: [] as TrailPoint[],
    ripples: [] as Ripple[],
    width: 1200,
    height: 800,
  });

  const computeRestingPosition = useCallback((w: number, h: number) => {
    const isMobile = w < 768;
    const radius = isMobile ? 28 : Math.min(38, Math.max(30, w * 0.026));
    if (isMobile) {
      return {
        restX: w * 0.5,
        restY: Math.min(h - 96, h * 0.84),
        radius,
      };
    }
    return {
      restX: Math.min(w - 110, w * 0.77),
      restY: Math.min(h - 115, h * 0.71),
      radius,
    };
  }, []);

  const getProtectedBox = useCallback(() => {
    const container = containerRef.current;
    const logoEl = logoZoneRef.current;
    if (!container || !logoEl) return null;
    const cRect = container.getBoundingClientRect();
    const lRect = logoEl.getBoundingClientRect();
    const cx = lRect.left - cRect.left + lRect.width / 2;
    const cy = lRect.top - cRect.top + lRect.height / 2;
    const halfW = lRect.width / 2 + 22;
    const halfH = lRect.height / 2 + 18;
    return { cx, cy, halfW, halfH };
  }, [containerRef, logoZoneRef]);

  const enforceLogoBoundary = useCallback(
    (px: number, py: number, vx: number, vy: number, ballRadius: number, bounce = true) => {
      const box = getProtectedBox();
      if (!box) return { x: px, y: py, vx, vy, deflected: false };

      const rx = box.halfW + ballRadius;
      const ry = box.halfH + ballRadius;
      const dx = px - box.cx;
      const dy = py - box.cy;
      const nx = dx / rx;
      const ny = dy / ry;
      const distSq = nx * nx + ny * ny;

      if (distSq < 1) {
        const dist = Math.sqrt(distSq) || 0.001;
        const pushNx = nx / dist;
        const pushNy = ny / dist;
        const outX = box.cx + pushNx * rx * 1.01;
        const outY = box.cy + pushNy * ry * 1.01;

        if (bounce) {
          const gx = (outX - box.cx) / (rx * rx);
          const gy = (outY - box.cy) / (ry * ry);
          const gLen = Math.hypot(gx, gy) || 1;
          const nVecX = gx / gLen;
          const nVecY = gy / gLen;
          const dot = vx * nVecX + vy * nVecY;
          if (dot < 0) {
            return {
              x: outX,
              y: outY,
              vx: (vx - 1.8 * dot * nVecX) * 0.85,
              vy: (vy - 1.8 * dot * nVecY) * 0.85,
              deflected: true,
            };
          }
        }
        return { x: outX, y: outY, vx, vy, deflected: true };
      }

      return { x: px, y: py, vx, vy, deflected: false };
    },
    [getProtectedBox]
  );

  const triggerControlledKick = useCallback(() => {
    const s = stateRef.current;
    setHasInteracted(true);
    onFirstInteract?.();
    const angle = -Math.PI * 0.72 + (Math.random() - 0.5) * 0.5;
    const speed = 15;
    s.vx = Math.cos(angle) * speed;
    s.vy = Math.sin(angle) * speed;
    s.lift = 14;
    s.idleTimer = 0;
    s.ripples.push({ x: s.x, y: s.y, radius: s.radius, maxRadius: s.radius * 3.2, alpha: 0.55 });
  }, [onFirstInteract]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const s = stateRef.current;
      s.width = rect.width;
      s.height = rect.height;
      const pos = computeRestingPosition(rect.width, rect.height);
      s.restX = pos.restX;
      s.restY = pos.restY;
      s.radius = pos.radius;

      const cleared = enforceLogoBoundary(s.restX, s.restY, 0, 0, s.radius, false);
      s.restX = cleared.x;
      s.restY = cleared.y;

      if (!s.initialized) {
        s.x = s.restX;
        s.y = s.restY;
        s.initialized = true;
      }
      setHintPos({ x: s.restX, y: s.restY + s.radius + 16 });
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, computeRestingPosition, enforceLogoBoundary]);

  useEffect(() => {
    const s = stateRef.current;
    if (introPhase === 'ball' && !s.introStarted && !reducedMotion) {
      s.introStarted = true;
      s.x = s.width + s.radius * 2;
      s.y = s.restY - 60;
      s.vx = -14;
      s.vy = 2.4;
      s.lift = 10;
    } else if ((introPhase === 'ready' || reducedMotion) && !s.introStarted) {
      s.introStarted = true;
      s.x = s.restX;
      s.y = s.restY;
      s.vx = 0;
      s.vy = 0;
      s.lift = 0;
    }
  }, [introPhase, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();

    const drawMatchBall = (
      x: number,
      y: number,
      r: number,
      lift: number,
      rx: number,
      ry: number,
      rz: number
    ) => {
      const speed = Math.hypot(stateRef.current.vx, stateRef.current.vy);
      const glowAlpha = Math.min(0.4, 0.14 + speed * 0.015 + (stateRef.current.isDragging ? 0.12 : 0));
      const turfGlow = ctx.createRadialGradient(x, y + r * 0.6, r * 0.2, x, y + r * 0.6, r * 3.2);
      turfGlow.addColorStop(0, `rgba(196, 216, 53, ${glowAlpha})`);
      turfGlow.addColorStop(0.55, `rgba(63, 81, 181, ${glowAlpha * 0.45})`);
      turfGlow.addColorStop(1, 'rgba(7, 10, 20, 0)');
      ctx.fillStyle = turfGlow;
      ctx.beginPath();
      ctx.arc(x, y + r * 0.6, r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      const shadowScale = Math.max(0.65, 1 - lift * 0.015);
      const shadowY = y + r * 0.88 + lift * 0.55;
      const shadowGrad = ctx.createRadialGradient(
        x + 4,
        shadowY,
        r * 0.1,
        x + 4,
        shadowY,
        r * 1.15 * shadowScale
      );
      shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
      shadowGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.25)');
      shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = shadowGrad;
      ctx.save();
      ctx.translate(x + 4, shadowY);
      ctx.scale(1.18 * shadowScale, 0.42 * shadowScale);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const by = y - lift;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, by, r, 0, Math.PI * 2);
      ctx.clip();

      const baseGrad = ctx.createRadialGradient(
        x - r * 0.34,
        by - r * 0.34,
        r * 0.08,
        x,
        by,
        r * 1.05
      );
      baseGrad.addColorStop(0, '#FFFFFF');
      baseGrad.addColorStop(0.58, '#E6EAF2');
      baseGrad.addColorStop(0.86, '#9AA6C2');
      baseGrad.addColorStop(1, '#3A466B');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(x - r, by - r, r * 2, r * 2);

      PENTAGON_CENTERS.forEach((center, idx) => {
        const rotated = rotateVec3(center, rx, ry, rz);
        if (rotated.z < -0.22) return;

        const px = x + rotated.x * r * 0.92;
        const py = by + rotated.y * r * 0.92;
        const facing = Math.max(0, Math.min(1, (rotated.z + 0.22) / 1.22));
        const panelR = r * 0.31 * (0.55 + 0.45 * facing);

        ctx.save();
        ctx.translate(px, py);
        const radialAngle = Math.atan2(rotated.y, rotated.x);
        ctx.rotate(radialAngle);
        ctx.scale(Math.max(0.28, rotated.z * 0.95 + 0.15), 1);
        ctx.rotate(-radialAngle);

        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i * Math.PI * 2) / 5 + rx * 0.35;
          const vx = Math.cos(a) * panelR;
          const vy = Math.sin(a) * panelR;
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();

        if (idx % 4 === 0) {
          ctx.fillStyle = `rgba(196, 216, 53, ${0.88 * facing})`;
        } else {
          ctx.fillStyle = `rgba(26, 36, 92, ${0.94 * facing})`;
        }
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(12, 18, 46, ${0.55 * facing})`;
        ctx.stroke();
        ctx.restore();
      });

      ctx.strokeStyle = 'rgba(20, 28, 64, 0.22)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + rz * 0.4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.35, by + Math.sin(a) * r * 0.35);
        ctx.lineTo(x + Math.cos(a) * r * 1.1, by + Math.sin(a) * r * 1.1);
        ctx.stroke();
      }

      const rimGrad = ctx.createRadialGradient(
        x - r * 0.3,
        by - r * 0.3,
        r * 0.4,
        x,
        by,
        r
      );
      rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
      rimGrad.addColorStop(0.75, 'rgba(10,14,34,0.12)');
      rimGrad.addColorStop(1, 'rgba(5,8,20,0.58)');
      ctx.fillStyle = rimGrad;
      ctx.fillRect(x - r, by - r, r * 2, r * 2);

      const specGrad = ctx.createRadialGradient(
        x - r * 0.36,
        by - r * 0.38,
        1,
        x - r * 0.36,
        by - r * 0.38,
        r * 0.42
      );
      specGrad.addColorStop(0, 'rgba(255,255,255,0.75)');
      specGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = specGrad;
      ctx.fillRect(x - r, by - r, r * 2, r * 2);

      ctx.restore();

      if (stateRef.current.isDragging) {
        ctx.strokeStyle = 'rgba(196, 216, 53, 0.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, by, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;
      const step = dt * 60;
      const s = stateRef.current;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.width, s.height);

      if (introPhase !== 'dark' && introPhase !== 'lights') {
        if (!s.isDragging && !reducedMotion) {
          s.vx *= Math.pow(0.955, step);
          s.vy *= Math.pow(0.955, step);
          s.x += s.vx * step;
          s.y += s.vy * step;
          s.lift += (0 - s.lift) * 0.14 * step;

          const minX = s.radius + 16;
          const maxX = s.width - s.radius - 16;
          const minY = Math.max(76, s.radius + 20);
          const maxY = s.height - s.radius - 20;

          if (s.x < minX) {
            s.x = minX;
            s.vx = Math.abs(s.vx) * 0.72;
            s.ripples.push({ x: s.x, y: s.y, radius: s.radius * 0.6, maxRadius: s.radius * 2.2, alpha: 0.35 });
          } else if (s.x > maxX) {
            s.x = maxX;
            s.vx = -Math.abs(s.vx) * 0.72;
            s.ripples.push({ x: s.x, y: s.y, radius: s.radius * 0.6, maxRadius: s.radius * 2.2, alpha: 0.35 });
          }

          if (s.y < minY) {
            s.y = minY;
            s.vy = Math.abs(s.vy) * 0.72;
            s.ripples.push({ x: s.x, y: s.y, radius: s.radius * 0.6, maxRadius: s.radius * 2.2, alpha: 0.35 });
          } else if (s.y > maxY) {
            s.y = maxY;
            s.vy = -Math.abs(s.vy) * 0.72;
            s.ripples.push({ x: s.x, y: s.y, radius: s.radius * 0.6, maxRadius: s.radius * 2.2, alpha: 0.35 });
          }

          const bounded = enforceLogoBoundary(s.x, s.y, s.vx, s.vy, s.radius, true);
          if (bounded.deflected) {
            s.x = bounded.x;
            s.y = bounded.y;
            s.vx = bounded.vx;
            s.vy = bounded.vy;
            s.ripples.push({ x: s.x, y: s.y, radius: s.radius * 0.7, maxRadius: s.radius * 2.6, alpha: 0.45 });
          }

          const speed = Math.hypot(s.vx, s.vy);
          if (speed < 0.75) {
            s.idleTimer += dt;
            if (s.idleTimer > 0.45) {
              const dx = s.restX - s.x;
              const dy = s.restY - s.y;
              const dist = Math.hypot(dx, dy);
              if (dist > 1.2) {
                s.vx += dx * 0.012 * step;
                s.vy += dy * 0.012 * step;
                s.vx *= Math.pow(0.84, step);
                s.vy *= Math.pow(0.84, step);
              } else {
                s.x = s.restX;
                s.y = s.restY;
                s.vx = 0;
                s.vy = 0;
              }
            }
          } else {
            s.idleTimer = 0;
          }
        } else if (s.isDragging) {
          s.lift += (12 - s.lift) * 0.25 * step;
          s.idleTimer = 0;
        }

        const spinFactor = 1 / Math.max(18, s.radius);
        s.rotY += s.vx * spinFactor * step;
        s.rotX -= s.vy * spinFactor * step;
        s.rotZ += (s.vx - s.vy) * 0.004 * step;

        const currSpeed = Math.hypot(s.vx, s.vy);
        if (!reducedMotion && (currSpeed > 2.2 || s.isDragging)) {
          s.trail.push({ x: s.x, y: s.y - s.lift, age: 0 });
          if (s.trail.length > 18) s.trail.shift();
        }
        s.trail.forEach((pt) => {
          pt.age += dt;
        });
        s.trail = s.trail.filter((pt) => pt.age < 0.35);

        if (s.trail.length > 1) {
          for (let i = 1; i < s.trail.length; i++) {
            const p0 = s.trail[i - 1];
            const p1 = s.trail[i];
            const t = i / s.trail.length;
            const alpha = (1 - p1.age / 0.35) * t * 0.38;
            ctx.strokeStyle = `rgba(196, 216, 53, ${alpha})`;
            ctx.lineWidth = s.radius * 0.65 * t;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
        }

        s.ripples.forEach((rip) => {
          rip.radius += (rip.maxRadius - rip.radius) * 0.14 * step;
          rip.alpha *= Math.pow(0.9, step);
          if (rip.alpha > 0.02) {
            ctx.strokeStyle = `rgba(196, 216, 53, ${rip.alpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(rip.x, rip.y + s.radius * 0.6, rip.radius, rip.radius * 0.45, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
        s.ripples = s.ripples.filter((r) => r.alpha > 0.02);

        drawMatchBall(s.x, s.y, s.radius, s.lift, s.rotX, s.rotY, s.rotZ);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [introPhase, reducedMotion, enforceLogoBoundary]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getLocalPos = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const isNearBall = (px: number, py: number, extra = 18) => {
      const s = stateRef.current;
      return Math.hypot(px - s.x, py - (s.y - s.lift)) <= s.radius + extra;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (introPhase === 'dark' || introPhase === 'lights') return;
      const pos = getLocalPos(e.clientX, e.clientY);
      if (!isNearBall(pos.x, pos.y, 24)) return;

      e.preventDefault();
      const s = stateRef.current;
      s.isDragging = true;
      s.dragOffsetX = s.x - pos.x;
      s.dragOffsetY = s.y - pos.y;
      s.lastPointerX = pos.x;
      s.lastPointerY = pos.y;
      s.lastPointerTime = performance.now();
      s.vx = 0;
      s.vy = 0;
      s.ripples.push({ x: s.x, y: s.y, radius: s.radius, maxRadius: s.radius * 2.4, alpha: 0.45 });

      setIsDraggingState(true);
      setHasInteracted(true);
      onFirstInteract?.();
    };

    const onPointerMove = (e: PointerEvent) => {
      const pos = getLocalPos(e.clientX, e.clientY);
      const s = stateRef.current;

      if (!s.isDragging) {
        const hover = isNearBall(pos.x, pos.y, 12);
        setIsHoveringBall((prev) => (prev !== hover ? hover : prev));
        return;
      }

      e.preventDefault();
      const now = performance.now();
      const dt = Math.max(8, now - s.lastPointerTime);

      const targetX = Math.max(s.radius + 16, Math.min(s.width - s.radius - 16, pos.x + s.dragOffsetX));
      const targetY = Math.max(76, Math.min(s.height - s.radius - 20, pos.y + s.dragOffsetY));

      const cleared = enforceLogoBoundary(targetX, targetY, 0, 0, s.radius, false);

      const rawVx = ((cleared.x - s.x) / dt) * 16;
      const rawVy = ((cleared.y - s.y) / dt) * 16;
      s.vx = s.vx * 0.45 + Math.max(-28, Math.min(28, rawVx)) * 0.55;
      s.vy = s.vy * 0.45 + Math.max(-28, Math.min(28, rawVy)) * 0.55;

      s.x = cleared.x;
      s.y = cleared.y;
      s.lastPointerX = pos.x;
      s.lastPointerY = pos.y;
      s.lastPointerTime = now;
    };

    const onPointerUp = () => {
      const s = stateRef.current;
      if (!s.isDragging) return;
      s.isDragging = false;
      setIsDraggingState(false);
    };

    container.addEventListener('pointerdown', onPointerDown, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [containerRef, introPhase, enforceLogoBoundary, onFirstInteract]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute inset-0 z-20 w-full h-full pointer-events-none ${
          isDraggingState ? 'cursor-grabbing' : isHoveringBall ? 'cursor-grab' : ''
        }`}
      />
      {hintPos && introPhase === 'ready' && (
        <div
          style={{ left: `${hintPos.x}px`, top: `${hintPos.y}px` }}
          className="absolute z-20 -translate-x-1/2 pointer-events-auto flex flex-col items-center"
        >
          <button
            type="button"
            onClick={triggerControlledKick}
            aria-label="Kick or drag interactive futsal ball"
            className={`px-3 py-1 min-h-[32px] text-[11px] font-medium tracking-wider uppercase rounded transition-opacity duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] ${
              hasInteracted
                ? 'opacity-0 pointer-events-none'
                : 'text-slate-300/85 hover:text-[#c4d835] bg-[#070A14]/85 border border-white/10'
            }`}
          >
            Drag or Kick Ball
          </button>
        </div>
      )}
    </>
  );
}
