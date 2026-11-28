/** Etapa 7 no jogo: documentos no cenário, leitura, caderno, avisos e desempenho. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { insideBuilding, planBuildings } from '../../src/world/buildings/index.js';
import { touchesBox } from '../../src/systems/interact.js';
import { distanceToPaths } from '../../src/world/environment.js';
import { createGame } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';

const { documents } = CONFIG.investigation;
const [plan] = planBuildings(CONFIG);

async function ready(t, options) {
  const context = createGame(options);
  const { game, dom } = context;
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  context.hud = null;
  context.views = [];
  game.onHud = (state) => {
    context.hud = state;
  };
  game.onNotebook = (view) => context.views.push(view);
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) game.update(1 / fps);
  };
  context.press = (code, extra) => {
    emit(dom.window, 'keydown', { code, ...extra });
    emit(dom.window, 'keyup', { code });
  };
  context.item = (id) => [...game.buildings.buildings.flatMap((b) => b.plan.interactables), ...game.buildings.props]
    .find((i) => i.documentId === id);
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
  /**
   * Leva o jogador a um ponto de onde se lê o documento e olha para ele.
   * @returns {boolean} achou um lugar livre com o documento em foco
   */
  context.approach = (id) => {
    const target = context.item(id);
    const solids = plan.solids;
    game.buildings.buildings[0].resetDoor(false);
    for (const distance of [1.1, 0.9, 1.3, 0.7, 1.5]) {
      for (let turn = 0; turn < 24; turn += 1) {
        const angle = (turn / 24) * Math.PI * 2;
        const x = target.point.x + Math.sin(angle) * distance;
        const z = target.point.z + Math.cos(angle) * distance;
        if (solids.some((s) => touchesBox({ x, z }, CONFIG.player.radius, s))) continue;
        if (game.forest.occluders.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + CONFIG.player.radius)) continue;
        context.look(x, z, target.point);
        if (game.interactions.focus?.documentId === id) return true;
      }
    }
    return false;
  };
  return context;
}

test('os documentos ficam na cabana, fora dela e nas trilhas, em lugares alcançáveis', async (t) => {
  const { game, item } = await ready(t);
  const places = { inside: 0, outside: 0, forest: 0 };
  for (const doc of documents) {
    const { point } = item(doc.id);
    assert.ok(Math.hypot(point.x, point.z) < CONFIG.player.boundaryRadius - 1.5 || doc.place.building, `${doc.id} fora do mapa`);
    if (!doc.place.building) {
      places.forest += 1;
      const path = Math.min(...CONFIG.forest.paths.map((p) => distanceToPaths(point.x, point.z, [p]) - p.halfWidth));
      assert.ok(path < 0.2, `${doc.id} longe das trilhas`);
      for (const o of game.forest.occluders) {
        assert.ok(Math.hypot(o.x - point.x, o.z - point.z) > o.radius + 0.4, `${doc.id} dentro de um obstáculo`);
      }
    } else if (doc.place.outdoor) places.outside += 1;
    else places.inside += 1;
    if (doc.place.building) assert.equal(insideBuilding([plan], point.x, point.z), !doc.place.outdoor, doc.id);
  }
  assert.ok(places.inside >= 2 && places.outside >= 1 && places.forest >= 3, JSON.stringify(places));
});

test('cada documento fica em foco de perto, com a ação certa, e E abre a leitura', async (t) => {
  const context = await ready(t);
  const { game, press, approach, views } = context;
  for (const doc of documents) {
    assert.ok(approach(doc.id), `${doc.id}: não foi possível mirar`);
    const verb = doc.verb === 'examine' ? 'Examinar' : 'Ler';
    assert.equal(context.hud.prompt, `${verb} ${doc.name}`);
    press('KeyE');
    assert.equal(game.mode, 'reading', doc.id);
    assert.equal(views.at(-1).document, doc.id);
    assert.equal(game.investigation.has(doc.id), true);
    await game.closeNotebook();
    assert.equal(game.mode, 'playing');
  }
  assert.equal(game.investigation.records().length, documents.length);
});

test('a leitura congela jogador, entidades, porta, cruz e tempo; fechar retoma tudo igual', async (t) => {
  const { game, dom, input, press, approach, run } = await ready(t);
  approach('cruz');
  game.entities.get('ghost').haunting.summon(1.3, 11, { pinned: true });
  emit(dom.window, 'keydown', { code: 'KeyW' });
  game.lights.flashlight.toggle();
  press('KeyE');
  assert.equal(game.mode, 'reading');
  assert.equal(input.mode, null, 'os controles continuam ativos');
  const snapshot = () => JSON.stringify([
    game.player.position, game.view.camera.position.asArray(), game.view.camera.rotation.asArray(),
    game.entity.state, game.entity.mesh.position.asArray(), game.cross.amount, game.buildings.buildings[0].doorAmount,
    game.buildings.buildings[0].lamp.intensity, game.lights.flashlight.isOn, game.playTime,
  ]);
  const frozen = snapshot();
  input.look.dx = 300;
  for (const code of ['KeyW', 'KeyF', 'ShiftLeft', 'Escape']) press(code);
  emit(dom.element, 'pointerdown', { button: 0 });
  run(3);
  assert.equal(snapshot(), frozen);
  assert.equal(input.isPrimaryHeld, false);
  await game.closeNotebook();
  assert.equal(game.mode, 'playing');
  assert.deepEqual(input.getIntent(), { forward: 0, right: 0, run: false }, 'tecla ficou presa');
  assert.equal(game.lights.flashlight.isOn, false);
  press('KeyF');
  assert.equal(game.lights.flashlight.isOn, true);
});

test('reabrir um documento não duplica o registro nem repete avisos', async (t) => {
  const context = await ready(t);
  const { game, press, approach, run } = context;
  approach('diario');
  press('KeyE');
  const [{ time }] = game.investigation.records();
  await game.closeNotebook();
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) {
    run(0.5);
    if (context.hud.toast) seen.add(context.hud.toast);
  }
  assert.equal([...seen].filter((text) => text.includes('Novo registro')).length, 1, [...seen].join('|'));
  assert.equal(context.hud.toast, null);
  approach('diario');
  press('KeyE');
  await game.closeNotebook();
  run(0.2);
  assert.equal(context.hud.toast, null);
  assert.deepEqual(game.investigation.records().map((r) => [r.id, r.time]), [['diario', time]]);
});

test('J abre o caderno e congela o jogo; só mostra o que foi encontrado', async (t) => {
  const { game, input, press, run, views } = await ready(t);
  run(2);
  press('KeyJ', { repeat: true });
  assert.equal(game.mode, 'playing');
  press('KeyJ', { ctrlKey: true });
  assert.equal(game.mode, 'playing');
  press('KeyJ');
  assert.equal(game.mode, 'journal');
  assert.equal(input.mode, null);
  assert.deepEqual(views.at(-1), { mode: 'journal', document: null });
  assert.deepEqual(game.investigation.records(), []);
  const time = game.playTime;
  run(2);
  assert.equal(game.playTime, time);
  assert.equal(game.openJournal(), undefined);
  await game.closeNotebook();
  assert.equal(game.mode, 'playing');
});

test('o caderno e a leitura não abrem no menu nem na pausa; o menu apaga os registros', async (t) => {
  const { game, press } = await ready(t);
  game.openDocument('diario');
  await game.closeNotebook();
  game.pause();
  press('KeyJ');
  game.openJournal();
  game.openDocument('marco');
  assert.equal(game.mode, 'paused');
  assert.equal(game.investigation.records().length, 1, 'a pausa apagou ou criou registros');
  await game.resume();
  assert.equal(game.investigation.records().length, 1);
  game.quitToMenu();
  game.openJournal();
  assert.equal(game.mode, 'menu');
  assert.deepEqual(game.investigation.records(), []);
});

test('sem captura do ponteiro, fechar volta ao modo de arrastar', async (t) => {
  const { game, input } = await ready(t, { lock: 'unsupported' });
  assert.equal(input.mode, 'drag');
  game.openJournal();
  await game.closeNotebook();
  assert.deepEqual([game.mode, input.mode], ['playing', 'drag']);
});

test('se o navegador negar a captura ao fechar, o jogo fica pausado e o registro permanece', async (t) => {
  const { game, dom } = await ready(t);
  game.openDocument('diario');
  await Promise.resolve();
  dom.lock = 'deny';
  await game.closeNotebook();
  assert.equal(game.mode, 'paused');
  assert.equal(game.investigation.has('diario'), true);
});

test('entrar na cabana, examinar objetos e exorcizar atualizam objetivos e descobertas', async (t) => {
  const { game, input, run, look, press, item } = await ready(t);
  const done = (id) => game.investigation.objectives().find((o) => o.id === id)?.done;
  assert.equal(done('cabana'), false);
  game.player.teleport(plan.center.x, plan.center.z);
  game.view.reset(game.player.position);
  run(0.2);
  assert.equal(done('cabana'), true);
  const portrait = game.buildings.buildings[0].plan.interactables.find((i) => i.id === 'cabin:portrait');
  look(portrait.point.x + 1.2, portrait.point.z, portrait.point);
  press('KeyE');
  assert.ok(game.investigation.discoveries().some((d) => d.includes('retrato')));
  assert.equal(game.mode, 'playing', 'examinar um móvel não abre a leitura');
  assert.ok(item('foto'));

  game.entities.reset();
  game.entity.reset();
  game.haunting.summon(1.3, 11, { pinned: true });
  look(0.5, 6, { x: 1.3, y: 1.6, z: 11 });
  game.selectSlot(1);
  input.isPrimaryHeld = true;
  run(CONFIG.exorcism.duration + 1.5);
  assert.equal(game.entity.state, 'exorcised');
  assert.equal(done('exorcismo'), true);
  assert.ok(game.investigation.discoveries().some((d) => d.includes('Expulsei')));
});

test('abrir um documento no meio de um exorcismo o interrompe como a pausa e guarda o progresso', async (t) => {
  const { game, input, run, look } = await ready(t);
  game.haunting.summon(1.3, 11, { pinned: true });
  look(0.5, 6, { x: 1.3, y: 1.6, z: 11 });
  game.selectSlot(1);
  input.isPrimaryHeld = true;
  run(2);
  const { progress } = game.entity;
  assert.ok(progress > 0.1);
  game.openDocument('diario');
  run(5);
  assert.equal(game.entity.progress, progress);
  await game.closeNotebook();
  input.isPrimaryHeld = true;
  run(CONFIG.exorcism.duration + 1);
  assert.equal(game.entity.state, 'exorcised');
});

test('com a cena congelada o 3D não é redesenhado a cada quadro', async (t) => {
  const { game } = await ready(t);
  let renders = 0;
  const render = game.scene.render.bind(game.scene);
  game.scene.render = () => {
    renders += 1;
    render();
  };
  const frames = (n) => {
    renders = 0;
    for (let i = 0; i < n; i += 1) game.renderFrame();
    return renders;
  };
  assert.equal(frames(10), 10, 'jogando');
  for (const open of [() => game.openJournal(), () => game.openDocument('diario'), () => game.pause()]) {
    open();
    assert.ok(frames(30) <= 2, `redesenhou ${renders} vezes`);
    game.resize();
    assert.ok(frames(30) >= 1 && renders <= 2, 'redimensionar precisa redesenhar uma vez');
    if (game.mode === 'paused') await game.resume();
    else await game.closeNotebook();
    assert.equal(frames(5), 5);
  }
});

test('as pistas custam pouco: nada a mais na cabana e só uma malha pequena por pista da floresta', async (t) => {
  const { game, run, look } = await ready(t);
  const [cabin] = game.buildings.buildings;
  assert.ok(cabin.meshes.length <= 12, `${cabin.meshes.length}`);
  const outdoor = documents.filter((d) => !d.place.building);
  assert.equal(game.buildings.propMeshes.length, outdoor.length);
  assert.equal(new Set(game.buildings.propMeshes.map((m) => m.material)).size, 1);
  for (const mesh of game.buildings.propMeshes) {
    assert.ok(mesh.getTotalVertices() <= 400, `${mesh.name}: ${mesh.getTotalVertices()}`);
    assert.equal(cabin.lamp.canAffectMesh(mesh), false);
    assert.equal(mesh.isWorldMatrixFrozen, true);
  }
  const { drawDistance } = CONFIG.investigation;
  for (const [x, z] of [[0, 0], [-15, -9], [0, 28]]) {
    look(x, z, { x, z: z + 10 });
    run(0.2);
    const { camera } = game.view;
    for (const mesh of game.buildings.propMeshes) {
      const { center } = mesh.metadata;
      const distance = Math.hypot(center.x - camera.position.x, center.z - camera.position.z);
      // Folga de 1 unidade: a lista só é refeita depois de o jogador andar isso.
      if (distance > drawDistance + 1) assert.equal(mesh.isEnabled(), false, `${mesh.name} ligada a ${distance}`);
      else if (distance < drawDistance - 1) assert.equal(mesh.isEnabled(), true, `${mesh.name} desligada a ${distance}`);
    }
  }
  assert.ok(game.buildings.propMeshes.some((m) => !m.isEnabled()), 'nenhuma pista distante foi desligada');
});

test('explorar não cria malhas, materiais ou texturas, e a recriação não vaza as pistas', async (t) => {
  const { game, run } = await ready(t);
  const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length, game.scene.lights.length];
  const before = count();
  for (const doc of documents) {
    game.openDocument(doc.id);
    await game.closeNotebook();
    run(0.1);
  }
  assert.deepEqual(count(), before);
  const excluded = game.lights.ambient.excludedMeshes.length;
  await game.setSpriteResolution(0.5);
  await game.setSpriteResolution(1);
  assert.deepEqual(count(), before);
  assert.equal(game.lights.ambient.excludedMeshes.length, excluded);
});
