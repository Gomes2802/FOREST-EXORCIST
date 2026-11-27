/**
 * Gerenciador das entidades: cria um tipo por item de CONFIG.entityTypes, cada
 * um com a própria máquina de estados e comportamento, e aplica as regras entre
 * elas:
 *  - no máximo `maxActive` presentes ao mesmo tempo;
 *  - um intervalo mínimo entre aparições de entidades diferentes;
 *  - nada novo aparece enquanto um exorcismo está em andamento;
 *  - nunca sobrepostas (distância e ângulo mínimos entre elas).
 *
 * Um tipo novo é só uma entrada em CONFIG.entityTypes.
 */
import { createEntity, STATES } from '../entities/entity.js';
import { createHaunting } from './haunting.js';

const { DORMANT, EXORCIZING, EXORCISED } = STATES;

/** Está presente na floresta (visível ou surgindo/sumindo)? */
export function isPresent(entity) {
  return entity.active && entity.state !== DORMANT && entity.state !== EXORCISED;
}

/** Junta as opções de um tipo às gerais, sem alterar os originais. */
export function typeSettings(config, type) {
  return {
    visual: {
      ...config.entity,
      ...type.visual,
      effects: { ...config.entity.effects, ...type.visual?.effects },
    },
    behavior: { ...config.haunting, ...type.behavior },
  };
}

/**
 * @param {{ config: object, spriteManager: object, pixelRenderer: object,
 *   random: () => number, world: () => object, onEvent?: (name: string, id: string) => void,
 *   types?: string[] }} deps
 *   world() devolve a floresta vista pelas entidades; types limita quais existem.
 */
export function createEntityManager(BABYLON, scene, {
  config, spriteManager, pixelRenderer, random, world, onEvent = () => {}, types,
}) {
  const rules = config.encounters;
  const selected = config.entityTypes.filter((type) => !types || types.includes(type.id));
  let sinceAppearance = Infinity;
  let lastAppeared = null;

  const members = selected.map((type) => {
    const { visual, behavior } = typeSettings(config, type);
    const entity = createEntity(BABYLON, scene, {
      id: type.id, settings: visual, timing: behavior, spriteManager, pixelRenderer,
    });
    entity.exorcismDuration = type.exorcism?.duration;
    entity.expelledMessage = type.exorcism?.message;
    return { id: type.id, type, entity, behavior, haunting: null };
  });

  const others = (member) => members.filter((m) => m !== member && isPresent(m.entity));

  /** Pode surgir agora? (Antes de procurar um lugar.) */
  function allows(member) {
    if (members.some((m) => m.entity.state === EXORCIZING)) return false;
    if (others(member).length >= rules.maxActive) return false;
    return lastAppeared === member.id || sinceAppearance >= rules.minGap;
  }

  for (const member of members) {
    member.haunting = createHaunting({
      entity: member.entity,
      settings: member.behavior,
      random,
      gate: () => allows(member),
      onEvent: (name) => {
        if (name === 'appear') {
          sinceAppearance = 0;
          lastAppeared = member.id;
        }
        onEvent(name, member.id);
      },
      world: () => ({
        ...world(),
        others: others(member).map((m) => ({ x: m.entity.center.x, z: m.entity.center.z })),
        separation: rules.separation,
        separationAngle: rules.separationAngle,
      }),
    });
  }

  const byId = new Map(members.map((member) => [member.id, member]));

  return {
    members,
    entities: members.map((member) => member.entity),
    get(id) {
      return byId.get(id) ?? null;
    },
    get activeCount() {
      return members.filter((m) => isPresent(m.entity)).length;
    },
    /** Entidade sendo exorcizada agora, ou null. */
    get exorcizing() {
      return members.find((m) => m.entity.state === EXORCIZING)?.entity ?? null;
    },
    /** Comportamento (só durante o jogo). @param {object} viewer câmera */
    update(delta, viewer) {
      sinceAppearance += delta;
      for (const member of members) member.haunting.update(delta, viewer);
    },
    /** Animações; as adormecidas não custam nada. */
    animate(delta) {
      for (const { entity } of members) entity.update(delta);
    },
    reset() {
      sinceAppearance = Infinity;
      lastAppeared = null;
      for (const { entity, haunting } of members) {
        entity.reset();
        haunting.reset();
      }
    },
    refresh() {
      for (const { entity } of members) entity.refresh();
    },
  };
}
