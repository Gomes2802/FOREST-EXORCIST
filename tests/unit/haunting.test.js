/** Etapa 5: máquina de estados, aparições, observação e desaparecimento. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createEntityState, STATES, TRANSITIONS } from '../../src/entities/entity.js';
import { chooseSpawn, isValidSpawn, fogVisibleDistance, viewAngle } from '../../src/systems/spawn.js';
import { createRandom } from '../../src/world/forest.js';
import { distanceToPaths } from '../../src/world/environment.js';
import { createGame } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';

const settings = CONFIG.haunting;
const { DORMANT, APPEARING, WATCHING, DISAPPEARING, EXORCIZING, EXORCISED } = STATES;
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} x ${b}`);

/** Leva o estado até `target` por transições válidas. */
function reach(target) {
  const state = createEntityState(CONFIG.haunting);
  const route = {
    [DORMANT]: [],
    [APPEARING]: [APPEARING],
    [WATCHING]: [APPEARING, WATCHING],
    [DISAPPEARING]: [APPEARING, DISAPPEARING],
    [EXORCIZING]: [APPEARING, EXORCIZING],
    [EXORCISED]: [APPEARING, EXORCIZING, EXORCISED],
  }[target];
  for (const next of route) assert.equal(state.transition(next), true, `${state.state} -> ${next}`);
  return state;
}

async function ready(t, options) {
  const context = createGame(options);
  const { game, dom } = context;
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  context.hold = () => {
    if (!game.inventory.selected) game.selectSlot(1);
    emit(dom.element, 'pointerdown', { button: 0, buttons: 1 });
  };
  context.release = () => emit(dom.window, 'pointerup', { button: 0, buttons: 0 });
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) game.update(1 / fps);
  };
  /** Roda até a condição valer; falha se passar de `limit` segundos. */
  context.until = (condition, limit = 60, fps = 30) => {
    for (let i = 0; i < limit * fps; i += 1) {
      if (condition()) return i / fps;
      game.update(1 / fps);
    }
    assert.fail(`condição não alcançada em ${limit} s (estado ${game.entity.state})`);
    return 0;
  };
  /** Coloca o jogador em (x, z) olhando para (tx, tz). */
  context.place = (x, z, tx = x, tz = z + 10) => {
    game.player.teleport(x, z);
    game.view.reset(game.player.position);
    game.view.look(Math.atan2(tx - x, tz - z) / CONFIG.camera.mouseSensitivity, 0);
    context.run(0.4);
  };
  return context;
}

// ---------------------------------------------------------------- Máquina de estados

test('a tabela de transições cobre os seis estados', () => {
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), Object.values(STATES).sort());
  assert.deepEqual(TRANSITIONS[EXORCISED], [], 'exorcizada só sai com reinício');
});

test('transições válidas são aceitas', () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const to of targets) {
      const state = reach(from);
      assert.equal(state.transition(to), true, `${from} -> ${to}`);
      assert.equal(state.state, to);
    }
  }
});

test('todas as demais transições são recusadas, sem mudar o estado', () => {
  for (const from of Object.values(STATES)) {
    for (const to of Object.values(STATES)) {
      if (TRANSITIONS[from].includes(to)) continue;
      const state = reach(from);
      assert.equal(state.transition(to), false, `${from} -> ${to} deveria ser recusada`);
      assert.equal(state.state, from);
    }
  }
  assert.equal(createEntityState(CONFIG.haunting).transition('voando'), false);
});

test('exorcizada não observa nem aparece sem reinício explícito', () => {
  const state = reach(EXORCISED);
  for (const to of Object.values(STATES)) assert.equal(state.transition(to), false);
  assert.equal(state.isTargetable, false);
  assert.equal(state.advance(1), false);
  state.reset();
  assert.equal(state.state, DORMANT);
  assert.equal(state.progress, 0);
  assert.equal(state.transition(APPEARING), true);
});

test('dormindo e desaparecendo não podem ser miradas nem exorcizadas', () => {
  for (const target of [DORMANT, DISAPPEARING]) {
    const state = reach(target);
    assert.equal(state.isTargetable, false, target);
    assert.equal(state.advance(0.5), false);
    assert.equal(state.progress, 0);
  }
});

test('aparecendo, só pode ser mirada depois de visível o bastante', () => {
  const state = reach(APPEARING);
  assert.equal(state.isTargetable, false, 'invisível');
  state.tick(settings.appearTime * (settings.targetableAt - 0.05));
  assert.equal(state.isTargetable, false);
  state.tick(settings.appearTime * 0.1);
  assert.equal(state.isTargetable, true);
  state.tick(settings.appearTime);
  close(state.presence, 1);
});

test('o exorcismo leva ao estado EXORCIZING e a interrupção volta a observar', () => {
  const state = reach(WATCHING);
  state.tick(10);
  state.advance(0.2);
  assert.equal(state.state, EXORCIZING);
  state.interrupt();
  assert.equal(state.state, WATCHING);
  close(state.progress, 0.2);
  assert.equal(state.advance(0.8), true);
  assert.equal(state.state, EXORCISED);
});

test('o progresso sobrevive ao desaparecimento e a um novo aparecimento', () => {
  const state = reach(WATCHING);
  state.tick(10);
  state.advance(0.4);
  state.interrupt();
  assert.equal(state.transition(DISAPPEARING), true);
  state.tick(settings.disappearTime + 0.1);
  assert.equal(state.presence, 0);
  assert.equal(state.transition(DORMANT), true);
  assert.equal(state.transition(APPEARING), true);
  close(state.progress, 0.4);
});

// ---------------------------------------------------------------- Posições

const world = {
  boundaryRadius: CONFIG.player.boundaryRadius,
  paths: CONFIG.forest.paths,
  fogDensity: CONFIG.environment.fog.density,
  occluders: [],
  blockers: [],
};
const viewer = { x: 0, z: 0, yaw: 0, eyeHeight: 1.7 };

test('as posições respeitam distâncias mínima e máxima e o limite do mapa', () => {
  const random = createRandom(1);
  for (let i = 0; i < 400; i += 1) {
    const player = { ...viewer, x: random() * 30 - 15, z: random() * 30 - 15, yaw: random() * Math.PI * 2 };
    const spot = chooseSpawn({ random, viewer: player, world, settings });
    assert.ok(spot, 'sem posição em campo aberto');
    const distance = Math.hypot(spot.x - player.x, spot.z - player.z);
    assert.ok(distance >= settings.minDistance - 1e-9, `${distance} perto demais`);
    assert.ok(distance <= settings.maxDistance + 1e-9, `${distance} longe demais`);
    assert.ok(Math.hypot(spot.x, spot.z) <= world.boundaryRadius - 1 + 1e-9, 'fora do mapa');
  }
});

test('a neblina limita a distância: nunca onde quase não se vê', () => {
  const limit = fogVisibleDistance(world.fogDensity, settings.minVisibility);
  close(Math.exp(-((limit * world.fogDensity) ** 2)), settings.minVisibility);
  const dense = { ...world, fogDensity: 0.085 };
  const random = createRandom(2);
  for (let i = 0; i < 100; i += 1) {
    const spot = chooseSpawn({ random, viewer, world: dense, settings });
    if (!spot) continue;
    assert.ok(Math.hypot(spot.x, spot.z) <= fogVisibleDistance(0.085, settings.minVisibility) + 1e-9);
  }
  // Neblina tão densa que a distância mínima já fica invisível: não aparece.
  assert.equal(chooseSpawn({ random, viewer, world: { ...world, fogDensity: 0.3 }, settings }), null);
});

test('nunca aparece no meio da mira nem atrás do campo de visão', () => {
  const random = createRandom(3);
  for (let i = 0; i < 300; i += 1) {
    const player = { ...viewer, yaw: random() * Math.PI * 2 };
    const spot = chooseSpawn({ random, viewer: player, world, settings });
    const angle = viewAngle(player, spot) * (180 / Math.PI);
    assert.ok(angle >= settings.minViewAngle - 1e-6, `${angle}° quase no centro`);
    assert.ok(angle <= settings.maxViewAngle + 1e-6, `${angle}° às costas`);
  }
});

test('não aparece dentro de objetos nem escondida atrás deles', () => {
  const trunk = { x: 0, z: 16, radius: 0.4, height: 5 };
  const spot = { x: 0, z: 16 };
  const base = { viewer: { ...viewer, yaw: 0.6 }, world: { ...world, occluders: [trunk] }, settings };
  assert.equal(isValidSpawn(spot, base), false, 'dentro do tronco');
  assert.equal(isValidSpawn({ x: 0.9, z: 16 }, base), false, 'colada ao tronco');
  // Um obstáculo no meio da linha de visão esconde a entidade.
  const cover = { x: 4, z: 8, radius: 1, height: 5 };
  const behind = { x: 8, z: 16 };
  const hidden = { viewer, world: { ...world, blockers: [cover] }, settings };
  assert.equal(isValidSpawn(behind, hidden), false);
  assert.equal(isValidSpawn(behind, { ...hidden, world }), true);
  // Cobertura baixa não esconde.
  assert.equal(isValidSpawn(behind, { ...hidden, world: { ...world, blockers: [{ ...cover, height: 0.5 }] } }), true);
});

test('exige que corpo, laterais e cabeça estejam visíveis', () => {
  const spot = { x: 0, z: 16 };
  const base = { viewer: { ...viewer, yaw: 0.6 }, settings };
  assert.equal(isValidSpawn(spot, { ...base, world }), true);
  // Uma folhagem ao lado do centro cobre metade da figura.
  const sideCover = { x: 0.35, z: 8, radius: 0.15, height: 5 };
  assert.equal(isValidSpawn(spot, { ...base, world: { ...world, blockers: [sideCover] } }), false, 'lateral coberta');
  // Um galho alto no meio do caminho cobre só a cabeça.
  const headCover = { x: 0, z: 14, radius: 0.1, height: 2.2 };
  assert.equal(isValidSpawn(spot, { ...base, world: { ...world, blockers: [headCover] } }), false, 'cabeça coberta');
});

test('aparece dentro da tela ou logo na borda, para poder ser notada', () => {
  // Metade do campo de visão horizontal em 16:9.
  const half = Math.atan(Math.tan(CONFIG.camera.fov / 2) * (16 / 9)) * (180 / Math.PI);
  assert.ok(settings.maxViewAngle <= half + 5, `${settings.maxViewAngle}° x ${half.toFixed(1)}°`);
});

test('quando nada passa nas regras normais, afrouxa a visão, mas nunca o essencial', () => {
  // Folhagem cobrindo os lados de toda a faixa normal: só o centro fica livre.
  const blockers = [];
  for (let a = -48; a <= 48; a += 4) {
    const angle = (a * Math.PI) / 180 + 0.011;
    blockers.push({ x: Math.sin(angle) * 6, z: Math.cos(angle) * 6, radius: 0.12, height: 5 });
  }
  const random = createRandom(6);
  const strict = { ...settings, fallbacks: [] };
  const crowded = { ...world, blockers };
  assert.equal(chooseSpawn({ random, viewer, world: crowded, settings: strict }), null, 'cenário não bloqueou');
  const spot = chooseSpawn({ random, viewer, world: crowded, settings });
  assert.ok(spot, 'não relaxou');
  const distance = Math.hypot(spot.x, spot.z);
  assert.ok(distance >= settings.minDistance && distance <= settings.maxDistance);
  // Um obstáculo sólido à frente de tudo continua escondendo.
  const wall = [];
  for (let a = -180; a < 180; a += 3) {
    wall.push({ x: Math.sin((a * Math.PI) / 180) * 6, z: Math.cos((a * Math.PI) / 180) * 6, radius: 0.4, height: 5 });
  }
  assert.equal(chooseSpawn({ random, viewer, world: { ...world, occluders: wall }, settings }), null);
});

test('evita voltar ao mesmo lugar e prefere variar', () => {
  const random = createRandom(4);
  let previous = null;
  const spots = [];
  for (let i = 0; i < 40; i += 1) {
    const spot = chooseSpawn({ random, viewer, world, settings, previous });
    if (previous) assert.ok(Math.hypot(spot.x - previous.x, spot.z - previous.z) >= settings.minRespawnGap - 1e-9);
    previous = spot;
    spots.push(`${Math.round(spot.x / 4)},${Math.round(spot.z / 4)}`);
  }
  assert.ok(new Set(spots).size >= 10, `pouca variedade: ${new Set(spots).size}`);
});

// ---------------------------------------------------------------- No jogo

test('começa adormecida e aparece depois de um tempo, gradualmente', async (t) => {
  const { game, run, until } = await ready(t);
  const { entity } = game;
  assert.equal(entity.state, DORMANT);
  assert.equal(entity.mesh.isEnabled(), false);
  assert.equal(entity.isTargetable, false);
  run(settings.first.delay - 0.5);
  assert.equal(entity.state, DORMANT, 'cedo demais');
  until(() => entity.state === APPEARING, 5);
  const fades = [];
  while (entity.state === APPEARING) {
    game.update(1 / 60);
    fades.push(entity.mesh.visibility);
  }
  assert.equal(entity.state, WATCHING);
  assert.ok(fades.length > 40, 'surgiu de repente');
  for (let i = 1; i < fades.length; i += 1) assert.ok(fades[i] >= fades[i - 1] - 0.05, 'surgimento irregular');
});

test('aparições usam posições válidas na floresta real, em lugares diferentes', async (t) => {
  const { game, until, place } = await ready(t);
  place(0, 0);
  const seen = [];
  for (let n = 0; n < 12; n += 1) {
    until(() => game.entity.state === APPEARING, 80);
    const spot = { x: game.entity.center.x, z: game.entity.center.z };
    const player = game.view.camera.position;
    const distance = Math.hypot(spot.x - player.x, spot.z - player.z);
    assert.ok(distance >= settings.minDistance - 0.01 && distance <= settings.maxDistance + 0.01, `${distance}`);
    for (const c of game.forest.occluders) {
      assert.ok(Math.hypot(spot.x - c.x, spot.z - c.z) >= c.radius + settings.clearance - 0.01, 'dentro de objeto');
    }
    assert.ok(Math.hypot(spot.x, spot.z) <= CONFIG.player.boundaryRadius);
    seen.push(spot);
    until(() => game.entity.state === DORMANT, 80);
    // Vira o jogador para variar o campo de visão.
    game.view.look(400, 0);
  }
  const distinct = new Set(seen.map((s) => `${Math.round(s.x / 3)},${Math.round(s.z / 3)}`));
  assert.ok(distinct.size >= 6, `poucos lugares: ${distinct.size}`);
});

test('os intervalos entre aparições respeitam o mínimo e o máximo e variam', async (t) => {
  const { game, until } = await ready(t);
  const gaps = [];
  until(() => game.entity.state === APPEARING, 30);
  for (let n = 0; n < 6; n += 1) {
    until(() => game.entity.state === DORMANT, 80);
    gaps.push(until(() => game.entity.state === APPEARING, 80));
    game.view.look(500, 0);
  }
  for (const gap of gaps) {
    assert.ok(gap >= settings.interval.min - 0.2, `${gap} rápido demais`);
    assert.ok(gap <= settings.interval.max + 2 * settings.retryDelay + 0.5, `${gap} demorado demais`);
  }
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 1, 'intervalos iguais demais');
});

test('a posição só muda enquanto está invisível', async (t) => {
  const { game } = await ready(t);
  let last = null;
  for (let i = 0; i < 90 * 30; i += 1) {
    game.update(1 / 30);
    const { center, mesh } = game.entity;
    if (last && mesh.isEnabled() && last.enabled) {
      assert.ok(Math.hypot(center.x - last.x, center.z - last.z) < 1e-9, 'teleporte visível');
    }
    last = { x: center.x, z: center.z, enabled: mesh.isEnabled() };
  }
});

test('observa por um tempo e depois desaparece suavemente', async (t) => {
  const { game, until, place } = await ready(t);
  place(0, 0);
  game.haunting.summon(0, 15, { mood: 'still', stay: 8 });
  const watched = until(() => game.entity.state === DISAPPEARING, 30);
  assert.ok(watched >= settings.stay.min - 0.1, `${watched} s de permanência`);
  const fades = [game.entity.mesh.visibility];
  while (game.entity.state === DISAPPEARING) {
    game.update(1 / 60);
    fades.push(game.entity.mesh.isEnabled() ? game.entity.mesh.visibility : 0);
  }
  assert.ok(fades.length > settings.disappearTime * 60 * 0.8, 'sumiu de uma vez');
  for (let i = 1; i < fades.length; i += 1) assert.ok(fades[i] <= fades[i - 1] + 0.02, 'sumiço irregular');
  assert.equal(game.entity.state, DORMANT);
  assert.equal(game.entity.mesh.isEnabled(), false);
});

test('orienta-se discretamente para o jogador, sem andar', async (t) => {
  const { game, run, place } = await ready(t);
  place(0, 0);
  game.haunting.summon(0, 15, { mood: 'still', stay: 60 });
  run(1);
  const start = game.entity.mesh.position.clone();
  const facing = () => game.entity.mesh.rotation.y;
  const before = facing();
  place(8, 10, 0, 15);
  run(0.05);
  assert.ok(Math.abs(facing() - before) < 0.6, 'virou de uma vez');
  run(6);
  const want = Math.atan2(-(8 - 0), -(10 - 15));
  const error = Math.atan2(Math.sin(facing() - want), Math.cos(facing() - want));
  assert.ok(Math.abs(error) < 0.15, `não se voltou ao jogador: ${error}`);
  assert.ok(Math.hypot(game.entity.mesh.position.x - start.x, game.entity.mesh.position.z - start.z) < 0.2);
});

test('aproximar-se demais faz a entidade desaparecer', async (t) => {
  const { game, run, place } = await ready(t);
  game.haunting.summon(0, 15, { mood: 'still', stay: 60 });
  game.player.teleport(0, 15 - settings.fleeDistance + 1);
  game.view.reset(game.player.position);
  run(0.2);
  assert.equal(game.entity.state, DISAPPEARING);
  assert.ok(game.entity.presence > 0, 'sumiu de uma vez');
  // A fuga é mais rápida que o desaparecimento normal.
  run(settings.fleeDisappearTime);
  assert.equal(game.entity.state, DORMANT);
  assert.ok(settings.fleeDisappearTime < settings.disappearTime);
});

test('afastar-se demais faz a entidade desaparecer', async (t) => {
  const { game, run, place } = await ready(t);
  game.haunting.summon(5, 20, { mood: 'still', stay: 60 });
  place(-5, -22);
  run(0.5);
  assert.equal(game.entity.state, DISAPPEARING);
});

test('humor tímido: some se encarada de perto sem a cruz, não de longe', async (t) => {
  const { game, run, place } = await ready(t);
  const distance = settings.shyDistance - 1;
  game.haunting.summon(0, 15, { mood: 'shy', stay: 60 });
  place(0, 15 - (settings.shyDistance + 4), 0, 15);
  run(settings.shyAfter + 2);
  assert.equal(game.entity.state, WATCHING, 'de longe não se assusta');
  place(0, 15 - distance, 0, 15);
  run(settings.shyAfter - 0.8);
  assert.equal(game.entity.state, WATCHING, 'cedo demais');
  run(1.5);
  assert.equal(game.entity.state, DISAPPEARING);
});

test('humor esquivo: some ao perder o contato visual, mas só depois de vista', async (t) => {
  const { game, run, place } = await ready(t);
  game.haunting.summon(0, 15, { mood: 'elusive', stay: 60 });
  place(0, 0, 0, -10); // de costas, nunca viu
  run(settings.lookAwayAfter + 2);
  assert.equal(game.entity.state, WATCHING, 'ainda não foi vista');
  place(0, 0, 0, 15);
  run(1);
  assert.equal(game.entity.state, WATCHING);
  place(0, 0, 0, -10);
  run(settings.lookAwayAfter + 0.6);
  assert.equal(game.entity.state, DISAPPEARING);
});

test('humor parado não se assusta com o olhar', async (t) => {
  const { game, run, place } = await ready(t);
  game.haunting.summon(0, 15, { mood: 'still', stay: 60 });
  place(0, 7, 0, 15);
  run(10);
  assert.equal(game.entity.state, WATCHING);
});

test('os humores variam e não se repetem em sequência', async (t) => {
  const { game, until } = await ready(t);
  const moods = [];
  for (let n = 0; n < 12; n += 1) {
    until(() => game.entity.state === APPEARING, 80);
    moods.push(game.haunting.mood);
    until(() => game.entity.state === DORMANT, 80);
    game.view.look(500, 0);
  }
  for (let i = 1; i < moods.length; i += 1) assert.notEqual(moods[i], moods[i - 1]);
  assert.ok(new Set(moods).size >= 2);
});

test('cada aparição varia discretamente a aparência', async (t) => {
  const { game, until } = await ready(t);
  const looks = [];
  for (let n = 0; n < 6; n += 1) {
    until(() => game.entity.state === WATCHING, 80);
    looks.push(`${game.entity.look.opacity.toFixed(3)}/${game.entity.look.scale.toFixed(3)}`);
    assert.ok(game.entity.look.opacity >= settings.look.opacity[0] && game.entity.look.opacity <= settings.look.opacity[1]);
    until(() => game.entity.state === DORMANT, 80);
    game.view.look(500, 0);
  }
  assert.ok(new Set(looks).size >= 4);
});

// ---------------------------------------------------------------- Exorcismo

test('durante o exorcismo não muda de posição nem desaparece, nem com tempo esgotado', async (t) => {
  const { game, run, place, hold } = await ready(t);
  place(0, 6, 0, 15);
  game.haunting.summon(0, 15, { mood: 'shy', stay: 3 });
  hold();
  run(2.5);
  assert.equal(game.entity.state, EXORCIZING);
  const spot = { ...game.entity.center };
  run(1);
  assert.equal(game.entity.state, EXORCIZING, 'sumiu durante o exorcismo');
  assert.deepEqual({ x: game.entity.center.x, z: game.entity.center.z }, { x: spot.x, z: spot.z });
});

test('exorcismo completo: EXORCISED, e nunca mais reaparece', async (t) => {
  const { game, run, place, hold } = await ready(t);
  place(0, 6, 0, 15);
  game.haunting.summon(0, 15, { mood: 'still', stay: 3 });
  hold();
  run(CONFIG.exorcism.duration + 1);
  assert.equal(game.entity.state, EXORCISED);
  run(CONFIG.entity.fadeDuration + 1);
  assert.equal(game.entity.mesh.isEnabled(), false);
  run(90, 30);
  assert.equal(game.entity.state, EXORCISED);
  assert.equal(game.entity.mesh.isEnabled(), false);
});

test('interromper preserva o progresso e dá um tempo de graça antes de sumir', async (t) => {
  const { game, run, place, hold, release } = await ready(t);
  place(0, 6, 0, 15);
  game.haunting.summon(0, 15, { mood: 'shy', stay: 3 });
  hold();
  run(2);
  const progress = game.entity.progress;
  release();
  run(0.3);
  assert.equal(game.entity.state, WATCHING);
  close(game.entity.progress, progress);
  run(settings.resumeGrace - 1);
  assert.equal(game.entity.state, WATCHING, 'sumiu sem dar chance de continuar');
  hold();
  run(1);
  assert.equal(game.entity.state, EXORCIZING);
  assert.ok(game.entity.progress > progress);
});

test('com o progresso guardado, a nova aparição continua de onde parou', async (t) => {
  const { game, run, place, hold, release, until } = await ready(t);
  place(0, 6, 0, 15);
  game.haunting.summon(0, 15, { mood: 'still', stay: 20 });
  hold();
  run(2);
  const progress = game.entity.progress;
  release();
  place(0, -25, 0, -30); // longe: some
  until(() => game.entity.state === DORMANT, 20);
  until(() => game.entity.state === APPEARING, 80);
  close(game.entity.progress, progress);
});

test('olhar para uma entidade desaparecendo não a exorciza', async (t) => {
  const { game, run, place, hold } = await ready(t);
  place(0, 6, 0, 15);
  game.haunting.summon(0, 15, { mood: 'still', stay: 60 });
  game.entity.transition(DISAPPEARING);
  hold();
  run(0.5);
  assert.equal(game.target, null);
  assert.equal(game.entity.progress, 0);
});

// ---------------------------------------------------------------- Tempo, pausa e menu

test('o comportamento não depende da taxa de quadros', async (t) => {
  const traces = [];
  for (const fps of [20, 60, 144]) {
    const { game } = await ready(t, { random: createRandom(5) });
    const trace = [];
    let state = game.entity.state;
    for (let i = 1; i <= 60 * fps; i += 1) {
      game.update(1 / fps);
      if (game.entity.state !== state) {
        state = game.entity.state;
        trace.push([state, Math.round((i / fps) * 5) / 5, Math.round(game.entity.center.x), Math.round(game.entity.center.z)]);
      }
    }
    traces.push(trace);
  }
  assert.ok(traces[0].length >= 6, `poucos eventos: ${traces[0].length}`);
  for (const trace of traces.slice(1)) {
    assert.equal(trace.length, traces[0].length);
    trace.forEach(([state, time, x, z], i) => {
      assert.equal(state, traces[0][i][0]);
      assert.ok(Math.abs(time - traces[0][i][1]) <= 0.2 + 1e-9, `${state} em ${time} x ${traces[0][i][1]}`);
      assert.deepEqual([x, z], traces[0][i].slice(2));
    });
  }
});

test('a pausa congela estado, contagem e aparência', async (t) => {
  const { game, run, until } = await ready(t);
  until(() => game.entity.state === APPEARING, 30);
  run(0.5);
  const snapshot = () => [game.entity.state, game.entity.presence, game.entity.mesh.visibility, game.haunting.timer];
  const frozen = snapshot();
  game.pause();
  run(60, 30);
  assert.deepEqual(snapshot(), frozen);
  await game.resume();
  run(1);
  assert.notDeepEqual(snapshot(), frozen);
});

test('no menu nada acontece; voltar ao menu reinicia a presença', async (t) => {
  const { game, run, until, place, hold } = await ready(t);
  until(() => game.entity.state === WATCHING, 40);
  place(0, 0);
  hold();
  game.pause();
  game.quitToMenu();
  assert.deepEqual([game.entity.state, game.entity.progress, game.entity.mesh.isEnabled()], [DORMANT, 0, false]);
  run(60, 30);
  assert.equal(game.entity.state, DORMANT);
  await game.play();
  until(() => game.entity.state === APPEARING, 15);
});

test('dormindo, a entidade não faz trabalho por quadro', async (t) => {
  const { game } = await ready(t);
  let visibility = 0;
  Object.defineProperty(game.entity.mesh, 'visibility', {
    configurable: true, get: () => 0, set: () => { visibility += 1; },
  });
  for (let i = 0; i < 60; i += 1) game.update(1 / 60);
  assert.equal(visibility, 0);
});

test('cria uma única entidade: nenhuma malha ou material novo a cada aparição', async (t) => {
  const { game, until } = await ready(t);
  const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length];
  const before = count();
  for (let n = 0; n < 4; n += 1) {
    until(() => game.entity.state === APPEARING, 80);
    until(() => game.entity.state === DORMANT, 80);
    game.view.look(500, 0);
  }
  assert.deepEqual(count(), before);
});

test('o aquecimento no carregamento não deixa nada visível nem muda o estado', async (t) => {
  const { game } = await ready(t);
  assert.deepEqual([game.entity.state, game.entity.mesh.isEnabled()], [DORMANT, false]);
  assert.deepEqual([game.cross.amount, game.cross.root.isEnabled()], [0, false]);
  game.haunting.summon(0, 15, { pinned: true });
  game.update(1 / 60);
  const before = [game.entity.state, game.entity.presence, game.entity.center.x, game.entity.mesh.position.x];
  await game.setSpriteResolution(0.5);
  game.update(0);
  assert.deepEqual([game.entity.state, game.entity.presence, game.entity.center.x, game.entity.mesh.position.x], before);
  assert.equal(game.entity.mesh.isEnabled(), true);
});

test('trilhas: parte das aparições fica perto do caminho', async (t) => {
  const { game, until } = await ready(t);
  let near = 0;
  for (let n = 0; n < 12; n += 1) {
    until(() => game.entity.state === APPEARING, 80);
    if (distanceToPaths(game.entity.center.x, game.entity.center.z, CONFIG.forest.paths) < 6) near += 1;
    until(() => game.entity.state === DORMANT, 80);
    game.view.look(500, 0);
  }
  assert.ok(near >= 3, `só ${near} de 12 perto da trilha`);
});
