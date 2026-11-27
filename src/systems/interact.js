/**
 * Interações com a tecla E: escolhe o que o jogador está olhando de perto e
 * responde (abrir ou fechar a porta, examinar um objeto, ler um documento).
 */
import { isBlocked } from './interaction.js';

/**
 * O interagível que o jogador está olhando (função pura): ao alcance, dentro do
 * ângulo de visão e sem parede na frente. Entre vários, o mais centralizado.
 *
 * @param {{ x: number, y: number, z: number }} eye
 * @param {{ x: number, y: number, z: number }} direction vetor unitário do olhar
 * @param {{ id: string, point: object, range: number }[]} items
 * @param {{ maxAngle: number, occluders?: (item: object) => object[] }} options
 */
export function findInteractable(eye, direction, items, { maxAngle, occluders = () => [] }) {
  let best = null;
  let bestAngle = maxAngle;
  for (const item of items) {
    const dx = item.point.x - eye.x;
    const dy = item.point.y - eye.y;
    const dz = item.point.z - eye.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > item.range || distance === 0) continue;
    const cos = (dx * direction.x + dy * direction.y + dz * direction.z) / distance;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle > bestAngle) continue;
    if (isBlocked(eye, item.point, occluders(item))) continue;
    best = item;
    bestAngle = angle;
  }
  return best;
}

/** O jogador (círculo no chão) toca esta caixa? */
export function touchesBox(point, radius, box) {
  const x = Math.max(box.minX, Math.min(box.maxX, point.x));
  const z = Math.max(box.minZ, Math.min(box.maxZ, point.z));
  return Math.hypot(point.x - x, point.z - z) < radius;
}

/**
 * @param {{ settings: object, playerRadius: number, buildings: () => object }} deps
 */
export function createInteractions({ settings, playerRadius, buildings }) {
  let focus = null;
  const maxAngle = (settings.angle * Math.PI) / 180;
  /** Itens de cada construção, preparados uma vez. */
  const cache = new WeakMap();
  const itemsOf = (building) => {
    if (!cache.has(building)) cache.set(building, building.plan.interactables.map((item) => ({ ...item, building })));
    return cache.get(building);
  };
  /** Reaproveitada a cada quadro, para não gerar lixo de memória. */
  const candidates = [];
  const NONE = [];
  /** A porta não esconde a si mesma; as paredes escondem tudo. */
  const occluders = (item) => {
    if (!item.building) return NONE;
    return item.type === 'door' ? item.building.plan.walls : item.building.occluders;
  };
  /** Mensagem temporária: { text, time }. */
  let message = null;

  const say = (text, time = settings.messageDuration) => {
    message = { text, time };
  };

  function promptFor(item) {
    if (item.type === 'door') {
      return item.building.doorOpen ? settings.prompts.close : settings.prompts.open;
    }
    const read = item.type === 'document' && item.verb !== 'examine';
    return `${read ? settings.prompts.read : settings.prompts.examine} ${item.name}`;
  }

  return {
    get focus() {
      return focus;
    },
    get prompt() {
      return focus ? promptFor(focus) : null;
    },
    get message() {
      return message?.text ?? null;
    },
    /**
     * @param {number} dt
     * @param {{ x: number, y: number, z: number }} eye
     * @param {{ x: number, y: number, z: number }} direction
     */
    update(dt, eye, direction) {
      if (message) {
        message.time -= dt;
        if (message.time <= 0) message = null;
      }
      candidates.length = 0;
      const world = buildings();
      for (const building of world?.buildings ?? NONE) {
        const { center } = building.plan;
        // Longe da construção não há nada ao alcance: evita trabalho por quadro.
        if (Math.hypot(center.x - eye.x, center.z - eye.z) > settings.nearby) continue;
        for (const item of itemsOf(building)) candidates.push(item);
      }
      // Documentos na floresta: poucos, descartados pela distância.
      for (const item of world?.props ?? NONE) candidates.push(item);
      focus = findInteractable(eye, direction, candidates, { maxAngle, occluders });
    },
    /** @returns {boolean} true se algo respondeu. */
    use(playerPosition) {
      if (!focus) return false;
      // Quem abre a leitura é o jogo (ver core/game.js).
      if (focus.type === 'document') return true;
      if (focus.type === 'examine') {
        say(focus.message);
        return true;
      }
      const { building } = focus;
      if (building.doorOpen && touchesBox(playerPosition, playerRadius + 0.05, building.plan.door.closed)) {
        say(settings.blockedDoor, 2.5);
        return true;
      }
      building.setDoor(!building.doorOpen);
      return true;
    },
    reset() {
      focus = null;
      message = null;
    },
  };
}
