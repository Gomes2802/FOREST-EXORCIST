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
  assert.equal(game.scene.lights.length, 3);
  assert.ok(ambient.intensity > 0.1 && ambient.intensity < 1);
  for (const light of [ambient, moon]) assert.ok(light.diffuse.b > light.diffuse.r, `${light.name} não é azulada`);
  assert.ok(moon.direction.y < 0);
  assert.ok(game.scene.lights.every((l) => !l.getShadowGenerator()));
});

test('os sprites recebem só a lanterna; chão e trilhas recebem todas as luzes', async (t) => {
  const { game } = await ready(t);
  const check = () => {
    const { ambient, moon, lantern } = game.lights;
    for (const base of [...game.forest.bases.values(), ...game.forest.grass]) {
      if (base.material.disableLighting) continue;
      assert.equal(ambient.canAffectMesh(base), false, base.name);
      assert.equal(moon.canAffectMesh(base), false, base.name);
      assert.equal(lantern.canAffectMesh(base), true, base.name);
    }
    for (const mesh of [game.forest.ground, ...game.forest.trails]) {
      assert.ok([ambient, moon, lantern].every((l) => l.canAffectMesh(mesh)), mesh.name);
    }
  };
  check();
  assert.equal(game.forest.bases.get('tree_01').material.disableLighting, false);
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
  assert.ok(game.forest.ground.material.fogEnabled);
  assert.ok([...game.forest.bases.values()].every((b) => b.material.fogEnabled));
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
  assert.equal(game.forest.ground.renderingGroupId, 1);
  assert.ok(game.forest.objects.every((o) => o.sourceMesh.renderingGroupId === 1));
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
