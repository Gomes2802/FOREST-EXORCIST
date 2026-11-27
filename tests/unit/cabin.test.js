/** Etapa 6: cabana, colisões, porta, interação e exploração. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { insideBuilding, planBuildings } from '../../src/world/buildings/index.js';
import { findInteractable, touchesBox } from '../../src/systems/interact.js';
import { isBlocked } from '../../src/systems/interaction.js';
import { distanceToPaths, samplePath } from '../../src/world/environment.js';
import { createRandom } from '../../src/world/forest.js';
import { createGame, intent } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';

const [plan] = planBuildings(CONFIG);
const { radius: PLAYER, boundaryRadius: BOUNDARY } = CONFIG.player;
const { footprint, bounds, center } = plan;
const doorZ = (plan.door.closed.minZ + plan.door.closed.maxZ) / 2;
/** Pontos à frente da porta, do lado de fora e de dentro. */
const OUTSIDE = { x: footprint.maxX + 1.6, z: doorZ };
const INSIDE = { x: footprint.maxX - 1.8, z: doorZ };
const SIZE = (box) => [box.maxX - box.minX, box.maxZ - box.minZ];

async function ready(t) {
  const context = createGame();
  const { game, dom } = context;
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) game.update(1 / fps);
  };
  context.press = (code) => {
    emit(dom.window, 'keydown', { code });
    emit(dom.window, 'keyup', { code });
  };
  context.cabin = game.buildings.buildings[0];
  /** Coloca o jogador em (x, z) olhando para um ponto. */
  context.look = (x, z, point) => {
    game.player.teleport(x, z);
    game.view.reset(game.player.position);
    const dx = point.x - x;
    const dz = point.z - z;
    const dy = (point.y ?? 1.7) - CONFIG.player.eyeHeight;
    const { mouseSensitivity } = CONFIG.camera;
    game.view.look(Math.atan2(dx, dz) / mouseSensitivity, Math.atan2(-dy, Math.hypot(dx, dz)) / mouseSensitivity);
    context.run(0.4);
  };
  /** Anda em direção a um ponto (parando perto dele). @returns {boolean} chegou */
  context.walk = (target, seconds = 8) => {
    for (let i = 0; i < seconds * 60; i += 1) {
      const p = game.player.body.position;
      if (Math.hypot(target.x - p.x, target.z - p.z) < 0.25) return true;
      game.player.update(1 / 60, intent(1, 0), Math.atan2(target.x - p.x, target.z - p.z));
    }
    return false;
  };
  context.open = () => {
    context.cabin.resetDoor(true);
    context.run(0.1);
  };
  return context;
}

// ------------------------------------------------------------- Planta e posição

test('a cabana fica numa região adequada: longe do início, fora da vista inicial e dentro do mapa', () => {
  const distance = Math.hypot(center.x, center.z);
  assert.ok(distance > 16, `perto demais do início: ${distance}`);
  // Quem começa olha para o norte: a construção fica fora do campo de visão.
  const angle = Math.abs(Math.atan2(center.x, center.z)) * (180 / Math.PI);
  assert.ok(angle > 70, `à vista no início (${angle.toFixed(0)}°)`);
  for (const x of [footprint.minX, footprint.maxX]) {
    for (const z of [footprint.minZ, footprint.maxZ]) assert.ok(Math.hypot(x, z) < BOUNDARY - 2, 'fora do mapa');
  }
});

test('não bloqueia as trilhas principais e uma picada leva até a porta', () => {
  const [main, branch, picada] = CONFIG.forest.paths;
  for (const path of [main, branch]) {
    for (const p of samplePath(path.points, 0.5)) {
      assert.ok(!insideBuilding([plan], p.x, p.z, 1.5), `trilha passa na construção (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
  }
  const samples = samplePath(picada.points, 0.5);
  assert.ok(distanceToPaths(samples[0].x, samples[0].z, [main]) < main.halfWidth, 'a picada sai da trilha principal');
  const end = samples.at(-1);
  assert.ok(Math.hypot(end.x - footprint.maxX, end.z - doorZ) < 1.2, 'não chega à porta');
});

test('a planta é determinística e preparada para outras construções', () => {
  assert.deepEqual(planBuildings(CONFIG), planBuildings(CONFIG));
  const copy = { ...CONFIG.buildings[0], id: 'outra', center: [18, -16] };
  const two = planBuildings({ ...CONFIG, buildings: [...CONFIG.buildings, copy] });
  assert.equal(two.length, 2);
  assert.notEqual(two[0].interactables[0].id, two[1].interactables[0].id);
  assert.throws(() => planBuildings({ buildings: [{ type: 'igreja' }] }), /desconhecido/);
});

test('há porta, janelas, telhado, interior mobiliado e uma lamparina', () => {
  const settings = CONFIG.buildings[0];
  assert.ok(settings.windows.length >= 3);
  assert.ok(settings.door.width > PLAYER * 2 + 0.4, 'porta estreita');
  const types = new Set(plan.furniture.map((f) => f.type));
  for (const type of ['table', 'chair', 'shelf', 'wardrobe', 'papers', 'books']) assert.ok(types.has(type), type);
  // Móveis dentro das paredes.
  for (const item of plan.furniture) {
    for (const b of item.boxes) {
      assert.ok(b.minX >= bounds.minX - 0.07 && b.maxX <= bounds.maxX + 0.07, `${item.type} atravessa a parede (x)`);
      assert.ok(b.minZ >= bounds.minZ - 0.07 && b.maxZ <= bounds.maxZ + 0.07, `${item.type} atravessa a parede (z)`);
    }
  }
  assert.ok(plan.lamp.x > bounds.minX && plan.lamp.x < bounds.maxX);
});

test('nenhuma vegetação nasce dentro da cabana nem atravessa as paredes', async (t) => {
  const { game } = await ready(t);
  const describe = (id) => game.spriteManager.get(id);
  for (const p of game.forest.placements) {
    const [x, , z] = p.position;
    const half = p.kind === 'grass' ? 0.3 : (describe(p.sprite).worldWidth * p.scale * p.stretch) / 2;
    assert.ok(!insideBuilding([plan], x, z, half), `${p.sprite} invade a cabana em (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
});

test('a construção usa poucas malhas e uma só luz, que não alcança o lado de fora', async (t) => {
  const { game, cabin } = await ready(t);
  assert.ok(cabin.meshes.length <= 12, `${cabin.meshes.length} malhas`);
  assert.equal(game.scene.lights.filter((l) => l.name.includes('lamp')).length, 1);
  for (const mesh of cabin.interiorMeshes) {
    assert.equal(game.lights.moon.canAffectMesh(mesh), false, mesh.name);
    assert.equal(cabin.lamp.canAffectMesh(mesh), true, mesh.name);
    assert.equal(game.lights.lantern.canAffectMesh(mesh), true, mesh.name);
  }
  for (const mesh of [...game.forest.groundTiles, ...game.forest.billboards.map((b) => b.mesh)]) {
    assert.equal(cabin.lamp.canAffectMesh(mesh), false, mesh.name);
  }
});

test('dentro da cabana a floresta é desenhada até menos longe, e volta ao sair', async (t) => {
  const { game, look } = await ready(t);
  look(OUTSIDE.x + 1, OUTSIDE.z, center);
  const outside = game.forest.distances;
  const drawn = () => game.forest.billboards.reduce((sum, b) => sum + b.visibleCount, 0);
  look(INSIDE.x, INSIDE.z, { x: INSIDE.x - 3, z: INSIDE.z });
  const inside = game.forest.distances;
  const { indoor } = CONFIG.environment.culling;
  for (const key of ['far', 'near', 'grass', 'shadows']) assert.ok(inside[key] < outside[key], key);
  assert.ok(inside.far <= indoor.spriteDistance && inside.grass <= indoor.grassDistance);
  // A floresta continua visível pelas janelas.
  assert.ok(drawn() > 20, `${drawn()} sprites`);
  look(OUTSIDE.x + 1, OUTSIDE.z, center);
  assert.deepEqual(game.forest.distances, outside);
});

test('retrato e papéis mostram a imagem inteira em cada face', async (t) => {
  const { cabin } = await ready(t);
  for (const name of ['portrait', 'paper']) {
    const mesh = cabin.meshes.find((m) => m.name === `cabin:${name}`);
    const uvs = mesh.getVerticesData('uv');
    for (let face = 0; face < uvs.length; face += 8) {
      assert.deepEqual([...uvs.slice(face, face + 8)], [0, 0, 1, 0, 1, 1, 0, 1], name);
    }
  }
});

test('longe, a cabana deixa de ser desenhada; perto, o interior aparece', async (t) => {
  const { game, cabin } = await ready(t);
  const wall = cabin.meshes.find((m) => m.name === 'cabin:outside');
  const floor = cabin.meshes.find((m) => m.name === 'cabin:floor');
  game.buildings.follow({ x: 30, z: 20 }, 40);
  assert.deepEqual([wall.isEnabled(false), floor.isEnabled(false)], [false, false]);
  game.buildings.follow({ x: center.x + 30, z: center.z }, 40);
  assert.deepEqual([wall.isEnabled(false), floor.isEnabled(false)], [true, false]);
  game.buildings.follow({ x: center.x + 6, z: center.z }, 40);
  assert.deepEqual([wall.isEnabled(false), floor.isEnabled(false)], [true, true]);
  assert.ok(cabin.colliders.every((c) => c.isEnabled()), 'colisões continuam');
});

// ------------------------------------------------------------- Colisões

test('de fora, as paredes bloqueiam por todos os lados (inclusive nas janelas)', async (t) => {
  const { game, walk } = await ready(t);
  const starts = [
    { x: center.x, z: footprint.maxZ + 1.5 }, { x: center.x, z: footprint.minZ - 1.5 },
    { x: footprint.minX - 1.5, z: center.z }, { x: center.x - 1.5, z: footprint.maxZ + 1.5 },
    { x: footprint.maxX + 1.5, z: footprint.maxZ - 0.5 },
  ];
  for (const start of starts) {
    game.player.teleport(start.x, start.z);
    walk(center, 3);
    const { x, z } = game.player.position;
    assert.ok(!insideBuilding([plan], x, z, PLAYER - 0.02), `atravessou por (${start.x}, ${start.z}) → (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
});

test('com a porta fechada não se entra; aberta, entra-se e sai-se normalmente', async (t) => {
  const { game, walk, open } = await ready(t);
  game.player.teleport(OUTSIDE.x, OUTSIDE.z);
  walk(INSIDE, 3);
  assert.ok(game.player.position.x > footprint.maxX + PLAYER - 0.02, `entrou com a porta fechada: ${game.player.position.x}`);
  open();
  assert.ok(walk(INSIDE), 'não conseguiu entrar');
  assert.ok(insideBuilding([plan], game.player.position.x, game.player.position.z));
  assert.ok(walk(OUTSIDE), 'não conseguiu sair');
  assert.ok(!insideBuilding([plan], game.player.position.x, game.player.position.z));
});

test('correndo e na diagonal, o vão da porta não prende o jogador', async (t) => {
  const { game, open } = await ready(t);
  open();
  for (const offset of [-0.55, -0.3, 0.3, 0.55]) {
    game.player.teleport(OUTSIDE.x, doorZ + offset);
    for (let i = 0; i < 90; i += 1) game.player.update(1 / 60, intent(1, 0, true), -Math.PI / 2);
    assert.ok(game.player.position.x < footprint.maxX - 0.3, `preso no vão (${offset}): ${game.player.position.x}`);
  }
});

test('dentro, paredes e móveis nunca são atravessados', async (t) => {
  const { game, open } = await ready(t);
  open();
  const random = createRandom(31);
  game.player.teleport(INSIDE.x, INSIDE.z);
  let yaw = 0;
  let move = intent(1, 0);
  let inside = 0;
  for (let frame = 0; frame < 12000; frame += 1) {
    if (frame % 40 === 0) {
      yaw = random() * Math.PI * 2;
      move = intent(random() < 0.85 ? 1 : -1, Math.round(random() * 2) - 1, random() < 0.5);
    }
    game.player.update(1 / 60, move, yaw);
    const p = game.player.body.position;
    for (const solid of plan.solids) {
      assert.ok(!touchesBox(p, PLAYER - 0.003, solid),
        `quadro ${frame}: atravessou (${SIZE(solid)}) em (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    }
    if (insideBuilding([plan], p.x, p.z)) inside += 1;
    else game.player.teleport(INSIDE.x, INSIDE.z);
  }
  assert.ok(inside > 8000, `passou pouco tempo dentro: ${inside}`);
  assert.ok(game.player.travelled > 50);
});

test('dentro, é possível chegar perto de cada objeto examinável', async (t) => {
  const { game, walk, open } = await ready(t);
  for (const item of plan.interactables.filter((i) => i.type === 'examine')) {
    open();
    game.player.teleport(INSIDE.x, INSIDE.z);
    walk(item.point, 4);
    const p = game.player.position;
    const distance = Math.hypot(item.point.x - p.x, item.point.y - 1.7, item.point.z - p.z);
    assert.ok(distance <= item.range, `${item.id} fora do alcance: ${distance.toFixed(2)}`);
  }
});

// ------------------------------------------------------------- Porta e interação

test('findInteractable respeita alcance, ângulo e paredes', () => {
  const eye = { x: 0, y: 1.7, z: 0 };
  const forward = { x: 0, y: 0, z: 1 };
  const item = { id: 'a', point: { x: 0, y: 1.2, z: 1.8 }, range: 2.2 };
  const options = { maxAngle: 0.6 };
  assert.equal(findInteractable(eye, forward, [item], options), item);
  assert.equal(findInteractable(eye, forward, [{ ...item, point: { x: 0, y: 1.2, z: 3 } }], options), null, 'longe');
  assert.equal(findInteractable(eye, { x: 1, y: 0, z: 0 }, [item], options), null, 'olhando para o lado');
  const wall = { minX: -1, maxX: 1, minY: 0, maxY: 2.7, minZ: 0.9, maxZ: 1.1 };
  assert.equal(findInteractable(eye, forward, [item], { ...options, occluders: () => [wall] }), null, 'parede');
  const closer = { id: 'b', point: { x: 0.05, y: 1.55, z: 1.7 }, range: 2.2 };
  assert.equal(findInteractable(eye, forward, [item, closer], options), closer, 'o mais centralizado');
});

test('E abre e fecha a porta por fora e por dentro, com animação', async (t) => {
  const { game, cabin, look, press, run } = await ready(t);
  const handle = cabin.plan.interactables[0].point;
  look(OUTSIDE.x, OUTSIDE.z, handle);
  assert.equal(game.interactions.prompt, 'Abrir a porta');
  press('KeyE');
  run(CONFIG.buildings[0].door.speed / 2);
  assert.ok(cabin.doorAmount > 0.2 && cabin.doorAmount < 0.8, `sem animação: ${cabin.doorAmount}`);
  run(0.6);
  assert.equal(cabin.doorAmount, 1);
  assert.equal(cabin.doorCollider.checkCollisions, false);
  assert.ok(Math.abs(cabin.doorMesh.rotation.y) > 1.5);
  assert.equal(game.interactions.prompt, 'Fechar a porta');
  // De dentro, olhando para a porta.
  look(INSIDE.x, INSIDE.z, handle);
  assert.equal(game.interactions.prompt, 'Fechar a porta');
  press('KeyE');
  run(0.7);
  assert.equal(cabin.doorAmount, 0);
  assert.equal(cabin.doorCollider.checkCollisions, true);
});

test('a porta não fecha em cima do jogador', async (t) => {
  const { game, cabin, look, press, run } = await ready(t);
  cabin.resetDoor(true);
  look(footprint.maxX + 0.15, doorZ, { x: footprint.maxX - 0.6, y: 1.2, z: doorZ });
  press('KeyE');
  run(0.7);
  assert.equal(cabin.doorOpen, true);
  assert.equal(game.interactions.message, CONFIG.interaction.blockedDoor);
});

test('entrar no vão enquanto a porta fecha não prende o jogador', async (t) => {
  const { game, cabin, press, run, look } = await ready(t);
  const handle = cabin.plan.interactables[0].point;
  for (const stop of [0.1, 0.02, -0.12]) {
    cabin.resetDoor(true);
    // Encostado do lado de fora, a ponto de entrar.
    look(footprint.maxX + 0.45, OUTSIDE.z, handle);
    press('KeyE');
    assert.equal(cabin.doorOpen, false);
    // Corre para o vão e para dentro dele (a folha ainda está fechando).
    for (let i = 0; i < 60 && game.player.position.x > footprint.maxX - stop; i += 1) {
      emit(game.input.window, 'keydown', { code: 'KeyW' });
      game.update(1 / 60);
    }
    emit(game.input.window, 'keyup', { code: 'KeyW' });
    run(1);
    // Onde quer que tenha parado, ainda consegue sair.
    const start = { ...game.player.position };
    for (let i = 0; i < 60; i += 1) game.player.update(1 / 60, intent(-1, 0), -Math.PI / 2);
    const moved = Math.hypot(game.player.position.x - start.x, game.player.position.z - start.z);
    assert.ok(moved > 0.5, `preso na porta (parou em ${stop}): andou ${moved.toFixed(2)}, porta ${cabin.doorAmount}`);
  }
});

test('E não faz nada no menu, na pausa, de longe ou através da parede', async (t) => {
  const { game, cabin, look, press, run } = await ready(t);
  const handle = cabin.plan.interactables[0].point;
  look(OUTSIDE.x + 4, OUTSIDE.z, handle);
  assert.equal(game.interactions.prompt, null);
  press('KeyE');
  assert.equal(cabin.doorOpen, false);
  look(OUTSIDE.x, OUTSIDE.z, handle);
  game.pause();
  press('KeyE');
  run(0.5);
  assert.equal(cabin.doorOpen, false);
  // Examinar através da parede: do lado de fora, olhando para a estante.
  await game.resume();
  const shelf = cabin.plan.interactables.find((i) => i.id.endsWith(':shelf'));
  look(shelf.point.x, footprint.minZ - 0.6, shelf.point);
  assert.notEqual(game.interactions.focus?.id, shelf.id);
});

test('cada objeto examinável mostra a própria mensagem, por tempo limitado', async (t) => {
  const { game, cabin, look, press, run, walk } = await ready(t);
  let hud;
  game.onHud = (state) => {
    hud = state;
  };
  const items = cabin.plan.interactables.filter((i) => i.type === 'examine');
  assert.ok(items.length >= 5);
  for (const item of items) {
    cabin.resetDoor(true);
    game.player.teleport(INSIDE.x, INSIDE.z);
    walk(item.point, 4);
    const p = game.player.position;
    look(p.x, p.z, item.point);
    assert.equal(game.interactions.focus?.id, item.id, `${item.id}: foco ${game.interactions.focus?.id}`);
    assert.equal(hud.prompt, `Examinar ${item.name}`);
    press('KeyE');
    run(0.1);
    assert.equal(hud.note, item.message);
  }
  run(CONFIG.interaction.messageDuration + 0.3);
  assert.equal(hud.note, null);
});

test('E não atrapalha os outros controles', async (t) => {
  const { game, dom, look, run, cabin } = await ready(t);
  look(OUTSIDE.x, OUTSIDE.z, cabin.plan.interactables[0].point);
  emit(dom.window, 'keydown', { code: 'KeyW' });
  emit(dom.window, 'keydown', { code: 'KeyE' });
  emit(dom.window, 'keydown', { code: 'KeyE', repeat: true });
  run(0.2);
  assert.ok(game.player.speed > 1, 'parou de andar');
  assert.equal(cabin.doorOpen, true, 'repetição não reabre nem fecha');
  emit(dom.window, 'keydown', { code: 'KeyF' });
  assert.equal(game.lights.flashlight.isOn, false);
  emit(dom.window, 'keydown', { code: 'KeyE', ctrlKey: true });
  assert.equal(cabin.doorOpen, true);
});

// ------------------------------------------------------------- Visão, pausa e recriação

test('paredes escondem uma entidade; pelas janelas e pela porta aberta ela é vista', async (t) => {
  const { cabin } = await ready(t);
  const eye = { x: center.x, y: 1.7, z: center.z };
  const north = cabin.plan.anchors.find((a) => a.kind === 'window' && a.z > footprint.maxZ);
  assert.equal(isBlocked({ ...eye, x: north.x }, { x: north.x, y: 1.5, z: north.z }, cabin.occluders), false, 'janela');
  // Mesma parede, longe da janela.
  assert.equal(isBlocked({ ...eye, x: footprint.maxX - 0.5 }, { x: footprint.maxX - 0.5, y: 1.5, z: north.z }, cabin.occluders), true, 'parede');
  const outside = { x: footprint.maxX + 3, y: 1.5, z: doorZ };
  assert.equal(isBlocked(eye, outside, cabin.occluders), true, 'porta fechada');
  cabin.resetDoor(true);
  assert.equal(isBlocked(eye, outside, cabin.occluders), false, 'porta aberta');
});

test('a pausa congela porta e chama; o menu fecha a porta e apaga a mensagem', async (t) => {
  const { game, cabin, look, press, run } = await ready(t);
  look(OUTSIDE.x, OUTSIDE.z, cabin.plan.interactables[0].point);
  press('KeyE');
  run(0.2);
  game.pause();
  const frozen = [cabin.doorAmount, cabin.lamp.intensity];
  run(2);
  assert.deepEqual([cabin.doorAmount, cabin.lamp.intensity], frozen);
  game.quitToMenu();
  assert.deepEqual([cabin.doorOpen, cabin.doorAmount, game.interactions.message], [false, 0, null]);
});

test('mudar a resolução dos sprites recria a cabana sem vazar e mantém a porta', async (t) => {
  const { game, cabin } = await ready(t);
  cabin.resetDoor(true);
  const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length, game.scene.lights.length];
  const before = count();
  const excluded = game.lights.ambient.excludedMeshes.length;
  await game.setSpriteResolution(0.5);
  await game.setSpriteResolution(1);
  assert.deepEqual(count(), before);
  assert.equal(game.lights.ambient.excludedMeshes.length, excluded);
  const rebuilt = game.buildings.buildings[0];
  assert.notEqual(rebuilt, cabin);
  assert.deepEqual([rebuilt.doorOpen, rebuilt.doorCollider.checkCollisions], [true, false]);
});

test('texturas ausentes não impedem a cabana (aparece o xadrez de alerta)', async (t) => {
  const { game } = createGame({
    loadImage: async (url) => {
      if (url.includes('cabin/')) throw new Error('404');
      const { loadImageFromDisk } = await import('../helpers/fakes.js');
      return loadImageFromDisk(url);
    },
  });
  t.after(() => game.dispose());
  await game.init();
  assert.equal(game.state, 'ready');
  assert.equal(game.spriteManager.getProblems().length, Object.keys(CONFIG.assets.buildingTextures).length);
});
