/** Etapa 9: gerenciador, tipos de entidade, limites, posições e exorcismo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { STATES } from '../../src/entities/entity.js';
import { isPresent, typeSettings } from '../../src/systems/entityManager.js';
import { isValidAnchor, isValidSpawn, viewAngle } from '../../src/systems/spawn.js';
import { insideBuilding, planBuildings } from '../../src/world/buildings/index.js';
import { isBlocked } from '../../src/systems/interaction.js';
import { createGame } from '../helpers/world.js';
import { createRandom } from '../../src/world/forest.js';
import { emit } from '../helpers/dom.js';

const { DORMANT, APPEARING, WATCHING, DISAPPEARING, EXORCIZING, EXORCISED } = STATES;
const IDS = ['ghost', 'watcher', 'unstable'];
const [plan] = planBuildings(CONFIG);
const settingsOf = (id) => typeSettings(CONFIG, CONFIG.entityTypes.find((t) => t.id === id)).behavior;

async function ready(t, options = {}) {
  const context = createGame({ entityTypes: null, ...options });
  const { game, dom } = context;
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) game.update(1 / fps);
  };
  context.hold = () => {
    if (!game.inventory.selected) game.selectSlot(1);
    emit(dom.element, 'pointerdown', { button: 0, buttons: 1 });
  };
  context.release = () => emit(dom.window, 'pointerup', { button: 0, buttons: 0 });
  context.look = (x, z, tx, tz, ty = 1.6) => {
    game.player.teleport(x, z);
    game.view.reset(game.player.position);
    const { mouseSensitivity } = CONFIG.camera;
    game.view.look(Math.atan2(tx - x, tz - z) / mouseSensitivity,
      Math.atan2(1.7 - ty, Math.hypot(tx - x, tz - z)) / mouseSensitivity);
    context.run(0.4);
  };
  context.member = (id) => game.entities.get(id);
  /** Roda observando todas; chama `each` a cada quadro. */
  context.observe = (seconds, each, fps = 20) => {
    for (let i = 0; i < seconds * fps; i += 1) {
      game.update(1 / fps);
      each?.(i / fps);
    }
  };
  return context;
}

// ------------------------------------------------------------- Gerenciador

test('o gerenciador reconhece três tipos, cada um com sprite, tempo e comportamento próprios', async (t) => {
  const { game } = await ready(t);
  assert.deepEqual(game.entities.members.map((m) => m.id), IDS);
  const sprites = new Set(CONFIG.entityTypes.map((type) => typeSettings(CONFIG, type).visual.sprite));
  assert.equal(sprites.size, 3);
  assert.equal(game.entities.entities.length, 3);
  assert.equal(game.entity, game.entities.get('ghost').entity);
  assert.equal(game.entity.exorcismDuration, undefined, 'a original usa o tempo geral');
  assert.equal(game.entities.get('watcher').entity.exorcismDuration, 5);
  assert.equal(game.entities.get('unstable').entity.exorcismDuration, 2.5);
});

test('a entidade original mantém exatamente os valores gerais', () => {
  const ghost = typeSettings(CONFIG, CONFIG.entityTypes[0]);
  assert.deepEqual(ghost.visual, { ...CONFIG.entity, effects: { ...CONFIG.entity.effects } });
  for (const key of Object.keys(CONFIG.haunting)) {
    if (key !== 'anchorChance') assert.deepEqual(ghost.behavior[key], CONFIG.haunting[key], key);
  }
});

test('as diferenças entre tipos são moderadas e justas', () => {
  const [ghost, watcher, unstable] = IDS.map(settingsOf);
  assert.ok(watcher.minDistance > ghost.minDistance && watcher.maxDistance > ghost.maxDistance, 'observadora mais longe');
  assert.ok(watcher.stay.min > ghost.stay.min, 'observadora fica mais');
  assert.ok(unstable.stay.max < ghost.stay.min + 1, 'instável fica menos');
  assert.ok(watcher.relocate && !ghost.relocate && !unstable.relocate);
  assert.ok(unstable.blink && !ghost.blink && !watcher.blink);
  const duration = (id) => CONFIG.entityTypes.find((t) => t.id === id).exorcism?.duration ?? CONFIG.exorcism.duration;
  for (const [id, settings] of IDS.map((i) => [i, settingsOf(i)])) {
    // Dá para exorcizar: chega-se ao alcance sem fazê-la fugir, e há tempo.
    assert.ok(settings.fleeDistance < CONFIG.exorcism.range - 2, `${id}: foge antes de dar alcance`);
    assert.ok(settings.stay.min + settings.appearTime * 0.5 >= duration(id), `${id}: some antes de poder concluir`);
  }
  assert.ok(Math.max(...IDS.map(duration)) <= 2 * Math.min(...IDS.map(duration)));
});

test('começa com tudo adormecido; cada uma estreia no seu tempo', async (t) => {
  const { game, observe } = await ready(t);
  assert.equal(game.entities.activeCount, 0);
  const first = {};
  observe(100, (time) => {
    for (const { id, entity } of game.entities.members) {
      if (first[id] === undefined && entity.state !== DORMANT) first[id] = time;
    }
  });
  assert.ok(first.ghost >= 5.5 && first.ghost < first.watcher, JSON.stringify(first));
  assert.ok(first.watcher >= settingsOf('watcher').first.delay - 1, JSON.stringify(first));
  assert.ok(first.unstable >= settingsOf('unstable').first.delay - 1, JSON.stringify(first));
});

test('nunca há entidades demais, e as presentes não se sobrepõem', async (t) => {
  const { game, observe } = await ready(t);
  const { maxActive, separation } = CONFIG.encounters;
  let most = 0;
  let pairs = 0;
  const appearances = [];
  const previous = new Map();
  let time = 0;
  observe(600, () => {
    time += 0.05;
    game.view.look(14, 0);
    const present = game.entities.members.filter((m) => isPresent(m.entity));
    most = Math.max(most, present.length);
    assert.ok(present.length <= maxActive, `${present.length} presentes`);
    for (const [i, a] of present.entries()) {
      for (const b of present.slice(i + 1)) {
        pairs += 1;
        const distance = Math.hypot(a.entity.center.x - b.entity.center.x, a.entity.center.z - b.entity.center.z);
        assert.ok(distance >= separation - 0.01, `${a.id} e ${b.id} a ${distance.toFixed(2)}`);
      }
    }
    for (const m of game.entities.members) {
      if (previous.get(m.id) === DORMANT && m.entity.state === APPEARING) appearances.push({ id: m.id, time });
      previous.set(m.id, m.entity.state);
    }
  });
  assert.equal(most, maxActive, 'o limite nunca foi usado');
  assert.ok(pairs > 50);
  for (const id of IDS) assert.ok(appearances.filter((a) => a.id === id).length >= 5, `${id} quase não aparece`);
  for (let i = 1; i < appearances.length; i += 1) {
    if (appearances[i].id === appearances[i - 1].id) continue; // reaparição da instável
    assert.ok(appearances[i].time - appearances[i - 1].time >= CONFIG.encounters.minGap - 0.2,
      `aparições coladas: ${JSON.stringify(appearances.slice(i - 1, i + 1))}`);
  }
});

test('aparições nunca dentro de construções, objetos ou fora do mapa', async (t) => {
  const { game, observe, look } = await ready(t);
  const previous = new Map();
  let count = 0;
  // Perto da cabana, onde há mais chance de erro.
  look(-8, -11, -17, -12);
  observe(400, () => {
    game.view.look(11, 0);
    for (const m of game.entities.members) {
      const { state, center } = m.entity;
      if (state !== DORMANT) {
        assert.ok(!insideBuilding([plan], center.x, center.z, 0.3), `${m.id} dentro da cabana`);
        assert.ok(Math.hypot(center.x, center.z) <= CONFIG.player.boundaryRadius, `${m.id} fora do mapa`);
      }
      if (previous.get(m.id) === DORMANT && state === APPEARING) {
        count += 1;
        const behavior = settingsOf(m.id);
        const camera = game.view.camera.position;
        const distance = Math.hypot(center.x - camera.x, center.z - camera.z);
        const minimum = m.haunting.anchor ? behavior.anchorMinDistance : behavior.minDistance;
        assert.ok(distance >= minimum - 0.05, `${m.id} perto demais: ${distance.toFixed(2)}`);
        assert.ok(distance <= behavior.maxDistance + 0.05, `${m.id} longe demais: ${distance.toFixed(2)}`);
        for (const c of game.forest.occluders) {
          assert.ok(Math.hypot(center.x - c.x, center.z - c.z) >= c.radius + 0.25, `${m.id} dentro de objeto`);
        }
      }
      previous.set(m.id, state);
    }
  });
  assert.ok(count > 20, `${count} aparições`);
});

test('a entidade só muda de lugar enquanto não é vista', async (t) => {
  const { game, observe } = await ready(t);
  const last = new Map();
  let moves = 0;
  observe(700, () => {
    // O jogador olha em volta devagar.
    game.view.look(6, 0);
    const camera = game.view.camera;
    const viewer = { x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y };
    for (const { id, entity } of game.entities.members) {
      const now = { x: entity.center.x, z: entity.center.z, shown: entity.mesh.isEnabled(), state: entity.state };
      const before = last.get(id);
      last.set(id, now);
      if (!before || !before.shown || !now.shown) continue;
      if (Math.hypot(now.x - before.x, now.z - before.z) < 1e-6) continue;
      assert.equal(id, 'watcher', `${id} se moveu visível`);
      moves += 1;
      for (const point of [before, now]) {
        const side = viewAngle(viewer, point) * (180 / Math.PI) > 50;
        const hidden = isBlocked({ x: viewer.x, y: 1.7, z: viewer.z }, { x: point.x, y: 1.5, z: point.z }, game.forest.occluders);
        assert.ok(side || hidden, 'mudança de lugar à vista');
      }
    }
  });
  assert.ok(moves > 0, 'a observadora nunca mudou de lugar');
});

test('a observadora não se move enquanto encarada, nem durante o exorcismo', async (t) => {
  const { game, member, look, run, hold } = await ready(t);
  const watcher = member('watcher');
  watcher.haunting.summon(0, 14, { mood: 'shy', stay: 60 });
  look(0, 0, 0, 14);
  run(3);
  assert.deepEqual([watcher.entity.center.x, watcher.entity.center.z], [0, 14]);
  look(0, 6, 0, 14);
  hold();
  run(1);
  assert.equal(watcher.entity.state, EXORCIZING);
  game.view.look(30, 0);
  run(0.1);
  assert.deepEqual([watcher.entity.center.x, watcher.entity.center.z], [0, 14]);
});

test('a instável pode reaparecer logo em outro ponto, no máximo algumas vezes seguidas', async (t) => {
  const { game, member, observe } = await ready(t, { random: createRandom(3) });
  const unstable = member('unstable');
  const gaps = [];
  let goneAt = null;
  let spot = null;
  let maxHops = 0;
  observe(900, (time) => {
    game.view.look(14, 0);
    const { state, center } = unstable.entity;
    maxHops = Math.max(maxHops, unstable.haunting.hops);
    if (state === DORMANT && spot && goneAt === null) goneAt = time;
    if (state === APPEARING && goneAt !== null) {
      gaps.push({ gap: time - goneAt, moved: Math.hypot(center.x - spot.x, center.z - spot.z) });
      goneAt = null;
    }
    if (state === WATCHING) spot = { x: center.x, z: center.z };
  });
  const { blink, minRespawnGap } = settingsOf('unstable');
  const quick = gaps.filter((g) => g.gap <= blink.delay.max + 2);
  assert.ok(quick.length >= 3, `poucas reaparições rápidas: ${JSON.stringify(gaps.map((g) => g.gap.toFixed(1)))}`);
  assert.ok(gaps.some((g) => g.gap >= 10), 'nunca descansa');
  assert.ok(quick.every((g) => g.moved >= minRespawnGap - 0.5), 'voltou no mesmo lugar');
  assert.ok(maxHops <= blink.max);
});

test('a instável oscila visualmente; a original não salta', async (t) => {
  const { member, run, game } = await ready(t);
  const samples = (id, x) => {
    const m = member(id);
    m.haunting.summon(x, 14, { pinned: true });
    const values = new Set();
    for (let i = 0; i < 40; i += 1) {
      game.update(1 / 60);
      values.add(`${m.entity.mesh.position.x.toFixed(3)}|${m.entity.mesh.visibility.toFixed(2)}`);
    }
    return values;
  };
  run(0.1);
  assert.ok(samples('unstable', -6).size > 4);
  assert.equal(samples('ghost', 6).size, 1);
});

test('durações de permanência: a instável passa menos tempo presente que a observadora', async (t) => {
  const { game, observe } = await ready(t);
  const spans = { watcher: [], unstable: [], ghost: [] };
  const since = {};
  observe(900, (time) => {
    game.view.look(3, 0);
    for (const { id, entity } of game.entities.members) {
      if (entity.state !== DORMANT && since[id] === undefined) since[id] = time;
      if (entity.state === DORMANT && since[id] !== undefined) {
        spans[id].push(time - since[id]);
        delete since[id];
      }
    }
  });
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  assert.ok(mean(spans.unstable) < mean(spans.watcher), `${mean(spans.unstable)} x ${mean(spans.watcher)}`);
});

// ------------------------------------------------------------- Exorcismo

for (const id of IDS) {
  test(`${id}: detectada pela mira e exorcizada no tempo do tipo`, async (t) => {
    const { game, member, look, run, hold } = await ready(t);
    let hud;
    game.onHud = (state) => {
      hud = state;
    };
    const m = member(id);
    m.haunting.summon(1.3, 11, { pinned: true });
    look(0.5, 6, 1.3, 11);
    assert.equal(game.target, m.entity, 'não detectada');
    assert.equal(hud.aim, 'target');
    hold();
    const duration = m.entity.exorcismDuration ?? CONFIG.exorcism.duration;
    run(duration - 0.1);
    assert.equal(m.entity.state, EXORCIZING);
    assert.equal(hud.aim, 'exorcising');
    assert.ok(hud.progress > 0.8 && hud.progress < 1);
    run(0.5);
    assert.equal(m.entity.state, EXORCISED);
    assert.equal(hud.message, m.entity.expelledMessage ?? CONFIG.exorcism.message);
    run(CONFIG.entity.fadeDuration + 0.3);
    assert.equal(m.entity.mesh.isEnabled(), false);
    run(90, 20);
    assert.equal(m.entity.state, EXORCISED, 'voltou depois de expulsa');
  });
}

test('com duas na floresta, só a que está na mira progride; trocar interrompe a outra', async (t) => {
  const { game, member, look, run, hold } = await ready(t);
  const [a, b] = [member('ghost'), member('unstable')];
  a.haunting.summon(-4, 8, { pinned: true });
  b.haunting.summon(5, 8, { pinned: true });
  look(0, 3, -4, 8);
  hold();
  run(1.5);
  assert.deepEqual([a.entity.state, b.entity.state], [EXORCIZING, WATCHING]);
  const progress = a.entity.progress;
  look(0, 3, 5, 8);
  hold();
  run(1);
  assert.deepEqual([a.entity.state, b.entity.state], [WATCHING, EXORCIZING]);
  assert.ok(Math.abs(a.entity.progress - progress) < 0.1);
  assert.ok(b.entity.progress > 0.2);
});

test('durante um exorcismo nenhuma outra surge', async (t) => {
  const { game, member, look, run, hold } = await ready(t);
  const watcher = member('watcher');
  watcher.haunting.summon(0, 13, { mood: 'shy', stay: 60 });
  look(0, 5, 0, 13);
  hold();
  // Prolonga o exorcismo para passar dos tempos de estreia.
  watcher.entity.exorcismDuration = 200;
  run(80, 20);
  assert.equal(watcher.entity.state, EXORCIZING);
  for (const id of ['ghost', 'unstable']) assert.equal(member(id).entity.state, DORMANT, id);
  assert.equal(game.entities.activeCount, 1);
});

test('a parede da cabana impede exorcizar de dentro, mas a janela não', async (t) => {
  const { game, member, look } = await ready(t);
  const ghost = member('ghost');
  const north = plan.anchors.find((a) => a.kind === 'window' && a.z > plan.footprint.maxZ);
  ghost.haunting.summon(north.x, north.z, { pinned: true });
  look(north.x, plan.center.z - 0.6, north.x, north.z);
  assert.equal(game.target, ghost.entity, 'não vista pela janela');
  ghost.haunting.summon(plan.footprint.maxX + 3, plan.center.z, { pinned: true });
  look(plan.center.x, plan.center.z - 0.6, plan.footprint.maxX + 3, plan.center.z);
  assert.equal(game.target, null, 'vista através da porta fechada');
});

// ------------------------------------------------------------- Integração com a cabana

test('pontos junto à cabana: válidos pela janela, inválidos através da parede', () => {
  const behavior = settingsOf('watcher');
  const north = plan.anchors.find((a) => a.kind === 'window' && a.z > plan.footprint.maxZ);
  const world = { boundaryRadius: 32, fogDensity: 0.055, occluders: plan.walls, blockers: [], forbidden: [plan.footprint] };
  const inside = { x: north.x, z: plan.center.z - 1.5, yaw: 0.35, eyeHeight: 1.7 };
  assert.equal(isValidAnchor(north, { viewer: inside, world, settings: behavior }), true);
  const beside = { ...inside, x: plan.footprint.maxX - 0.5 };
  const hidden = { x: plan.footprint.maxX - 0.5, z: north.z, kind: 'window' };
  assert.equal(isValidAnchor(hidden, { viewer: beside, world, settings: behavior }), false);
  assert.equal(isValidAnchor(north, { viewer: { ...inside, yaw: Math.PI }, world, settings: behavior }), false, 'às costas');
  assert.equal(isValidSpawn({ x: plan.center.x, z: plan.center.z }, { viewer: { ...inside, x: 0, z: -12, yaw: -1.2 }, world, settings: behavior }), false, 'dentro');
});

test('de dentro da cabana, entidades aparecem às janelas e à entrada', async (t) => {
  const { game, observe, look } = await ready(t);
  game.buildings.buildings[0].resetDoor(true);
  look(plan.center.x, plan.center.z - 0.3, plan.center.x, plan.footprint.maxZ + 3);
  const kinds = new Set();
  let flee = 0;
  const previous = new Map();
  observe(900, (time) => {
    // O jogador olha em volta devagar (uma volta a cada ~40 s).
    game.view.look((Math.PI * 2) / (40 * 20) / CONFIG.camera.mouseSensitivity, 0);
    for (const m of game.entities.members) {
      const { state } = m.entity;
      if (previous.get(m.id) === DORMANT && state === APPEARING && m.haunting.anchor) {
        kinds.add(m.haunting.anchor.kind);
      }
      if (previous.get(m.id) === APPEARING && state === DISAPPEARING && m.haunting.anchor) flee += 1;
      previous.set(m.id, state);
    }
  });
  assert.ok(kinds.has('window'), `só ${[...kinds]}`);
  assert.equal(flee, 0, 'quem surge na janela não foge na hora');
});

test('as entidades não bloqueiam a passagem pela porta', async (t) => {
  const { game, member } = await ready(t);
  game.buildings.buildings[0].resetDoor(true);
  const entrance = plan.anchors.find((a) => a.kind === 'entrance');
  member('ghost').haunting.summon(entrance.x, entrance.z, { pinned: true });
  assert.equal(game.scene.meshes.some((m) => m.name.startsWith('entity:') && m.checkCollisions), false);
});

// ------------------------------------------------------------- Pausa, menu e desempenho

test('pausa congela todas; menu reinicia todas', async (t) => {
  const { game, member, run } = await ready(t);
  member('ghost').haunting.summon(1, 14, { stay: 60 });
  member('watcher').haunting.summon(-8, 14, { stay: 60 });
  run(0.5);
  game.pause();
  const snapshot = () => game.entities.members.map((m) => [m.entity.state, m.entity.presence, m.haunting.timer, m.entity.mesh.position.y]);
  const frozen = snapshot();
  run(40, 20);
  assert.deepEqual(snapshot(), frozen);
  game.quitToMenu();
  assert.ok(game.entities.entities.every((e) => e.state === DORMANT && !e.mesh.isEnabled()));
});

test('cada tipo usa uma malha; aparições não criam recursos; adormecidas não são redesenhadas', async (t) => {
  const { game, observe } = await ready(t);
  const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length];
  const before = count();
  let writes = 0;
  const idle = game.entities.get('unstable').entity.mesh;
  Object.defineProperty(idle, 'visibility', { configurable: true, get: () => 0, set: () => { writes += 1; } });
  observe(20);
  assert.equal(writes, 0);
  observe(200);
  assert.deepEqual(count(), before);
  assert.equal(game.scene.meshes.filter((m) => m.name.startsWith('entity:') && !m.name.endsWith('hitbox')).length, 3);
});
