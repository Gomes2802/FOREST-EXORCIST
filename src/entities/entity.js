/**
 * Entidade sobrenatural: máquina de estados, aparência e volume de detecção.
 *
 *   dormant ─▶ appearing ─▶ watching ─▶ disappearing ─▶ dormant
 *                  │  ▲         │ ▲
 *                  ▼  │         ▼ │
 *                 exorcizing ───────▶ exorcised   (só sai com reset())
 *
 * Quando aparecer, onde e por quanto tempo é decidido em systems/haunting.js.
 */
import { createSpriteMaterial } from '../graphics/materials.js';

export const STATES = Object.freeze({
  DORMANT: 'dormant',
  APPEARING: 'appearing',
  WATCHING: 'watching',
  DISAPPEARING: 'disappearing',
  EXORCIZING: 'exorcizing',
  EXORCISED: 'exorcised',
});

const { DORMANT, APPEARING, WATCHING, DISAPPEARING, EXORCIZING, EXORCISED } = STATES;

/** Únicas passagens permitidas entre estados. */
export const TRANSITIONS = Object.freeze({
  [DORMANT]: Object.freeze([APPEARING]),
  [APPEARING]: Object.freeze([WATCHING, DISAPPEARING, EXORCIZING]),
  [WATCHING]: Object.freeze([DISAPPEARING, EXORCIZING]),
  [DISAPPEARING]: Object.freeze([DORMANT]),
  [EXORCIZING]: Object.freeze([WATCHING, EXORCISED]),
  [EXORCISED]: Object.freeze([]),
});

/** Tolerância para somas de ponto flutuante chegarem a 100%. */
const COMPLETE = 1 - 1e-9;
const DEFAULT_LOOK = Object.freeze({ opacity: 1, scale: 1 });

/**
 * Estado da entidade (sem dependência de 3D).
 * @param {{ appearTime?: number, disappearTime?: number, targetableAt?: number }} [timing]
 */
export function createEntityState({ appearTime = 1.8, disappearTime = 1.6, targetableAt = 0.5 } = {}) {
  let state = DORMANT;
  let progress = 0;
  /** 0 = invisível, 1 = totalmente presente. */
  let presence = 0;
  let vanishTime = disappearTime;
  let active = true;

  return {
    get state() {
      return state;
    },
    /** Progresso do exorcismo, 0 a 1. Sobrevive a desaparecimentos. */
    get progress() {
      return progress;
    },
    get presence() {
      return presence;
    },
    get active() {
      return active;
    },
    /** Pode ser mirada: presente e visível o bastante para ser identificada. */
    get isTargetable() {
      if (!active) return false;
      if (state === WATCHING || state === EXORCIZING) return true;
      return state === APPEARING && presence >= targetableAt - 1e-9;
    },
    setActive(value) {
      active = Boolean(value);
    },
    /** @returns {boolean} false (sem mudar nada) se a passagem não for permitida. */
    transition(next) {
      if (!TRANSITIONS[state].includes(next)) return false;
      state = next;
      if (next === DORMANT) presence = 0;
      if (next === DISAPPEARING) vanishTime = disappearTime;
      return true;
    },
    /** Começa a desaparecer, opcionalmente mais rápido que o normal. */
    vanish(duration = disappearTime) {
      if (!this.transition(DISAPPEARING)) return false;
      vanishTime = duration;
      return true;
    },
    /** Avança o surgimento ou o desaparecimento. Não troca de estado. */
    tick(dt) {
      if (!(dt > 0)) return;
      if (state === DISAPPEARING) presence = Math.max(0, presence - dt / vanishTime);
      else if (state === APPEARING || state === WATCHING || state === EXORCIZING) {
        presence = Math.min(1, presence + dt / appearTime);
      }
      if (presence < 1e-9) presence = 0;
      if (presence > COMPLETE) presence = 1;
    },
    /** Presença completa e imediata (uso em testes e medições). */
    materialize() {
      if (state !== DORMANT) return false;
      state = WATCHING;
      presence = 1;
      return true;
    },
    /** @returns {boolean} true no momento em que o exorcismo se completa. */
    advance(amount) {
      if (!this.isTargetable || !(amount > 0)) return false;
      if (state !== EXORCIZING) this.transition(EXORCIZING);
      progress = Math.min(1, progress + amount);
      if (progress < COMPLETE) return false;
      progress = 1;
      this.transition(EXORCISED);
      return true;
    },
    interrupt() {
      if (state === EXORCIZING) this.transition(WATCHING);
    },
    decay(amount) {
      if (state !== EXORCISED && amount > 0) progress = Math.max(0, progress - amount);
    },
    /** Único caminho para sair de "exorcised". */
    reset() {
      state = DORMANT;
      progress = 0;
      presence = 0;
      vanishTime = disappearTime;
      active = true;
    },
  };
}

/** Cria a entidade na cena. O sprite precisa estar carregado no spriteManager. */
export function createEntity(BABYLON, scene, {
  settings, timing, spriteManager, pixelRenderer,
}) {
  const entity = createEntityState(timing);
  const baseReset = entity.reset;
  const baseMaterialize = entity.materialize;
  const white = BABYLON.Color3.White();
  const glow = BABYLON.Color3.FromHexString(settings.effects.tint);
  const moodColors = new Map(Object.entries(settings.moodTints)
    .map(([mood, hex]) => [mood, BABYLON.Color3.FromHexString(hex)]));

  const record = spriteManager.get(settings.sprite);
  const mesh = BABYLON.MeshBuilder.CreatePlane(
    'entity',
    { width: record.worldWidth, height: record.worldHeight },
    scene,
  );
  mesh.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, record.worldHeight / 2, 0));
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
  hitbox.isVisible = false;
  hitbox.isPickable = false;

  const spot = { x: 0, z: 0 };
  let center = Object.freeze({ x: 0, y: settings.hover + record.worldHeight / 2, z: 0 });
  let look = DEFAULT_LOOK;
  let mood = 'still';
  let yaw = 0;
  let time = 0;
  let fade = 0;

  function moveHitbox() {
    center = Object.freeze({ x: spot.x, y: settings.hover + record.worldHeight / 2, z: spot.z });
    hitbox.position.set(center.x, center.y, center.z);
    hitbox.computeWorldMatrix(true);
  }

  function applyMaterial() {
    const previous = mesh.material;
    // Atribui o novo antes de descartar o antigo: uma malha sem material faria o
    // Babylon.js criar um material padrão que ficaria sobrando.
    mesh.material = createSpriteMaterial(BABYLON, scene, spriteManager.get(settings.sprite), {
      pixelRenderer,
      tint: '#ffffff',
      doubleSided: true,
    });
    previous?.dispose(false, true);
  }

  /** Posiciona e colore o sprite conforme o estado atual. */
  function apply() {
    const { float, effects, stare, fadeDuration, fadeRise } = settings;
    const { state, presence } = entity;
    const gone = state === EXORCISED ? Math.min(1, fade / fadeDuration) : 0;
    const shown = entity.active && (state === EXORCISED ? gone < 1 : state !== DORMANT);
    mesh.setEnabled(shown);
    if (!shown) return;

    const exorcising = state === EXORCIZING;
    const pulse = (Math.sin(time * effects.pulseSpeed) + 1) / 2;
    const shake = exorcising ? effects.shake * (0.35 + entity.progress * 0.65) : 0;
    // De tempos em tempos "encara": estica um pouco e fica mais clara.
    const phase = (time % stare.period) / stare.duration;
    const staring = state === WATCHING && phase < 1 ? Math.sin(phase * Math.PI) : 0;
    const leaving = state === DISAPPEARING ? 1 - presence : 0;

    mesh.position.set(
      spot.x + Math.sin(time * 47) * shake,
      settings.hover + Math.sin((time / float.period) * Math.PI * 2) * float.amplitude
        + gone * fadeRise + leaving * fadeRise * 0.4,
      spot.z,
    );
    mesh.rotation.y = yaw;
    // Ao partir, a figura se estica para cima e afina.
    mesh.scaling.set(
      look.scale * (1 - gone * 0.6),
      look.scale * (1 + gone * 0.35 + staring * stare.stretch),
      1,
    );
    const flicker = exorcising ? pulse * effects.flicker : 0;
    mesh.visibility = presence * look.opacity * (1 - gone) * (1 - flicker);

    const calm = moodColors.get(mood) ?? white;
    const color = mesh.material.emissiveColor;
    if (state === EXORCISED) color.copyFrom(glow);
    else if (exorcising) BABYLON.Color3.LerpToRef(white, glow, 0.45 + pulse * 0.55, color);
    else {
      BABYLON.Color3.LerpToRef(calm, white, staring, color);
      BABYLON.Color3.LerpToRef(color, glow, entity.progress * 0.4, color);
    }
  }

  applyMaterial();
  moveHitbox();
  apply();

  return Object.defineProperties(entity, Object.getOwnPropertyDescriptors({
    mesh,
    hitbox,
    /** Ponto central, usado para mirar e para descartar o que está longe. */
    get center() {
      return center;
    },
    /** Aparência da aparição atual. */
    get look() {
      return look;
    },
    /** Raio de uma esfera que envolve o volume de detecção. */
    boundingRadius: Math.hypot(hitRadius, hitHeight / 2),
    /** Move a entidade. Só deve ser chamado enquanto ela está invisível. */
    placeAt(x, z) {
      spot.x = x;
      spot.z = z;
      moveHitbox();
    },
    setAppearance(next, nextMood = 'still') {
      look = Object.freeze({ ...DEFAULT_LOOK, ...next });
      mood = nextMood;
    },
    /**
     * Volta-se para um ponto. Sem `dt`, vira de imediato (usado ao surgir);
     * com `dt`, vira devagar.
     */
    face(point, dt) {
      const wanted = Math.atan2(-(point.x - spot.x), -(point.z - spot.z));
      if (dt === undefined) {
        yaw = wanted;
        return;
      }
      const difference = Math.atan2(Math.sin(wanted - yaw), Math.cos(wanted - yaw));
      const step = settings.turnSpeed * dt;
      yaw += Math.max(-step, Math.min(step, difference));
    },
    /** Anima a flutuação e os efeitos. Adormecida, não faz nada. */
    update(dt) {
      if (entity.state === DORMANT) return;
      time += dt;
      if (entity.state === EXORCISED) fade += dt;
      apply();
    },
    /** Desenha o estado atual sem avançar o tempo. */
    redraw() {
      apply();
    },
    materialize() {
      if (!baseMaterialize.call(entity)) return false;
      apply();
      return true;
    },
    reset() {
      baseReset.call(entity);
      time = 0;
      fade = 0;
      look = DEFAULT_LOOK;
      mood = 'still';
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
