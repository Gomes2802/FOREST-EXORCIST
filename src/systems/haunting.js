/**
 * Comportamento da entidade: quando e onde aparece, como observa e quando some.
 * Não há perseguição.
 *
 * Cada aparição tem um "humor", sorteado sem repetir o anterior:
 *  - still: fica parada até o tempo acabar;
 *  - shy: some se for encarada de perto por alguns segundos;
 *  - elusive: some se o jogador, depois de vê-la, desviar o olhar.
 * Em qualquer humor, some se o jogador chegar perto demais ou se afastar demais.
 * Durante o exorcismo nada disso acontece, e interrompê-lo dá um tempo de graça.
 *
 * Conforme as opções do tipo, a entidade ainda pode:
 *  - surgir junto a uma construção (anchorChance), numa janela ou na entrada;
 *  - mudar discretamente de lugar enquanto não é vista (relocate);
 *  - sumir e reaparecer logo em outro ponto (blink).
 *
 * A lógica avança em passos fixos: o resultado não depende da taxa de quadros.
 */
import { STATES } from '../entities/entity.js';
import { chooseSpawn, fogVisibleDistance, isOccupied, isValidAnchor, viewAngle } from './spawn.js';
import { isBlocked } from './interaction.js';

const { DORMANT, APPEARING, WATCHING, DISAPPEARING, EXORCIZING, EXORCISED } = STATES;
/** Passos por chamada: um quadro muito longo não acelera o comportamento. */
const MAX_STEPS = 12;

/**
 * @param {{ entity: object, settings: object, random: () => number,
 *   world: () => object, onEvent?: (name: string) => void, gate?: () => boolean }} deps
 *   world() devolve { boundaryRadius, paths, fogDensity, occluders, blockers } e,
 *   opcionalmente, forbidden, anchors e others. gate() veta uma nova aparição.
 */
export function createHaunting({
  entity, settings, random, world, onEvent = () => {}, gate = () => true,
}) {
  let accumulator = 0;
  /** Adormecida: segundos que faltam. Presente: segundos de observação. */
  let timer = settings.first.delay;
  let mood = 'still';
  let stay = 0;
  let grace = 0;
  let stare = 0;
  let seen = false;
  let lost = 0;
  let looking = false;
  let sense = 0;
  let previous = null;
  /** Ancorada (testes e medições): presente e sem decisões próprias. */
  let pinned = false;
  let snapFacing = false;
  /** A aparição atual é junto a uma construção (distâncias próprias). */
  let anchored = null;
  let hops = 0;
  let moves = 0;
  let sinceMove = 0;
  let unseen = 0;
  let nextCheck = 0;

  const between = ({ min, max }) => min + random() * (max - min);

  function pickMood() {
    const all = Object.entries(settings.moods);
    // Com um só comportamento possível, ele se repete.
    const others = all.filter(([name]) => name !== mood);
    const options = others.length > 0 ? others : all;
    let pick = random() * options.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [name, weight] of options) {
      pick -= weight;
      if (pick <= 0) return name;
    }
    return options.at(-1)[0];
  }

  function observeFrom(start) {
    timer = 0;
    grace = 0;
    stare = 0;
    lost = 0;
    seen = false;
    looking = false;
    sense = 0;
    stay = start;
    anchored = null;
    moves = 0;
    sinceMove = 0;
    unseen = 0;
    nextCheck = 0;
  }

  /** Um ponto de janela ou entrada que sirva agora, se o sorteio pedir. */
  function pickAnchor(viewer, state) {
    if (!settings.anchorChance) return null;
    const valid = (state.anchors ?? []).filter((anchor) => isValidAnchor(anchor, {
      viewer, world: state, settings, previous,
    }));
    // O sorteio só consome números quando há onde aparecer.
    if (valid.length === 0 || random() >= settings.anchorChance) return null;
    return valid[Math.floor(random() * valid.length)];
  }

  function tryAppear(viewer) {
    if (!gate()) {
      timer = settings.retryDelay;
      return;
    }
    const state = world();
    const anchor = pickAnchor(viewer, state);
    const spot = anchor ?? chooseSpawn({ random, viewer, world: state, settings, previous });
    if (!spot) {
      timer = settings.retryDelay;
      return;
    }
    mood = pickMood();
    const [lowAlpha, highAlpha] = settings.look.opacity;
    const [lowScale, highScale] = settings.look.scale;
    entity.setAppearance({
      opacity: lowAlpha + random() * (highAlpha - lowAlpha),
      scale: lowScale + random() * (highScale - lowScale),
    }, mood);
    entity.placeAt(spot.x, spot.z);
    entity.face(viewer);
    entity.transition(APPEARING);
    observeFrom(between(settings.stay));
    anchored = anchor;
    previous = { x: spot.x, z: spot.z };
    onEvent('appear');
  }

  /** O jogador está olhando para ela, e consegue vê-la? */
  function isSeen(viewer, distance) {
    const state = world();
    if (distance > fogVisibleDistance(state.fogDensity, settings.minVisibility / 2)) return false;
    if (viewAngle(viewer, entity.center) > (settings.gazeAngle * Math.PI) / 180) return false;
    const eye = { x: viewer.x, y: viewer.eyeHeight, z: viewer.z };
    return !isBlocked(eye, entity.center, state.occluders);
  }

  function leave(duration) {
    if (entity.vanish(duration)) onEvent('vanish');
  }

  /** O ponto está fora da vista: bem ao lado, às costas ou atrás de algo. */
  function isHidden(point, viewer, state) {
    if (viewAngle(viewer, point) > (settings.relocate.hiddenAngle * Math.PI) / 180) return true;
    const eye = { x: viewer.x, y: viewer.eyeHeight, z: viewer.z };
    return [1, 1.8].every((height) => isBlocked(eye, { x: point.x, y: height, z: point.z }, state.occluders));
  }

  /** Muda de lugar sem que o jogador veja: nem a saída, nem a chegada. */
  function tryRelocate(dt, viewer) {
    const rule = settings.relocate;
    sinceMove += dt;
    if (moves >= rule.max || sinceMove < rule.wait) return;
    // A visão é conferida algumas vezes por segundo, não a cada passo.
    nextCheck -= dt;
    if (nextCheck > 0) return;
    nextCheck += settings.senseInterval;
    const state = world();
    unseen = isHidden(entity.center, viewer, state) ? unseen + settings.senseInterval : 0;
    if (unseen < rule.unseenFor) return;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const length = rule.minStep + random() * (rule.maxStep - rule.minStep);
      const spot = { x: entity.center.x + Math.sin(angle) * length, z: entity.center.z + Math.cos(angle) * length };
      const distance = Math.hypot(spot.x - viewer.x, spot.z - viewer.z);
      if (distance < settings.fleeDistance + 3 || distance > settings.maxDistance) continue;
      if (Math.hypot(spot.x, spot.z) > state.boundaryRadius - 1) continue;
      if (!isHidden(spot, viewer, state) || isOccupied(spot, { viewer, world: state, settings })) continue;
      entity.placeAt(spot.x, spot.z);
      entity.face(viewer);
      entity.redraw();
      previous = spot;
      anchored = null;
      moves += 1;
      sinceMove = 0;
      unseen = 0;
      onEvent('relocate');
      return;
    }
    sinceMove = rule.wait - 0.5; // Sem lugar agora: tenta de novo em breve.
  }

  function observe(dt, viewer) {
    const distance = Math.hypot(entity.center.x - viewer.x, entity.center.z - viewer.z);
    const flee = anchored ? settings.anchorFleeDistance : settings.fleeDistance;
    if (distance < flee) {
      leave(settings.fleeDisappearTime);
      return;
    }
    if (distance > settings.maxObserveDistance) {
      leave();
      return;
    }
    if (entity.state !== WATCHING) return;
    timer += dt;
    if (grace > 0) {
      grace -= dt;
      stare = 0;
      lost = 0;
      return;
    }
    if (settings.relocate) tryRelocate(dt, viewer);
    if (mood !== 'still') {
      sense -= dt;
      if (sense <= 0) {
        looking = isSeen(viewer, distance);
        sense += settings.senseInterval;
      }
    }
    if (mood === 'shy') {
      stare = looking && distance <= settings.shyDistance ? stare + dt : Math.max(0, stare - dt);
      if (stare >= settings.shyAfter) return leave();
    } else if (mood === 'elusive') {
      if (looking) {
        seen = true;
        lost = 0;
      } else if (seen) {
        lost += dt;
        if (lost >= settings.lookAwayAfter) return leave();
      }
    }
    if (timer >= stay) leave();
    return undefined;
  }

  function step(dt, viewer) {
    const { state } = entity;
    if (state === EXORCISED) return;
    if (state === DORMANT) {
      timer -= dt;
      if (timer <= 1e-9) tryAppear(viewer);
      return;
    }
    entity.tick(dt);
    if (state === EXORCIZING) {
      grace = settings.resumeGrace;
      return;
    }
    if (state === DISAPPEARING) {
      if (entity.presence === 0) {
        entity.transition(DORMANT);
        entity.redraw();
        const { blink } = settings;
        if (blink && hops < blink.max && random() < blink.chance) {
          hops += 1;
          timer = between(blink.delay);
        } else {
          hops = 0;
          timer = between(settings.interval);
        }
        onEvent('gone');
      }
      return;
    }
    if (state === APPEARING && entity.presence === 1) entity.transition(WATCHING);
    observe(dt, viewer);
  }

  return {
    get mood() {
      return mood;
    },
    /** Ponto de construção da aparição atual, ou null. */
    get anchor() {
      return anchored;
    },
    /** Reaparições seguidas e mudanças de lugar nesta aparição. */
    get hops() {
      return hops;
    },
    get moves() {
      return moves;
    },
    get timer() {
      return timer;
    },
    /**
     * @param {number} delta segundos
     * @param {{ x: number, z: number, yaw: number, eyeHeight: number }} viewer
     */
    update(delta, viewer) {
      if (entity.state === EXORCISED) return;
      if (entity.state !== DORMANT) {
        entity.face(viewer, snapFacing ? undefined : delta);
        snapFacing = false;
      }
      if (pinned) return;
      accumulator = Math.min(accumulator + delta, settings.step * MAX_STEPS);
      while (accumulator >= settings.step - 1e-9) {
        step(settings.step, viewer);
        accumulator -= settings.step;
      }
    },
    /**
     * Coloca a entidade presente num lugar escolhido (testes e medições).
     * Com `pinned`, ela fica ali, sem decisões próprias, até o próximo reset.
     */
    summon(x, z, { mood: chosen = 'still', stay: duration = settings.stay.max, pinned: hold = false } = {}) {
      if (entity.state !== DORMANT) entity.reset();
      mood = chosen;
      entity.setAppearance({ opacity: 1, scale: 1 }, mood);
      entity.placeAt(x, z);
      entity.materialize();
      observeFrom(duration);
      previous = { x, z };
      pinned = hold;
      snapFacing = true;
    },
    /** Nova exploração: espera de novo antes da primeira aparição. */
    reset() {
      accumulator = 0;
      mood = 'still';
      previous = null;
      pinned = false;
      hops = 0;
      observeFrom(0);
      timer = settings.first.delay;
    },
  };
}
