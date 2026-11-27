/** Etapa 3: noite, neblina, lanterna e integração com a câmera. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { viewDirection } from '../../src/world/lighting.js';
import { BABYLON, createGame } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';

async function ready(t) {
  const context = createGame();
  t.after(() => context.game.dispose());
  await context.game.init();
  context.run = (seconds) => {
    for (let i = 0; i < seconds * 60; i += 1) context.game.update(1 / 60);
  };
  return context;
}

test('a noite tem luz ambiente baixa, lua azulada e nenhuma sombra dinâmica', async (t) => {
  const { game } = await ready(t);
  const { ambient, moon } = game.lights;
  // Três luzes externas e a lamparina da cabana (que só alcança o interior).
  assert.equal(game.scene.lights.length, 4);
  const lamp = game.scene.getLightByName('cabin:lamp');
  assert.ok(lamp.includedOnlyMeshes.length > 0);
  assert.ok(lamp.includedOnlyMeshes.every((m) => m.name.startsWith('cabin:')), 'a lamparina vaza para fora');
  assert.ok(ambient.intensity > 0.1 && ambient.intensity < 1);
  for (const light of [ambient, moon]) assert.ok(light.diffuse.b > light.diffuse.r, `${light.name} não é azulada`);
  assert.ok(moon.direction.y < 0);
  assert.ok(game.scene.lights.every((l) => !l.getShadowGenerator()));
});

test('os sprites recebem só a lanterna; chão e trilhas, a lanterna e a noite já calculada', async (t) => {
  const { game } = await ready(t);
  const spriteMeshes = () => [
    ...game.forest.billboards.map((b) => b.mesh),
    ...game.forest.grass.flatMap((b) => b.chunks.map((c) => c.mesh)),
  ];
  const check = () => {
    const { ambient, moon, lantern } = game.lights;
    for (const mesh of spriteMeshes()) {
      if (mesh.material.disableLighting) continue;
      assert.equal(ambient.canAffectMesh(mesh), false, mesh.name);
      assert.equal(moon.canAffectMesh(mesh), false, mesh.name);
      assert.equal(lantern.canAffectMesh(mesh), true, mesh.name);
    }
    // Chão e trilhas são planos: luz ambiente + luar viram cor fixa, idêntica ao
    // que as duas luzes dariam a uma superfície voltada para cima.
    const up = -moon.direction.normalizeToNew().y;
    const expected = ambient.diffuse.scale(ambient.intensity).add(moon.diffuse.scale(moon.intensity * up));
    for (const mesh of [...game.forest.groundTiles, ...game.forest.trails]) {
      assert.equal(lantern.canAffectMesh(mesh), true, mesh.name);
      assert.equal(ambient.canAffectMesh(mesh) || moon.canAffectMesh(mesh), false, mesh.name);
      const emissive = mesh.material.emissiveColor;
      for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(emissive[channel] - expected[channel]) < 1e-6, mesh.name);
      assert.equal(mesh.material.disableLighting, false, mesh.name);
    }
    // Troncos caídos não são planos: continuam com as três luzes.
    for (const log of game.forest.logs) assert.ok([ambient, moon, lantern].every((l) => l.canAffectMesh(log)));
  };
  check();
  const scenery = game.forest.atlases.find((a) => a.ids.has('tree_01'));
  assert.equal(scenery.material.disableLighting, false);
  assert.equal(game.entity.mesh.material.disableLighting, true, 'brilho próprio');
  const excluded = game.lights.ambient.excludedMeshes.length;
  await game.setSpriteResolution(0.5);
  check();
  assert.equal(game.lights.ambient.excludedMeshes.length, excluded, 'lista de luzes vazou');
});

test('a neblina é progressiva, fria e igual ao horizonte', async (t) => {
  const { game } = await ready(t);
  const { scene } = game;
  assert.equal(scene.fogMode, BABYLON.Scene.FOGMODE_EXP2);
  assert.equal(scene.fogDensity, CONFIG.environment.fog.density);
  assert.ok(scene.fogColor.b > scene.fogColor.r);
  const visibility = (d) => Math.exp(-((d * scene.fogDensity) ** 2));
  assert.ok(visibility(4) > 0.9, 'neblina forte demais perto');
  assert.ok(visibility(12) > 0.5, 'a lanterna ficaria encoberta');
  assert.ok(visibility(CONFIG.forest.groundSize / 2 - CONFIG.player.boundaryRadius) < 0.02, 'fim do mapa visível');
  assert.ok(game.forest.groundTiles.every((tile) => tile.material.fogEnabled));
  assert.ok(game.forest.billboards.every((b) => b.mesh.material.fogEnabled));
});

test('céu, lua e silhuetas do horizonte acompanham o jogador, atrás da cena', async (t) => {
  const { game } = await ready(t);
  const { sky, backdrops } = game.forest;
  assert.ok(backdrops.length >= 2);
  game.player.teleport(6, -8);
  game.view.reset(game.player.position);
  game.update(1 / 60);
  for (const mesh of [sky, ...backdrops]) {
    assert.equal(mesh.renderingGroupId, 0);
    assert.equal(mesh.material.fogEnabled, false);
    assert.ok(Math.abs(mesh.position.x - game.view.camera.position.x) < 1e-6, mesh.name);
    assert.ok(Math.abs(mesh.position.z - game.view.camera.position.z) < 1e-6, mesh.name);
  }
  assert.equal(game.scene.getMeshByName('moon').renderingGroupId, 0);
  assert.ok(game.forest.groundTiles.every((tile) => tile.renderingGroupId === 1));
  assert.ok(game.forest.billboards.every((b) => b.mesh.renderingGroupId === 1));
  assert.ok(game.forest.grass.every((b) => b.chunks.every((c) => c.mesh.renderingGroupId === 1)));
});

test('a lanterna é um cone de alcance limitado, configurável', async (t) => {
  const { game } = await ready(t);
  const { lantern } = game.lights;
  const settings = CONFIG.lighting.lantern;
  assert.ok(lantern instanceof BABYLON.SpotLight);
  assert.equal(lantern.range, settings.range);
  assert.equal(lantern.angle, settings.angle);
  assert.equal(lantern.exponent, settings.exponent);
  assert.equal(lantern.intensity, settings.intensity);
  assert.ok(settings.range < 30 && settings.angle < Math.PI / 2);
});

test('a lanterna segue a posição e a direção da câmera', async (t) => {
  const { game } = await ready(t);
  await game.play();
  for (const [dx, dy] of [[0, 0], [600, 200], [-1500, -500], [0, 2000]]) {
    game.view.look(dx, dy);
    for (let i = 0; i < 60; i += 1) game.update(1 / 60);
    const { camera } = game.view;
    const forward = camera.getDirection(BABYLON.Axis.Z);
    const direction = game.lights.lantern.direction;
    assert.ok(BABYLON.Vector3.Dot(forward, direction.normalizeToNew()) > 0.999, `${forward} x ${direction}`);
    assert.ok(BABYLON.Vector3.Distance(camera.position, game.lights.lantern.position) < 0.6);
  }
});

test('viewDirection segue a convenção da câmera', () => {
  assert.deepEqual(viewDirection(0, 0), { x: 0, y: -0, z: 1 });
  assert.ok(viewDirection(Math.PI / 2, 0).x > 0.999);
  assert.ok(viewDirection(0, 0.5).y < 0, 'pitch positivo olha para baixo');
});

test('F liga e desliga a lanterna somente durante o jogo', async (t) => {
  const { game, dom } = await ready(t);
  const f = (props = {}) => emit(dom.window, 'keydown', { code: 'KeyF', ...props });
  const { flashlight, lantern } = game.lights;
  f();
  assert.equal(flashlight.isOn, true, 'no menu F não faz nada');
  await game.play();
  f();
  assert.equal(flashlight.isOn, false);
  assert.equal(lantern.intensity, 0);
  f({ repeat: true });
  f({ ctrlKey: true });
  assert.equal(flashlight.isOn, false, 'repetição e Ctrl+F são ignorados');
  game.update(1 / 60);
  assert.equal(lantern.intensity, 0);
  f();
  assert.equal(flashlight.isOn, true);
  assert.equal(lantern.intensity, CONFIG.lighting.lantern.intensity);

  f();
  game.pause();
  f();
  assert.equal(flashlight.isOn, false, 'pausado F não faz nada');
  await game.resume();
  assert.equal(flashlight.isOn, false, 'o estado sobrevive à pausa');
  game.pause();
  game.quitToMenu();
  assert.equal(flashlight.isOn, true, 'nova exploração começa com a lanterna ligada');
});
