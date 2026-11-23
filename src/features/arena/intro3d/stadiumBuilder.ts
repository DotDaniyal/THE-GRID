import * as THREE from 'three';
import type { IntroTextureSet } from './proceduralTextures';

export const STADIUM_CONSTANTS = {
  PITCH_WIDTH: 22.8,
  PITCH_LENGTH: 34.4,
  GOAL_Z_NORTH: -15.35,
  GOAL_Z_SOUTH: 15.35,
  GOAL_WIDTH: 3.9,
  GOAL_HEIGHT: 2.15,
  GOAL_DEPTH: 1.25,
} as const;

interface FloodlightUnit {
  spotLight: THREE.SpotLight;
  emissiveMat: THREE.MeshStandardMaterial;
  beamMat: THREE.ShaderMaterial;
  beaconMat: THREE.MeshBasicMaterial;
  power: number;
}

export interface StadiumRig {
  group: THREE.Group;
  ambientLight: THREE.AmbientLight;
  hemiLight: THREE.HemisphereLight;
  keyShadowLight: THREE.DirectionalLight;
  ledMat: THREE.MeshStandardMaterial;
  centerFocusSpot: THREE.SpotLight;
  centerFocusBeamMat: THREE.ShaderMaterial;
  setTowerPowers: (powers: [number, number, number, number]) => void;
  setCenterFocusPower: (power: number) => void;
  setFlashBoost: (boost: number) => void;
  updateNorthNetDeformation: (
    impactLocalX: number,
    impactLocalY: number,
    impactAgeSec: number
  ) => void;
  resetNorthNet: () => void;
}

function createVolumetricBeamMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        vec3 viewDir = normalize(vViewPos);
        // Smooth Fresnel falloff so cylinder/cone edges dissolve softly
        float edge = pow(abs(dot(normalize(vNormalView), viewDir)), 1.75);
        // Vertical falloff: vUv.y == 1 at floodlight head, 0 near turf
        float topFade = smoothstep(1.0, 0.86, vUv.y);
        float bottomFade = pow(clamp(vUv.y, 0.0, 1.0), 1.45);
        float alpha = edge * topFade * bottomFade * uIntensity * 0.24;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}

interface DeformableNetData {
  geometry: THREE.BufferGeometry;
  restPos: Float32Array;
  width: number;
  height: number;
  depth: number;
}

function buildDeformableNorthNet(): { mesh: THREE.LineSegments; data: DeformableNetData } {
  const w = STADIUM_CONSTANTS.GOAL_WIDTH;
  const h = STADIUM_CONSTANTS.GOAL_HEIGHT;
  const d = STADIUM_CONSTANTS.GOAL_DEPTH;

  const cols = 22;
  const rows = 12;
  const depthSegs = 8;

  const positions: number[] = [];

  const pushSeg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    positions.push(x1, y1, z1, x2, y2, z2);
  };

  // Back wall (z = -d, x: -w/2..+w/2, y: 0..h)
  for (let iy = 0; iy <= rows; iy++) {
    const y = (iy / rows) * h;
    for (let ix = 0; ix < cols; ix++) {
      const x1 = -w / 2 + (ix / cols) * w;
      const x2 = -w / 2 + ((ix + 1) / cols) * w;
      pushSeg(x1, y, -d, x2, y, -d);
    }
  }
  for (let ix = 0; ix <= cols; ix++) {
    const x = -w / 2 + (ix / cols) * w;
    for (let iy = 0; iy < rows; iy++) {
      const y1 = (iy / rows) * h;
      const y2 = ((iy + 1) / rows) * h;
      pushSeg(x, y1, -d, x, y2, -d);
    }
  }

  // Top roof net (y = h, z: 0..-d)
  for (let iz = 0; iz <= depthSegs; iz++) {
    const z = -(iz / depthSegs) * d;
    for (let ix = 0; ix < cols; ix++) {
      const x1 = -w / 2 + (ix / cols) * w;
      const x2 = -w / 2 + ((ix + 1) / cols) * w;
      pushSeg(x1, h, z, x2, h, z);
    }
  }
  for (let ix = 0; ix <= cols; ix++) {
    const x = -w / 2 + (ix / cols) * w;
    for (let iz = 0; iz < depthSegs; iz++) {
      const z1 = -(iz / depthSegs) * d;
      const z2 = -((iz + 1) / depthSegs) * d;
      pushSeg(x, h, z1, x, h, z2);
    }
  }

  // Left & Right side nets (x = -w/2 and +w/2)
  for (const sideX of [-w / 2, w / 2]) {
    for (let iy = 0; iy <= rows; iy++) {
      const y = (iy / rows) * h;
      for (let iz = 0; iz < depthSegs; iz++) {
        const z1 = -(iz / depthSegs) * d;
        const z2 = -((iz + 1) / depthSegs) * d;
        pushSeg(sideX, y, z1, sideX, y, z2);
      }
    }
    for (let iz = 0; iz <= depthSegs; iz++) {
      const z = -(iz / depthSegs) * d;
      for (let iy = 0; iy < rows; iy++) {
        const y1 = (iy / rows) * h;
        const y2 = ((iy + 1) / rows) * h;
        pushSeg(sideX, y1, z, sideX, y2, z);
      }
    }
  }

  const posArray = new Float32Array(positions);
  const restPos = new Float32Array(posArray);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0xe6eef8,
    transparent: true,
    opacity: 0.62,
  });

  const mesh = new THREE.LineSegments(geometry, material);
  mesh.position.set(0, 0, STADIUM_CONSTANTS.GOAL_Z_NORTH);
  return { mesh, data: { geometry, restPos, width: w, height: h, depth: d } };
}

function buildStaticGoalFrame(zPos: number, facingSign: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const w = STADIUM_CONSTANTS.GOAL_WIDTH;
  const h = STADIUM_CONSTANTS.GOAL_HEIGHT;
  const d = STADIUM_CONSTANTS.GOAL_DEPTH * facingSign;

  const postMat = new THREE.MeshStandardMaterial({
    color: 0xf0f4f8,
    metalness: 0.45,
    roughness: 0.25,
  });
  const backBarMat = new THREE.MeshStandardMaterial({
    color: 0x3b4866,
    metalness: 0.72,
    roughness: 0.35,
  });

  const radius = 0.055;
  const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 16), postMat);
  leftPost.position.set(-w / 2, h / 2, 0);
  leftPost.castShadow = true;

  const rightPost = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 16), postMat);
  rightPost.position.set(w / 2, h / 2, 0);
  rightPost.castShadow = true;

  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, w + radius * 2, 16), postMat);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.set(0, h, 0);
  crossbar.castShadow = true;

  // Ground rear frame & top support arms
  const rearGround = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, w, 12), backBarMat);
  rearGround.rotation.z = Math.PI / 2;
  rearGround.position.set(0, 0.032, d);

  const rearTop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, w, 12), backBarMat);
  rearTop.rotation.z = Math.PI / 2;
  rearTop.position.set(0, h, d);

  for (const sx of [-w / 2, w / 2]) {
    const topArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, Math.abs(d), 10),
      backBarMat
    );
    topArm.rotation.x = Math.PI / 2;
    topArm.position.set(sx, h, d * 0.5);

    const botArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, Math.abs(d), 10),
      backBarMat
    );
    botArm.rotation.x = Math.PI / 2;
    botArm.position.set(sx, 0.032, d * 0.5);

    const rearStanchion = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, h, 10),
      backBarMat
    );
    rearStanchion.position.set(sx, h / 2, d);

    g.add(topArm, botArm, rearStanchion);
  }

  g.add(leftPost, rightPost, crossbar, rearGround, rearTop);
  g.position.set(0, 0, zPos);
  return g;
}

export function buildStadium(
  textures: IntroTextureSet,
  isMobile: boolean
): StadiumRig {
  const group = new THREE.Group();

  // Ambient + Hemisphere subtle night atmosphere (low initially, swells in Scene 02)
  const ambientLight = new THREE.AmbientLight(0x162244, 0.14);
  const hemiLight = new THREE.HemisphereLight(0x283c78, 0x091118, 0.12);
  group.add(ambientLight, hemiLight);

  // Main key directional shadow light (angled high from North-West/South-East)
  const keyShadowLight = new THREE.DirectionalLight(0xeef4ff, 0.0);
  keyShadowLight.position.set(-14, 21, -12);
  keyShadowLight.castShadow = true;
  const shadowRes = isMobile ? 1024 : 2048;
  keyShadowLight.shadow.mapSize.set(shadowRes, shadowRes);
  keyShadowLight.shadow.camera.near = 2;
  keyShadowLight.shadow.camera.far = 65;
  keyShadowLight.shadow.camera.left = -22;
  keyShadowLight.shadow.camera.right = 22;
  keyShadowLight.shadow.camera.top = 24;
  keyShadowLight.shadow.camera.bottom = -24;
  keyShadowLight.shadow.bias = -0.0005;
  keyShadowLight.shadow.normalBias = 0.025;
  group.add(keyShadowLight);

  // 1. Extended Dark Ground & Stadium Apron (eliminates floating plane look)
  const outerGroundMat = new THREE.MeshStandardMaterial({
    color: 0x090d1a,
    roughness: 0.92,
    metalness: 0.08,
  });
  const outerGround = new THREE.Mesh(new THREE.PlaneGeometry(130, 150), outerGroundMat);
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.03;
  outerGround.receiveShadow = true;
  group.add(outerGround);

  // Inner concrete track / dark asphalt border around pitch
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x10172b,
    roughness: 0.85,
    metalness: 0.12,
  });
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(STADIUM_CONSTANTS.PITCH_WIDTH + 6.4, STADIUM_CONSTANTS.PITCH_LENGTH + 7.2),
    apronMat
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.015;
  apron.receiveShadow = true;
  group.add(apron);

  // 2. Pro Futsal Artificial Turf Pitch
  const turfMat = new THREE.MeshStandardMaterial({
    map: textures.turfColor,
    roughnessMap: textures.turfRoughness,
    roughness: 0.88,
    metalness: 0.02,
  });
  const pitchMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(STADIUM_CONSTANTS.PITCH_WIDTH, STADIUM_CONSTANTS.PITCH_LENGTH),
    turfMat
  );
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.position.y = 0;
  pitchMesh.receiveShadow = true;
  group.add(pitchMesh);

  // 3. Perimeter LED Touchline Boards
  const ledMat = new THREE.MeshStandardMaterial({
    map: textures.ledBoard,
    emissiveMap: textures.ledBoard,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.06,
    roughness: 0.4,
    metalness: 0.2,
  });
  const boardHeight = 0.88;
  const boardDepth = 0.16;

  const sideBoardGeo = new THREE.BoxGeometry(boardDepth, boardHeight, STADIUM_CONSTANTS.PITCH_LENGTH + 1.2);
  const westBoards = new THREE.Mesh(sideBoardGeo, ledMat);
  westBoards.position.set(-STADIUM_CONSTANTS.PITCH_WIDTH / 2 - 1.1, boardHeight / 2, 0);
  const eastBoards = new THREE.Mesh(sideBoardGeo, ledMat);
  eastBoards.position.set(STADIUM_CONSTANTS.PITCH_WIDTH / 2 + 1.1, boardHeight / 2, 0);

  const endBoardGeo = new THREE.BoxGeometry(STADIUM_CONSTANTS.PITCH_WIDTH + 2.2, boardHeight, boardDepth);
  const northBoards = new THREE.Mesh(endBoardGeo, ledMat);
  northBoards.position.set(0, boardHeight / 2, -STADIUM_CONSTANTS.PITCH_LENGTH / 2 - 1.3);
  const southBoards = new THREE.Mesh(endBoardGeo, ledMat);
  southBoards.position.set(0, boardHeight / 2, STADIUM_CONSTANTS.PITCH_LENGTH / 2 + 1.3);

  group.add(westBoards, eastBoards, northBoards, southBoards);

  // 4. Goals (North Goal with live vertex-deforming net, South Goal static + simple net)
  const northGoalFrame = buildStaticGoalFrame(STADIUM_CONSTANTS.GOAL_Z_NORTH, -1);
  const southGoalFrame = buildStaticGoalFrame(STADIUM_CONSTANTS.GOAL_Z_SOUTH, 1);
  const { mesh: northNetMesh, data: netData } = buildDeformableNorthNet();
  group.add(northGoalFrame, northNetMesh, southGoalFrame);

  // Subtle decorative South net wireframe
  const southNetCopy = new THREE.LineSegments(northNetMesh.geometry.clone(), northNetMesh.material);
  southNetCopy.scale.z = -1;
  southNetCopy.position.set(0, 0, STADIUM_CONSTANTS.GOAL_Z_SOUTH);
  group.add(southNetCopy);

  // 5. Tiered Stadium Concrete Stands + Architectural Bowl + Roof Canopy Trusses
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x131a2e,
    roughness: 0.9,
    metalness: 0.1,
  });
  const fasciaMat = new THREE.MeshStandardMaterial({
    color: 0x1b2442,
    roughness: 0.65,
    metalness: 0.4,
  });
  const limeTrimMat = new THREE.MeshStandardMaterial({
    color: 0xc4d835,
    emissive: new THREE.Color(0xc4d835),
    emissiveIntensity: 0.1,
    roughness: 0.3,
  });

  const numTiers = 6;
  const tierDepth = 1.05;
  const tierRise = 0.56;

  // Build stepped tiers + collect seat positions for single InstancedMesh
  const seatTransforms: Array<{ pos: THREE.Vector3; rotY: number; tone: number }> = [];

  // West & East Side Stands
  for (const side of [-1, 1] as const) {
    const startX = side * (STADIUM_CONSTANTS.PITCH_WIDTH / 2 + 2.5);
    for (let t = 0; t < numTiers; t++) {
      const tx = startX + side * t * tierDepth;
      const ty = 0.5 + t * tierRise;
      const tierBox = new THREE.Mesh(
        new THREE.BoxGeometry(tierDepth + 0.08, ty + 0.5, STADIUM_CONSTANTS.PITCH_LENGTH + 4),
        concreteMat
      );
      tierBox.position.set(tx, (ty + 0.5) / 2 - 0.1, 0);
      tierBox.receiveShadow = true;
      group.add(tierBox);

      const seatCount = isMobile ? 28 : 38;
      for (let s = 0; s < seatCount; s++) {
        const z = -17.4 + (s / (seatCount - 1)) * 34.8;
        seatTransforms.push({
          pos: new THREE.Vector3(tx - side * 0.12, ty + 0.36, z),
          rotY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
          tone: (s + t) % 7 === 0 ? 1 : 0,
        });
      }
    }

    // Outer stadium structural wall & cantilevered roof truss canopy
    const outerX = startX + side * (numTiers * tierDepth + 0.7);
    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 7.6, STADIUM_CONSTANTS.PITCH_LENGTH + 14),
      fasciaMat
    );
    backWall.position.set(outerX, 3.8, 0);
    group.add(backWall);

    // Overhead cantilevered stadium roof canopy
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(8.2, 0.28, STADIUM_CONSTANTS.PITCH_LENGTH + 12),
      fasciaMat
    );
    canopy.position.set(outerX - side * 3.4, 8.2, 0);
    canopy.rotation.z = side * 0.08;
    group.add(canopy);

    // Canopy front architectural rim trim
    const canopyTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, STADIUM_CONSTANTS.PITCH_LENGTH + 12),
      limeTrimMat
    );
    canopyTrim.position.set(outerX - side * 7.45, 7.86, 0);
    group.add(canopyTrim);
  }

  // North & South End Stands
  for (const endSign of [-1, 1] as const) {
    const startZ = endSign * (STADIUM_CONSTANTS.PITCH_LENGTH / 2 + 2.7);
    for (let t = 0; t < numTiers; t++) {
      const tz = startZ + endSign * t * tierDepth;
      const ty = 0.5 + t * tierRise;
      const tierBox = new THREE.Mesh(
        new THREE.BoxGeometry(STADIUM_CONSTANTS.PITCH_WIDTH + 5.2, ty + 0.5, tierDepth + 0.08),
        concreteMat
      );
      tierBox.position.set(0, (ty + 0.5) / 2 - 0.1, tz);
      tierBox.receiveShadow = true;
      group.add(tierBox);

      const seatCount = isMobile ? 20 : 26;
      for (let s = 0; s < seatCount; s++) {
        const x = -11.4 + (s / (seatCount - 1)) * 22.8;
        seatTransforms.push({
          pos: new THREE.Vector3(x, ty + 0.36, tz - endSign * 0.12),
          rotY: endSign === -1 ? 0 : Math.PI,
          tone: (s + t) % 9 === 0 ? 1 : 0,
        });
      }
    }

    const outerZ = startZ + endSign * (numTiers * tierDepth + 0.7);
    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(STADIUM_CONSTANTS.PITCH_WIDTH + 17.5, 7.6, 0.65),
      fasciaMat
    );
    backWall.position.set(0, 3.8, outerZ);
    group.add(backWall);
  }

  // Instanced Stadium Seats (1 draw call for entire stadium bowl!)
  const seatGeo = new THREE.BoxGeometry(0.46, 0.38, 0.36);
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.15,
  });
  const seatInstanced = new THREE.InstancedMesh(seatGeo, seatMat, seatTransforms.length);
  const dummy = new THREE.Object3D();
  const navySeatA = new THREE.Color(0x1a265c);
  const navySeatB = new THREE.Color(0x22308f);
  const accentSeat = new THREE.Color(0x3f51b5);

  seatTransforms.forEach((entry, idx) => {
    dummy.position.copy(entry.pos);
    dummy.rotation.set(0, entry.rotY, 0);
    dummy.updateMatrix();
    seatInstanced.setMatrixAt(idx, dummy.matrix);
    seatInstanced.setColorAt(
      idx,
      entry.tone === 1 ? accentSeat : idx % 2 === 0 ? navySeatA : navySeatB
    );
  });
  seatInstanced.instanceMatrix.needsUpdate = true;
  if (seatInstanced.instanceColor) seatInstanced.instanceColor.needsUpdate = true;
  seatInstanced.computeBoundingSphere();
  group.add(seatInstanced);

  // 6. 4 Towering Stadium Floodlight Pylons + Volumetric Cones
  const towerPositions: Array<[number, number]> = [
    [-15.2, -20.2], // 0: NW
    [15.2, -20.2],  // 1: NE
    [-15.2, 20.2],  // 2: SW
    [15.2, 20.2],   // 3: SE
  ];
  const towerTargets: Array<[number, number, number]> = [
    [-2.5, 0, -4.5],
    [2.5, 0, -4.5],
    [-2.5, 0, 4.5],
    [2.5, 0, 4.5],
  ];

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x26314d,
    metalness: 0.78,
    roughness: 0.34,
  });
  const towerFootingMat = new THREE.MeshStandardMaterial({
    color: 0x161e34,
    roughness: 0.85,
  });

  const floodlights: FloodlightUnit[] = [];

  towerPositions.forEach(([tx, tz], idx) => {
    const towerGroup = new THREE.Group();
    towerGroup.position.set(tx, 0, tz);
    const targetVec = new THREE.Vector3(...towerTargets[idx]);
    const localAim = targetVec.clone().sub(new THREE.Vector3(tx, 14.8, tz)).normalize();
    const yawAngle = Math.atan2(localAim.x, localAim.z);

    // Footing + mast pole
    const footing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 1.5), towerFootingMat);
    footing.position.y = 0.7;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, 15.2, 10), steelMat);
    mast.position.y = 7.6;
    towerGroup.add(footing, mast);

    // Lattice collar rings
    for (let ringY = 4; ringY <= 12; ringY += 4) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.22, 8), steelMat);
      collar.position.y = ringY;
      towerGroup.add(collar);
    }

    // Pivot Head Assembly angled toward pitch
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 14.9, 0);
    headPivot.rotation.y = yawAngle;

    const headHousing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.55, 0.42), steelMat);
    headHousing.rotation.x = 0.46;
    headPivot.add(headHousing);

    const emissiveMat = new THREE.MeshStandardMaterial({
      color: 0x182036,
      emissive: new THREE.Color(0xf0f6ff),
      emissiveIntensity: 0.0,
      roughness: 0.2,
    });
    const bulbPanel = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 1.25), emissiveMat);
    bulbPanel.rotation.x = 0.46;
    bulbPanel.position.set(0, -0.09, 0.22);
    headPivot.add(bulbPanel);

    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xd9ecff,
      transparent: true,
      opacity: 0.0,
    });
    const corona = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.0), beaconMat);
    corona.rotation.x = 0.46;
    corona.position.set(0, -0.1, 0.25);
    headPivot.add(corona);

    // Volumetric Floodlight Cone aimed downward onto pitch
    const beamMat = createVolumetricBeamMaterial(idx % 2 === 0 ? 0xd9e8ff : 0xf4f9e8);
    const beamLen = 28;
    const beamGeo = new THREE.ConeGeometry(8.8, beamLen, 28, 1, true);
    // Align cone tip at origin pointing along +Z/downward
    beamGeo.translate(0, -beamLen / 2, 0);
    beamGeo.rotateX(-Math.PI / 2 - 0.56);
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.set(0, 0, 0.2);
    headPivot.add(beamMesh);

    towerGroup.add(headPivot);
    group.add(towerGroup);

    // Real SpotLight for crisp turf & player illumination
    const spotLight = new THREE.SpotLight(
      idx < 2 ? 0xeef5ff : 0xf6f9ee,
      0.0,
      58,
      Math.PI / 4.2,
      0.62,
      1.15
    );
    spotLight.position.set(tx, 14.8, tz);
    spotLight.target.position.copy(targetVec);
    group.add(spotLight, spotLight.target);

    floodlights.push({
      spotLight,
      emissiveMat,
      beamMat,
      beaconMat,
      power: 0,
    });
  });

  // 7. Center Hero Convergence Spotlight (Scene 06-07 logo reveal focus)
  const centerFocusSpot = new THREE.SpotLight(0xd9e9ff, 0, 36, Math.PI / 5.5, 0.65, 1.1);
  centerFocusSpot.position.set(0, 15.5, 4.5);
  centerFocusSpot.target.position.set(0, 1.4, 0.5);
  group.add(centerFocusSpot, centerFocusSpot.target);

  const centerFocusBeamMat = createVolumetricBeamMaterial(0xdbe8ff);
  const centerConeGeo = new THREE.ConeGeometry(5.2, 17, 28, 1, true);
  centerConeGeo.translate(0, -8.5, 0);
  const centerBeamMesh = new THREE.Mesh(centerConeGeo, centerFocusBeamMat);
  centerBeamMesh.position.set(0, 16.0, 0.6);
  group.add(centerBeamMesh);

  let flashBoost = 0;

  const applyLighting = () => {
    let avgPower = 0;
    for (let i = 0; i < floodlights.length; i++) {
      const f = floodlights[i];
      const effective = f.power * (1 + flashBoost * 0.45);
      f.spotLight.intensity = effective * 195;
      f.emissiveMat.emissiveIntensity = effective * 4.2;
      f.beamMat.uniforms.uIntensity.value = effective * 1.05;
      f.beaconMat.opacity = Math.min(0.65, effective * 0.48);
      avgPower += f.power;
    }
    avgPower /= floodlights.length;

    ambientLight.intensity = 0.1 + avgPower * 0.48 + flashBoost * 0.2;
    hemiLight.intensity = 0.1 + avgPower * 0.72;
    keyShadowLight.intensity = avgPower * 2.55 + flashBoost * 0.9;
    ledMat.emissiveIntensity = 0.05 + avgPower * 1.05;
    limeTrimMat.emissiveIntensity = 0.08 + avgPower * 0.85;
  };

  return {
    group,
    ambientLight,
    hemiLight,
    keyShadowLight,
    ledMat,
    centerFocusSpot,
    centerFocusBeamMat,
    setTowerPowers: (powers) => {
      for (let i = 0; i < 4; i++) {
        floodlights[i].power = THREE.MathUtils.clamp(powers[i], 0, 1.25);
      }
      applyLighting();
    },
    setCenterFocusPower: (power) => {
      const clamped = THREE.MathUtils.clamp(power, 0, 1.5);
      centerFocusSpot.intensity = clamped * 160;
      centerFocusBeamMat.uniforms.uIntensity.value = clamped * 1.15;
    },
    setFlashBoost: (boost) => {
      flashBoost = Math.max(0, boost);
      applyLighting();
    },
    updateNorthNetDeformation: (impactLocalX, impactLocalY, impactAgeSec) => {
      const posAttr = netData.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const rest = netData.restPos;
      const envelope =
        Math.exp(-impactAgeSec * 2.3) * Math.sin(Math.min(Math.PI, impactAgeSec * 9.5) + 0.35);
      const ripple = Math.cos(impactAgeSec * 17.0) * Math.exp(-impactAgeSec * 2.1);

      for (let i = 0; i < arr.length; i += 3) {
        const rx = rest[i];
        const ry = rest[i + 1];
        const rz = rest[i + 2];

        // Leave front posts anchored firmly at z = 0 and base anchored near y = 0
        const zFactor = Math.min(1, Math.abs(rz) / (netData.depth * 0.45));
        const yFactor = Math.min(1, ry / 0.35);
        const anchor = zFactor * yFactor;

        const dx = rx - impactLocalX;
        const dy = ry - impactLocalY;
        const distSq = dx * dx + dy * dy;
        const spatial = Math.exp(-distSq * 0.95);
        const travelingWave = Math.sin(Math.sqrt(distSq) * 4.5 - impactAgeSec * 14.0) * 0.14;

        const bulge = anchor * (spatial * 0.72 * envelope + travelingWave * ripple * Math.exp(-distSq * 0.35));
        arr[i] = rx + dx * spatial * 0.12 * envelope * anchor;
        arr[i + 1] = ry + dy * spatial * 0.08 * envelope * anchor;
        arr[i + 2] = rz - bulge; // Bulge outward (-Z behind goal)
      }
      posAttr.needsUpdate = true;
    },
    resetNorthNet: () => {
      const posAttr = netData.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      arr.set(netData.restPos);
      posAttr.needsUpdate = true;
    },
  };
}
