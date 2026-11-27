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

/** Passo fixo da mola: o movimento não depende da taxa de quadros. */
const SPRING_STEP = 1 / 120;

/**
 * Movimento da mão: a cruz sobe em arco, vinda da direita e de baixo, com uma
 * mola amortecida (ultrapassa um pouco e assenta, como um punho real). Só afeta o
 * desenho; o tempo de erguer, usado pelo exorcismo, continua o de createRaise.
 */
export function createHandMotion({ omega, zeta }) {
  let position = 0;
  let velocity = 0;
  return {
    /** 0 = abaixada, 1 = erguida (pode passar de 1 por um instante). */
    get position() {
      return position;
    },
    get velocity() {
      return velocity;
    },
    /** @returns {void} avança a mola até o alvo, em passos fixos. */
    follow(target, dt) {
      let remaining = Math.min(Math.max(dt, 0), 0.1);
      while (remaining > 1e-9) {
        const step = Math.min(SPRING_STEP, remaining);
        remaining -= step;
        const acceleration = omega * omega * (target - position) - 2 * zeta * omega * velocity;
        velocity += acceleration * step;
        position += velocity * step;
      }
      if (Math.abs(target - position) < 1e-5 && Math.abs(velocity) < 1e-4) {
        position = target;
        velocity = 0;
      }
    },
    reset() {
      position = 0;
      velocity = 0;
    },
  };
}

export function createCross(BABYLON, scene, camera, { settings, requiredRaise, createVisual }) {
  const raise = createRaise(settings, requiredRaise);
  const hand = createHandMotion(settings.motion);
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
    const { arcX, arcTilt, sway } = settings.motion;
    const p = hand.position;
    const lower = 1 - p;
    const tremor = exorcising ? Math.sin(time * 38) * settings.tremor : 0;
    // A mão vem da direita e de baixo; o pulso fica para trás do movimento.
    root.position.set(x + tremor + lower * arcX, y - lower * settings.loweredOffset, z);
    root.rotation.z = settings.tilt - lower * arcTilt - hand.velocity * sway;
    visual.setGlow(exorcising ? 0.65 + Math.sin(time * 9) * 0.35 : 0);
    root.setEnabled(raise.amount > 0 || Math.abs(p) > 1e-3);
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
      hand.follow(raise.amount, dt);
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
      hand.reset();
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
