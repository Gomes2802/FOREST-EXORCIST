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
 * A lógica avança em passos fixos: o resultado não depende da taxa de quadros.
 */
import { STATES } from '../entities/entity.js';
import { chooseSpawn, fogVisibleDistance, viewAngle } from './spawn.js';
import { isBlocked } from './interaction.js';

const { DORMANT, APPEARING, WATCHING, DISAPPEARING, EXORCIZING, EXORCISED } = STATES;
/** Passos por chamada: um quadro muito longo não acelera o comportamento. */
const MAX_STEPS = 12;

/**
 * @param {{ entity: object, settings: object, random: () => number,
 *   world: () => object, onEvent?: (name: string) => void }} deps
 *   world() devolve { boundaryRadius, paths, fogDensity, occluders, blockers }.
 */
export function createHaunting({
  entity, settings, random, world, onEvent = () => {},
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

  const between = ({ min, max }) => min + random() * (max - min);

  function pickMood() {
    const options = Object.entries(settings.moods).filter(([name]) => name !== mood);
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
  }

  function tryAppear(viewer) {
    const spot = chooseSpawn({ random, viewer, world: world(), settings, previous });
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
    previous = spot;
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

  function observe(dt, viewer) {
    const distance = Math.hypot(entity.center.x - viewer.x, entity.center.z - viewer.z);
    if (distance < settings.fleeDistance) {
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
        timer = between(settings.interval);
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
      observeFrom(0);
      timer = settings.first.delay;
    },
  };
}
