import * as THREE from 'three';
import { BRAND } from '@/src/config/brand';

export interface LogoBadgeRig {
  group: THREE.Group;
  setReveal: (alpha: number, glow: number) => void;
  dispose: () => void;
}

function createRoundedSquareShape(size: number, radius: number): THREE.Shape {
  const half = size / 2;
  const r = Math.min(radius, half * 0.45);
  const s = new THREE.Shape();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.quadraticCurveTo(half, -half, half, -half + r);
  s.lineTo(half, half - r);
  s.quadraticCurveTo(half, half, half - r, half);
  s.lineTo(-half + r, half);
  s.quadraticCurveTo(-half, half, -half, half - r);
  s.lineTo(-half, -half + r);
  s.quadraticCurveTo(-half, -half, -half + r, -half);
  return s;
}

export function buildLogoBadge3D(): LogoBadgeRig {
  const group = new THREE.Group();
  group.visible = false;

  // Precision beveled outer frame
  const outerShape = createRoundedSquareShape(1.56, 0.2);
  const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.032,
    bevelSegments: 4,
  });
  frameGeo.center();

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x16225a,
    metalness: 0.68,
    roughness: 0.28,
    transparent: true,
    opacity: 0,
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.castShadow = true;
  group.add(frameMesh);

  // Lime rim border inlay
  const rimShape = createRoundedSquareShape(1.42, 0.17);
  const hole = createRoundedSquareShape(1.34, 0.15);
  rimShape.holes.push(hole);
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
    depth: 0.025,
    bevelEnabled: false,
  });
  rimGeo.center();
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc4d835,
    emissive: new THREE.Color(0xc4d835),
    emissiveIntensity: 0.45,
    metalness: 0.4,
    roughness: 0.25,
    transparent: true,
    opacity: 0,
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.position.z = 0.095;
  group.add(rimMesh);

  // Official Brand Artwork Front Face (/brand/thegrid-logo.png)
  const faceGeo = new THREE.PlaneGeometry(1.34, 1.34);
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x22308f,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.15,
    roughness: 0.35,
    metalness: 0.1,
    transparent: true,
    opacity: 0,
  });
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.position.z = 0.106;
  group.add(faceMesh);

  const loader = new THREE.TextureLoader();
  let loadedTex: THREE.Texture | null = null;
  let disposed = false;

  loader.load(
    BRAND.logoUrl,
    (tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      loadedTex = tex;
      faceMat.color.setHex(0xffffff);
      faceMat.map = tex;
      faceMat.emissiveMap = tex;
      faceMat.needsUpdate = true;
    },
    undefined,
    () => {
      // Keep clean #22308F fallback color if logo load fails offline
    }
  );

  return {
    group,
    setReveal: (alpha, glow) => {
      const clamped = THREE.MathUtils.clamp(alpha, 0, 1);
      group.visible = clamped > 0.005;
      frameMat.opacity = clamped;
      rimMat.opacity = clamped;
      faceMat.opacity = clamped;
      rimMat.emissiveIntensity = 0.35 + glow * 0.9;
      faceMat.emissiveIntensity = 0.1 + glow * 0.24;
    },
    dispose: () => {
      disposed = true;
      frameGeo.dispose();
      frameMat.dispose();
      rimGeo.dispose();
      rimMat.dispose();
      faceGeo.dispose();
      faceMat.dispose();
      if (loadedTex) {
        loadedTex.dispose();
        loadedTex = null;
      }
    },
  };
}
