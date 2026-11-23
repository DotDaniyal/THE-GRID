import * as THREE from 'three';
import type { IntroTextureSet } from './proceduralTextures';

export const BALL_RADIUS = 0.135;

export interface PlayerPoseInput {
  strideCycle: number;     // radians
  strideWeight: number;    // 0 = standing poised, 1 = full sprint/dribble stride
  prepareAmount: number;   // 0..1 athletic crouch ready stance
  kickWindup: number;      // 0..1 right leg windup before shot
  kickStrike: number;      // 0..1 right leg swing & follow-through
  torsoLeanForward: number;
  torsoTwist: number;
}

export interface PlayerRig {
  root: THREE.Group;
  applyPose: (pose: PlayerPoseInput) => void;
}

export interface BallRig {
  group: THREE.Group;
  mesh: THREE.Mesh;
  shadowPlane: THREE.Mesh;
  resetRotation: () => void;
  updateGroundRoll: (dx: number, dz: number) => void;
  addAirSpin: (spinX: number, spinY: number, spinZ: number) => void;
  updateShadowHeight: (ballCenterY: number) => void;
}

export interface ParticlePool {
  points: THREE.Points;
  emitBurst: (
    origin: THREE.Vector3,
    count: number,
    speed: number,
    upwardBias: number,
    colorHex: number
  ) => void;
  update: (dt: number) => void;
}

function makeCapsuleMesh(
  rTop: number,
  rBot: number,
  len: number,
  mat: THREE.Material
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 14), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildFootballPlayer(): PlayerRig {
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xc6936f,
    roughness: 0.62,
    metalness: 0.04,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x151822,
    roughness: 0.85,
  });
  const kitDarkMat = new THREE.MeshStandardMaterial({
    color: 0x0d142b,
    roughness: 0.72,
    metalness: 0.08,
  });
  const kitNavyMat = new THREE.MeshStandardMaterial({
    color: 0x22308f,
    roughness: 0.58,
    metalness: 0.14,
  });
  const accentLimeMat = new THREE.MeshStandardMaterial({
    color: 0xc4d835,
    emissive: new THREE.Color(0xc4d835),
    emissiveIntensity: 0.16,
    roughness: 0.35,
  });
  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x111522,
    roughness: 0.38,
    metalness: 0.25,
  });

  // Pelvis hub positioned ~0.92m above turf
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 0.92, 0);
  root.add(pelvis);

  const pelvisMesh = makeCapsuleMesh(0.145, 0.138, 0.17, kitDarkMat);
  pelvis.add(pelvisMesh);

  // Torso group pivoted cleanly at lower waist
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.06, 0);
  pelvis.add(torsoPivot);

  const chestMesh = makeCapsuleMesh(0.185, 0.142, 0.46, kitDarkMat);
  chestMesh.position.y = 0.24;
  chestMesh.scale.set(1.08, 1.0, 0.74);
  torsoPivot.add(chestMesh);

  // Subtle THE GRID kit trim: navy shoulders/collar + small chest badge + lime side piping
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.016, 8, 18), kitNavyMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.47, 0.01);
  torsoPivot.add(collar);

  const chestCrest = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.018), kitNavyMat);
  chestCrest.position.set(0.072, 0.34, 0.128);
  const crestMark = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.008), accentLimeMat);
  crestMark.position.set(0.072, 0.34, 0.137);
  torsoPivot.add(chestCrest, crestMark);

  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.4, 0.045), accentLimeMat);
    stripe.position.set(sx * 0.165, 0.23, 0);
    torsoPivot.add(stripe);
  }

  // Head + Neck
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.48, 0.01);
  torsoPivot.add(headPivot);

  const neck = makeCapsuleMesh(0.052, 0.062, 0.1, skinMat);
  neck.position.y = 0.04;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 16), skinMat);
  skull.scale.set(0.88, 1.08, 0.94);
  skull.position.y = 0.165;
  skull.castShadow = true;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.108, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
  hair.scale.set(0.9, 1.04, 0.96);
  hair.position.set(0, 0.178, -0.008);
  hair.rotation.x = -0.22;
  headPivot.add(neck, skull, hair);

  // Build Arms
  const createArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.215, 0.42, 0);
    torsoPivot.add(shoulder);

    const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), kitDarkMat);
    const sleeve = makeCapsuleMesh(0.052, 0.046, 0.15, kitDarkMat);
    sleeve.position.y = -0.075;
    const upperArm = makeCapsuleMesh(0.042, 0.036, 0.17, skinMat);
    upperArm.position.y = -0.19;

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    shoulder.add(shoulderJoint, sleeve, upperArm, elbow);

    const forearm = makeCapsuleMesh(0.035, 0.028, 0.24, skinMat);
    forearm.position.y = -0.12;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 10), skinMat);
    hand.scale.set(0.85, 1.25, 0.65);
    hand.position.y = -0.25;
    elbow.add(forearm, hand);

    return { shoulder, elbow };
  };

  const leftArm = createArm(-1);
  const rightArm = createArm(1);

  // Build Legs + Cleated Football Boots
  const createLeg = (side: -1 | 1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.102, -0.04, 0);
    pelvis.add(hip);

    const shorts = makeCapsuleMesh(0.088, 0.076, 0.24, kitDarkMat);
    shorts.position.y = -0.11;
    const thigh = makeCapsuleMesh(0.072, 0.058, 0.22, skinMat);
    thigh.position.y = -0.28;

    const knee = new THREE.Group();
    knee.position.set(0, -0.41, 0);
    hip.add(shorts, thigh, knee);

    const sockTopBand = makeCapsuleMesh(0.056, 0.054, 0.045, accentLimeMat);
    sockTopBand.position.y = -0.07;
    const sock = makeCapsuleMesh(0.054, 0.038, 0.34, kitDarkMat);
    sock.position.y = -0.25;

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.42, 0);
    knee.add(sockTopBand, sock, ankle);

    // Sculpted Football Boot (aligned along +Z or -Z; player faces -Z toward North Goal!)
    // Since player runs toward North Goal (-Z), toes point toward -Z!
    const bootUpper = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.074, 0.245), bootMat);
    bootUpper.position.set(0, -0.015, -0.055);
    bootUpper.castShadow = true;

    const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), bootMat);
    toeCap.scale.set(1.0, 0.72, 1.35);
    toeCap.position.set(0, -0.022, -0.175);
    toeCap.castShadow = true;

    const solePlate = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.016, 0.275), accentLimeMat);
    solePlate.position.set(0, -0.052, -0.068);

    // Subtle cleat studs
    for (const sz of [0.04, -0.04, -0.12, -0.18]) {
      for (const sx of [-0.03, 0.03]) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.016, 6), bootMat);
        stud.position.set(sx, -0.064, sz);
        ankle.add(stud);
      }
    }

    const bootSideStripe = new THREE.Mesh(new THREE.BoxGeometry(0.096, 0.016, 0.14), accentLimeMat);
    bootSideStripe.position.set(0, -0.015, -0.06);

    ankle.add(bootUpper, toeCap, solePlate, bootSideStripe);

    return { hip, knee, ankle };
  };

  const leftLeg = createLeg(-1);
  const rightLeg = createLeg(1);

  const applyPose = (pose: PlayerPoseInput) => {
    const s = pose.strideWeight;
    const ph = pose.strideCycle;
    const sinPh = Math.sin(ph);
    const cosPh = Math.cos(ph);

    // Base stride flexion (note: legs rotate +X to swing knee forward toward -Z!)
    let lHipX = sinPh * 0.58 * s;
    let rHipX = -sinPh * 0.58 * s;

    let lKneeX = -Math.max(0, -cosPh) * 0.78 * s - 0.1 * pose.prepareAmount;
    let rKneeX = -Math.max(0, cosPh) * 0.78 * s - 0.1 * pose.prepareAmount;

    // Athletic crouch preparation
    if (pose.prepareAmount > 0.01) {
      lHipX += 0.2 * pose.prepareAmount;
      rHipX += 0.12 * pose.prepareAmount;
      lKneeX -= 0.36 * pose.prepareAmount;
      rKneeX -= 0.26 * pose.prepareAmount;
    }

    // Windup & strike override for right leg (plant left foot firmly)
    const kickBlend = Math.min(1, pose.kickWindup + pose.kickStrike);
    if (kickBlend > 0.01) {
      // Plant leg stabilizes slightly forward
      lHipX = THREE.MathUtils.lerp(lHipX, 0.26, kickBlend);
      lKneeX = THREE.MathUtils.lerp(lKneeX, -0.44, kickBlend);

      // Right leg backswing (-X) then explosive whip forward (+X)
      const targetRightHip = -pose.kickWindup * 0.92 + pose.kickStrike * 1.18;
      const targetRightKnee = -pose.kickWindup * 1.15 - pose.kickStrike * 0.12;
      rHipX = THREE.MathUtils.lerp(rHipX, targetRightHip, kickBlend);
      rKneeX = THREE.MathUtils.lerp(rKneeX, targetRightKnee, kickBlend);
    }

    leftLeg.hip.rotation.x = lHipX;
    leftLeg.knee.rotation.x = lKneeX;
    leftLeg.ankle.rotation.x = -lHipX * 0.3 - 0.08 * s;

    rightLeg.hip.rotation.x = rHipX;
    rightLeg.knee.rotation.x = rKneeX;
    rightLeg.ankle.rotation.x = -rHipX * 0.28 + pose.kickStrike * 0.35;

    // Counter-balanced arms
    leftArm.shoulder.rotation.x = -rHipX * 0.72 + pose.kickWindup * 0.55 - pose.kickStrike * 0.45;
    leftArm.shoulder.rotation.z = -0.18 - pose.prepareAmount * 0.2 - kickBlend * 0.35;
    leftArm.elbow.rotation.x = 0.65 + s * 0.4;

    rightArm.shoulder.rotation.x = -lHipX * 0.72 - pose.kickWindup * 0.35 + pose.kickStrike * 0.3;
    rightArm.shoulder.rotation.z = 0.18 + pose.prepareAmount * 0.2 + kickBlend * 0.25;
    rightArm.elbow.rotation.x = 0.65 + s * 0.4;

    // Pelvis height dip on athletic crouch & stride bounce
    const bounce = Math.abs(sinPh) * 0.042 * s;
    const crouchDip = pose.prepareAmount * 0.06 + kickBlend * 0.055;
    pelvis.position.y = 0.92 - crouchDip + bounce;

    // Torso lean & natural rotational torque
    torsoPivot.rotation.x = -(pose.torsoLeanForward + s * 0.2 + pose.prepareAmount * 0.16);
    torsoPivot.rotation.y = pose.torsoTwist - sinPh * 0.12 * s + pose.kickStrike * 0.32;
    torsoPivot.rotation.z = -pose.kickWindup * 0.14 - pose.kickStrike * 0.18;
    headPivot.rotation.x = -torsoPivot.rotation.x * 0.65;
  };

  return { root, applyPose };
}

export function buildMatchFootball(textures: IntroTextureSet): BallRig {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(BALL_RADIUS, 36, 28);
  const mat = new THREE.MeshStandardMaterial({
    map: textures.ballColor,
    bumpMap: textures.ballBump,
    bumpScale: 0.009,
    roughness: 0.34,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.008;

  const rollAxis = new THREE.Vector3();
  const deltaQuat = new THREE.Quaternion();
  const spinQuat = new THREE.Quaternion();
  const spinEuler = new THREE.Euler();

  return {
    group,
    mesh,
    shadowPlane,
    resetRotation: () => {
      mesh.quaternion.identity();
    },
    updateGroundRoll: (dx: number, dz: number) => {
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-5) return;
      // Axis perpendicular to velocity (dz, 0, -dx) normalized
      rollAxis.set(dz / dist, 0, -dx / dist);
      const angle = dist / BALL_RADIUS;
      deltaQuat.setFromAxisAngle(rollAxis, angle);
      mesh.quaternion.premultiply(deltaQuat);
    },
    addAirSpin: (spinX: number, spinY: number, spinZ: number) => {
      spinEuler.set(spinX, spinY, spinZ);
      spinQuat.setFromEuler(spinEuler);
      mesh.quaternion.premultiply(spinQuat);
    },
    updateShadowHeight: (ballCenterY: number) => {
      const height = Math.max(0, ballCenterY - BALL_RADIUS);
      const fade = Math.max(0.18, Math.exp(-height * 0.95));
      shadowMat.opacity = 0.74 * fade;
      const s = 1 + height * 0.45;
      shadowPlane.scale.set(s, s, 1);
      shadowPlane.position.set(group.position.x, 0.008, group.position.z);
    },
  };
}

export function createParticlePool(
  maxParticles: number,
  spriteTex: THREE.Texture
): ParticlePool {
  const positions = new Float32Array(maxParticles * 3);
  const velocities = new Float32Array(maxParticles * 3);
  const colors = new Float32Array(maxParticles * 3);
  const ages = new Float32Array(maxParticles);
  const lifetimes = new Float32Array(maxParticles);

  for (let i = 0; i < maxParticles; i++) {
    positions[i * 3 + 1] = -999; // parked underground when inactive
    ages[i] = 1;
    lifetimes[i] = 1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.095,
    map: spriteTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  let cursor = 0;
  const tmpColor = new THREE.Color();

  return {
    points,
    emitBurst: (origin, count, speed, upwardBias, colorHex) => {
      tmpColor.setHex(colorHex);
      for (let c = 0; c < count; c++) {
        const idx = cursor;
        cursor = (cursor + 1) % maxParticles;

        const i3 = idx * 3;
        positions[i3] = origin.x + (Math.random() - 0.5) * 0.16;
        positions[i3 + 1] = Math.max(0.03, origin.y + Math.random() * 0.08);
        positions[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.16;

        const angle = Math.random() * Math.PI * 2;
        const radial = (0.35 + Math.random() * 0.85) * speed;
        velocities[i3] = Math.cos(angle) * radial;
        velocities[i3 + 1] = upwardBias * (0.6 + Math.random() * 0.8);
        velocities[i3 + 2] = Math.sin(angle) * radial;

        colors[i3] = tmpColor.r;
        colors[i3 + 1] = tmpColor.g;
        colors[i3 + 2] = tmpColor.b;

        ages[idx] = 0;
        lifetimes[idx] = 0.45 + Math.random() * 0.5;
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },
    update: (dt) => {
      let dirty = false;
      for (let i = 0; i < maxParticles; i++) {
        if (ages[i] >= lifetimes[i]) continue;
        ages[i] += dt;
        const i3 = i * 3;
        if (ages[i] >= lifetimes[i]) {
          positions[i3 + 1] = -999;
        } else {
          velocities[i3 + 1] -= 7.8 * dt; // gravity
          positions[i3] += velocities[i3] * dt;
          positions[i3 + 1] = Math.max(0.01, positions[i3 + 1] + velocities[i3 + 1] * dt);
          positions[i3 + 2] += velocities[i3 + 2] * dt;
        }
        dirty = true;
      }
      if (dirty) {
        (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    },
  };
}
