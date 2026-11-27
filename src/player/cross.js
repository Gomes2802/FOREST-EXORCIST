/**
 * Cruz segurada pelo jogador: animação de levantar e abaixar, presa à câmera.
 *
 * A aparência é separada da animação: para trocar por um modelo, passe outra
 * `createVisual` que devolva { mesh, setGlow(intensidade), dispose() }.
 */
import { createSpriteMaterial } from '../graphics/materials.js';

/** Grupo de renderização próprio: desenhada por cima do cenário. */
const HAND_GROUP = 2;

/**
 * Quanto a cruz está erguida (0 a 1), em tempo real (independe do FPS).
 * @param {{ raiseTime: number, lowerTime: number }} settings
 * @param {number} threshold fração a partir da qual ela vale como erguida
 */
export function createRaise({ raiseTime, lowerTime }, threshold) {
  let amount = 0;
  return {
    get amount() {
      return amount;
    },
    /** @returns {number} quantos segundos deste passo ela passou erguida. */
    update(dt, holding) {
      if (!holding) {
        amount = Math.max(0, amount - dt / lowerTime);
        if (amount < 1e-6) amount = 0;
        return 0;
      }
      const before = amount;
      amount = Math.min(1, amount + dt / raiseTime);
      if (amount > 1 - 1e-6) amount = 1;
      if (before >= threshold) return dt;
      if (amount < threshold) return 0;
      return Math.max(0, dt - (threshold - before) * raiseTime);
    },
    reset() {
      amount = 0;
    },
  };
}

/** Visual padrão: um sprite substituível (manifest.json). */
export function createSpriteCrossVisual(BABYLON, scene, { settings, spriteManager, pixelRenderer }) {
  const record = spriteManager.get(settings.sprite);
  const mesh = BABYLON.MeshBuilder.CreatePlane(
    'held-cross',
    { width: settings.height * record.aspect, height: settings.height },
    scene,
  );
  const material = createSpriteMaterial(BABYLON, scene, record, { pixelRenderer, tint: settings.tint });
  material.fogEnabled = false;
  mesh.material = material;

  const tint = material.emissiveColor.clone();
  const white = BABYLON.Color3.White();
  return {
    mesh,
    setGlow(intensity) {
      BABYLON.Color3.LerpToRef(tint, white, intensity, material.emissiveColor);
    },
    dispose() {
      mesh.dispose();
      material.dispose(false, true);
    },
  };
}

export function createCross(BABYLON, scene, camera, { settings, requiredRaise, createVisual }) {
  const raise = createRaise(settings, requiredRaise);
  const root = new BABYLON.TransformNode('cross', scene);
  root.parent = camera;
  let visual = null;
  let time = 0;
  let exorcising = false;

  function build() {
    visual?.dispose();
    visual = createVisual();
    visual.mesh.parent = root;
    visual.mesh.renderingGroupId = HAND_GROUP;
    visual.mesh.isPickable = false;
    visual.mesh.alwaysSelectAsActiveMesh = true;
  }

  function apply() {
    const [x, y, z] = settings.position;
    const t = raise.amount;
    const eased = t * t * (3 - 2 * t);
    const tremor = exorcising ? Math.sin(time * 38) * settings.tremor : 0;
    root.position.set(x + tremor, y - (1 - eased) * settings.loweredOffset, z);
    root.rotation.z = settings.tilt - (1 - eased) * 0.3;
    visual.setGlow(exorcising ? 0.65 + Math.sin(time * 9) * 0.35 : 0);
    root.setEnabled(t > 0);
  }

  build();
  apply();

  return {
    root,
    get mesh() {
      return visual.mesh;
    },
    get amount() {
      return raise.amount;
    },
    get visible() {
      return raise.amount > 0;
    },
    /** @returns {number} segundos deste passo com a cruz erguida. */
    update(dt, holding) {
      time += dt;
      const ready = raise.update(dt, holding);
      apply();
      return ready;
    },
    /** Brilho e tremor enquanto o exorcismo acontece. */
    setExorcising(value) {
      exorcising = Boolean(value);
      apply();
    },
    /** Volta a desenhar o estado atual, sem avançar o tempo. */
    redraw() {
      apply();
    },
    reset() {
      raise.reset();
      exorcising = false;
      time = 0;
      apply();
    },
    refresh() {
      build();
      apply();
    },
    dispose() {
      visual.dispose();
      root.dispose();
    },
  };
}
