import * as THREE from 'three';

export interface IntroTextureSet {
  turfColor: THREE.CanvasTexture;
  turfRoughness: THREE.CanvasTexture;
  ballColor: THREE.CanvasTexture;
  ballBump: THREE.CanvasTexture;
  ledBoard: THREE.CanvasTexture;
  particleSprite: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

export function createIntroTextures(maxAnisotropy: number): IntroTextureSet {
  const anisotropy = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. Pro Futsal Artificial Turf Texture (Width maps X: 24m, Height maps Z: 40m -> wait: pitchPlane X=24, Z=36)
  // Let canvas W=1024 (X width), H=1536 (Z length) so stripes run horizontally along Z and markings stay proportional.
  const turfCanvas = document.createElement('canvas');
  turfCanvas.width = 1024;
  turfCanvas.height = 1536;
  const ctx = turfCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 768;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base dark emerald turf + horizontal mowed stadium stripes
  const stripeCount = 12;
  const padX = 68;
  const padY = 82;
  const fieldW = turfCanvas.width - padX * 2;
  const fieldH = turfCanvas.height - padY * 2;
  const stripeH = fieldH / stripeCount;

  // Apron dark emerald surround
  ctx.fillStyle = '#0e281b';
  ctx.fillRect(0, 0, turfCanvas.width, turfCanvas.height);

  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#154428' : '#1b5332';
    ctx.fillRect(padX - 24, padY + i * stripeH, fieldW + 48, stripeH + 1);
  }

  // Fine synthetic blade & infill rubber crumb micro-texture
  for (let i = 0; i < 42000; i++) {
    const x = Math.random() * turfCanvas.width;
    const y = Math.random() * turfCanvas.height;
    const isLight = Math.random() > 0.52;
    ctx.fillStyle = isLight ? 'rgba(62, 145, 86, 0.14)' : 'rgba(6, 18, 12, 0.22)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle turf wear around center spot & penalty boxes
  const drawWear = (cx: number, cy: number, rx: number, ry: number) => {
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0, 'rgba(30, 56, 36, 0.35)');
    grad.addColorStop(1, 'rgba(30, 56, 36, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  };
  drawWear(turfCanvas.width / 2, turfCanvas.height / 2, 70, 70);
  drawWear(turfCanvas.width / 2, padY + 95, 130, 75);
  drawWear(turfCanvas.width / 2, turfCanvas.height - padY - 95, 130, 75);

  // Crisp White Pro Futsal Court Lines
  ctx.strokeStyle = 'rgba(242, 247, 250, 0.92)';
  ctx.fillStyle = 'rgba(242, 247, 250, 0.94)';
  ctx.lineWidth = 7;

  // Outer pitch boundary
  ctx.strokeRect(padX, padY, fieldW, fieldH);

  // Halfway line & center circle
  const midX = turfCanvas.width / 2;
  const midY = turfCanvas.height / 2;
  ctx.beginPath();
  ctx.moveTo(padX, midY);
  ctx.lineTo(padX + fieldW, midY);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(midX, midY, 118, 0, Math.PI * 2);
  ctx.stroke();

  // Subtle outer center ring accent
  ctx.save();
  ctx.strokeStyle = 'rgba(196, 216, 53, 0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(midX, midY, 136, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Center spot
  ctx.beginPath();
  ctx.arc(midX, midY, 9, 0, Math.PI * 2);
  ctx.fill();

  // Top (North) & Bottom (South) Futsal Penalty Arcs
  const arcRadius = 190;
  // North D-area
  ctx.beginPath();
  ctx.arc(midX - 52, padY, arcRadius, 0.5 * Math.PI, Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(midX + 52, padY, arcRadius, 0, 0.5 * Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(midX - 52, padY + arcRadius);
  ctx.lineTo(midX + 52, padY + arcRadius);
  ctx.stroke();

  // North 6m & 10m penalty spots
  ctx.beginPath();
  ctx.arc(midX, padY + arcRadius, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(midX, padY + 305, 6, 0, Math.PI * 2);
  ctx.fill();

  // South D-area
  const southY = padY + fieldH;
  ctx.beginPath();
  ctx.arc(midX - 52, southY, arcRadius, Math.PI, 1.5 * Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(midX + 52, southY, arcRadius, 1.5 * Math.PI, 2 * Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(midX - 52, southY - arcRadius);
  ctx.lineTo(midX + 52, southY - arcRadius);
  ctx.stroke();

  // South 6m & 10m spots
  ctx.beginPath();
  ctx.arc(midX, southY - arcRadius, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(midX, southY - 305, 6, 0, Math.PI * 2);
  ctx.fill();

  // Corner arcs
  const cr = 34;
  ctx.beginPath();
  ctx.arc(padX, padY, cr, 0, 0.5 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(padX + fieldW, padY, cr, 0.5 * Math.PI, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(padX, southY, cr, 1.5 * Math.PI, 2 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(padX + fieldW, southY, cr, Math.PI, 1.5 * Math.PI);
  ctx.stroke();

  // Linear Roughness Map for turf
  rCtx.fillStyle = '#c8c8c8';
  rCtx.fillRect(0, 0, roughCanvas.width, roughCanvas.height);
  for (let i = 0; i < 20000; i++) {
    const v = 155 + Math.floor(Math.random() * 85);
    rCtx.fillStyle = `rgb(${v},${v},${v})`;
    rCtx.fillRect(
      Math.random() * roughCanvas.width,
      Math.random() * roughCanvas.height,
      2,
      2
    );
  }

  const turfColor = new THREE.CanvasTexture(turfCanvas);
  turfColor.colorSpace = THREE.SRGBColorSpace;
  turfColor.anisotropy = anisotropy;

  const turfRoughness = new THREE.CanvasTexture(roughCanvas);
  turfRoughness.anisotropy = anisotropy;

  // 2. Pro Match Football Texture + Seam Bump Map
  const ballCanvas = document.createElement('canvas');
  ballCanvas.width = 1024;
  ballCanvas.height = 512;
  const bCtx = ballCanvas.getContext('2d')!;

  const ballBumpCanvas = document.createElement('canvas');
  ballBumpCanvas.width = 1024;
  ballBumpCanvas.height = 512;
  const bbCtx = ballBumpCanvas.getContext('2d')!;

  bCtx.fillStyle = '#f2f4f7';
  bCtx.fillRect(0, 0, 1024, 512);
  bbCtx.fillStyle = '#dcdcdc';
  bbCtx.fillRect(0, 0, 1024, 512);

  // Subtle leather pebble texture
  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 512;
    bCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(195,205,220,0.22)';
    bCtx.fillRect(x, y, 2, 2);
    bbCtx.fillStyle = Math.random() > 0.5 ? '#ebebeb' : '#c2c2c2';
    bbCtx.fillRect(x, y, 2, 2);
  }

  // Draw clean pro match-ball polygonal patches & speed accents so spin reads crystal clear
  const drawHexPanel = (
    targetCtx: CanvasRenderingContext2D,
    bumpTargetCtx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    fill: string,
    accent: string
  ) => {
    targetCtx.save();
    targetCtx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) targetCtx.moveTo(px, py);
      else targetCtx.lineTo(px, py);
    }
    targetCtx.closePath();
    targetCtx.fillStyle = fill;
    targetCtx.fill();
    targetCtx.lineWidth = 7;
    targetCtx.strokeStyle = accent;
    targetCtx.stroke();
    targetCtx.restore();

    // Seam indent in bump map
    bumpTargetCtx.save();
    bumpTargetCtx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) bumpTargetCtx.moveTo(px, py);
      else bumpTargetCtx.lineTo(px, py);
    }
    bumpTargetCtx.closePath();
    bumpTargetCtx.lineWidth = 10;
    bumpTargetCtx.strokeStyle = '#383838';
    bumpTargetCtx.stroke();
    bumpTargetCtx.restore();
  };

  const panelCoords: Array<[number, number, string, string]> = [
    [128, 128, '#16204e', '#c4d835'],
    [384, 128, '#131a3d', '#9fb32c'],
    [640, 128, '#16204e', '#c4d835'],
    [896, 128, '#131a3d', '#9fb32c'],
    [256, 256, '#101736', '#c4d835'],
    [512, 256, '#182459', '#d4e157'],
    [768, 256, '#101736', '#c4d835'],
    [0, 256, '#182459', '#d4e157'],
    [1024, 256, '#182459', '#d4e157'],
    [128, 384, '#131a3d', '#9fb32c'],
    [384, 384, '#16204e', '#c4d835'],
    [640, 384, '#131a3d', '#9fb32c'],
    [896, 384, '#16204e', '#c4d835'],
  ];

  for (const [cx, cy, fill, accent] of panelCoords) {
    drawHexPanel(bCtx, bbCtx, cx, cy, 46, fill, accent);
  }

  // Seam connectors
  bCtx.strokeStyle = '#22308F';
  bCtx.lineWidth = 4;
  bbCtx.strokeStyle = '#4a4a4a';
  bbCtx.lineWidth = 6;
  for (let row = 0; row < 4; row++) {
    const y = 64 + row * 128;
    bCtx.beginPath();
    bCtx.moveTo(0, y);
    bCtx.lineTo(1024, y);
    bCtx.stroke();
    bbCtx.beginPath();
    bbCtx.moveTo(0, y);
    bbCtx.lineTo(1024, y);
    bbCtx.stroke();
  }

  const ballColor = new THREE.CanvasTexture(ballCanvas);
  ballColor.colorSpace = THREE.SRGBColorSpace;
  ballColor.anisotropy = anisotropy;

  const ballBump = new THREE.CanvasTexture(ballBumpCanvas);
  ballBump.anisotropy = anisotropy;

  // 3. LED Perimeter Board Texture
  const ledCanvas = document.createElement('canvas');
  ledCanvas.width = 1024;
  ledCanvas.height = 128;
  const lCtx = ledCanvas.getContext('2d')!;
  lCtx.fillStyle = '#0b122b';
  lCtx.fillRect(0, 0, 1024, 128);
  lCtx.fillStyle = '#22308F';
  lCtx.fillRect(0, 14, 1024, 100);
  lCtx.fillStyle = '#c4d835';
  lCtx.fillRect(0, 10, 1024, 5);
  lCtx.fillRect(0, 113, 1024, 5);

  lCtx.font = '800 54px "Barlow Condensed", sans-serif';
  lCtx.textAlign = 'center';
  lCtx.textBaseline = 'middle';
  lCtx.fillStyle = '#ffffff';
  lCtx.fillText('THE GRID', 210, 66);
  lCtx.fillStyle = '#c4d835';
  lCtx.fillText('FC ROVERS', 525, 66);
  lCtx.fillStyle = '#ffffff';
  lCtx.fillText('THE GRID', 840, 66);

  const ledBoard = new THREE.CanvasTexture(ledCanvas);
  ledBoard.colorSpace = THREE.SRGBColorSpace;
  ledBoard.wrapS = THREE.RepeatWrapping;
  ledBoard.repeat.set(3, 1);
  ledBoard.anisotropy = anisotropy;

  // 4. Radial Particle Sprite (Turf Dust & Atmospheric Motes)
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 64;
  pCanvas.height = 64;
  const pCtx = pCanvas.getContext('2d')!;
  const pGrad = pCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  pGrad.addColorStop(0, 'rgba(255,255,255,1)');
  pGrad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  pGrad.addColorStop(1, 'rgba(255,255,255,0)');
  pCtx.fillStyle = pGrad;
  pCtx.fillRect(0, 0, 64, 64);
  const particleSprite = new THREE.CanvasTexture(pCanvas);

  // 5. Soft Ground Contact Shadow Blob
  const sCanvas = document.createElement('canvas');
  sCanvas.width = 128;
  sCanvas.height = 128;
  const sCtx = sCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
  sGrad.addColorStop(0, 'rgba(2, 6, 14, 0.72)');
  sGrad.addColorStop(0.55, 'rgba(2, 6, 14, 0.32)');
  sGrad.addColorStop(1, 'rgba(2, 6, 14, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(sCanvas);

  return {
    turfColor,
    turfRoughness,
    ballColor,
    ballBump,
    ledBoard,
    particleSprite,
    contactShadow,
    dispose: () => {
      turfColor.dispose();
      turfRoughness.dispose();
      ballColor.dispose();
      ballBump.dispose();
      ledBoard.dispose();
      particleSprite.dispose();
      contactShadow.dispose();
    },
  };
}
