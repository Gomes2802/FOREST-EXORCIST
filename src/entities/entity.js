/**
 * Entidade sobrenatural de teste: estados, aparência e volume de detecção.
 *
 * Estados: 'present' → 'exorcising' → 'exorcised'. Ainda não há inteligência,
 * movimento pelo mapa nem várias entidades.
 */
import { createSpriteMaterial } from '../graphics/materials.js';

/** Tolerância para somas de ponto flutuante chegarem a 100%. */
const COMPLETE = 1 - 1e-9;

/** Estado do exorcismo de uma entidade (sem dependência de 3D). */
export function createEntityState() {
  let state = 'present';
  let progress = 0;
  let active = true;

  return {
    get state() {
      return state;
    },
    /** 0 a 1. */
    get progress() {
      return progress;
    },
    get active() {
      return active;
    },
    /** Só entidades ativas e ainda presentes podem ser miradas. */
    get isTargetable() {
      return active && state !== 'exorcised';
    },
    setActive(value) {
      active = Boolean(value);
    },
    /** @returns {boolean} true no momento em que o exorcismo se completa. */
    advance(amount) {
      if (!this.isTargetable || !(amount > 0)) return false;
      progress = Math.min(1, progress + amount);
      if (progress < COMPLETE) {
        state = 'exorcising';
        return false;
      }
      progress = 1;
      state = 'exorcised';
      return true;
    },
    interrupt() {
      if (state === 'exorcising') state = 'present';
    },
    decay(amount) {
      if (state !== 'exorcised' && amount > 0) progress = Math.max(0, progress - amount);
    },
    reset() {
      state = 'present';
      progress = 0;
      active = true;
    },
  };
}

/** Cria a entidade na cena. O sprite precisa estar carregado no spriteManager. */
export function createEntity(BABYLON, scene, { settings, spriteManager, pixelRenderer }) {
  const entity = createEntityState();
  const base = entity.reset;
  const [x, y, z] = settings.position;
  const white = BABYLON.Color3.White();
  const glow = BABYLON.Color3.FromHexString(settings.effects.tint);

  const record = spriteManager.get(settings.sprite);
  const mesh = BABYLON.MeshBuilder.CreatePlane(
    'entity',
    { width: record.worldWidth, height: record.worldHeight },
    scene,
  );
  mesh.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, record.worldHeight / 2, 0));
  mesh.billboardMode = BABYLON.TransformNode.BILLBOARDMODE_Y;
  mesh.renderingGroupId = 1;
  mesh.isPickable = false;

  // Volume invisível atingido pelo raio da mira. Um cilindro vale de qualquer lado
  // e ignora as bordas transparentes do sprite. Não participa das colisões.
  const hitHeight = record.worldHeight * settings.hitbox.height;
  const hitRadius = (record.worldWidth * settings.hitbox.width) / 2;
  const hitbox = BABYLON.MeshBuilder.CreateCylinder(
    'entity:hitbox',
    { diameter: hitRadius * 2, height: hitHeight, tessellation: 10 },
    scene,
  );
  hitbox.position.set(x, y + record.worldHeight / 2, z);
  hitbox.isVisible = false;
  hitbox.isPickable = false;
  hitbox.computeWorldMatrix(true);

  let time = 0;
  let fade = 0;

  function applyMaterial() {
    const previous = mesh.material;
    // Atribui o novo antes de descartar o antigo: uma malha sem material faria o
    // Babylon.js criar um material padrão que ficaria sobrando.
    mesh.material = createSpriteMaterial(BABYLON, scene, spriteManager.get(settings.sprite), {
      pixelRenderer,
      tint: '#ffffff',
    });
    previous?.dispose(false, true);
  }

  /** Posiciona e colore o sprite conforme o estado atual. */
  function apply() {
    const { float, effects, fadeDuration, fadeRise } = settings;
    const exorcising = entity.state === 'exorcising';
    const gone = entity.state === 'exorcised' ? Math.min(1, fade / fadeDuration) : 0;
    const pulse = (Math.sin(time * effects.pulseSpeed) + 1) / 2;
    const shake = exorcising ? effects.shake * (0.35 + entity.progress * 0.65) : 0;

    mesh.position.set(
      x + Math.sin(time * 47) * shake,
      y + Math.sin((time / float.period) * Math.PI * 2) * float.amplitude + gone * fadeRise,
      z,
    );
    // Ao partir, a figura se estica para cima e afina.
    mesh.scaling.set(1 - gone * 0.6, 1 + gone * 0.35, 1);
    mesh.visibility = entity.state === 'exorcised' ? 1 - gone : 1 - (exorcising ? pulse * effects.flicker : 0);
    const warmth = entity.state === 'exorcised' ? 1 : (exorcising ? 0.45 + pulse * 0.55 : entity.progress * 0.4);
    BABYLON.Color3.LerpToRef(white, glow, warmth, mesh.material.emissiveColor);
    mesh.setEnabled(entity.active && gone < 1);
  }

  applyMaterial();
  apply();

  return Object.defineProperties(entity, Object.getOwnPropertyDescriptors({
    mesh,
    hitbox,
    /** Ponto central, usado para mirar e para descartar o que está longe. */
    center: Object.freeze({ x, y: y + record.worldHeight / 2, z }),
    /** Raio de uma esfera que envolve o volume de detecção. */
    boundingRadius: Math.hypot(hitRadius, hitHeight / 2),
    /** Anima a flutuação, o efeito do exorcismo e o desaparecimento. */
    update(dt) {
      time += dt;
      if (entity.state === 'exorcised') fade += dt;
      apply();
    },
    reset() {
      base.call(entity);
      time = 0;
      fade = 0;
      apply();
    },
    /** Reaplica o sprite depois de mudar a resolução, sem perder o estado. */
    refresh() {
      applyMaterial();
      apply();
    },
    dispose() {
      mesh.dispose(false, true);
      mesh.material?.dispose(false, true);
      hitbox.dispose();
    },
  }));
}
