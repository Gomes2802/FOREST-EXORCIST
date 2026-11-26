/** Inicialização do jogo e da cena 3D com o NullEngine (sem placa de vídeo). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { planForest } from '../../src/world/forest.js';
import { distanceToPaths } from '../../src/world/environment.js';
import { BABYLON, createGame } from '../helpers/world.js';

test('inicializa o jogo e monta a cena 3D', async (t) => {
  const { game, logger } = createGame();
  t.after(() => game.dispose());
  await game.init();

  assert.equal(game.state, 'ready');
  assert.equal(game.scene.activeCamera.name, 'player');
  assert.equal(game.scene.activeCamera.position.y, CONFIG.player.eyeHeight);
  assert.equal(game.scene.fogMode, BABYLON.Scene.FOGMODE_EXP2);
  assert.deepEqual(game.scene.lights.map((l) => l.name), ['ambient', 'moonlight', 'lantern']);
  assert.ok(game.scene.getMeshByName('ground'));
  assert.ok(game.scene.getMeshByName('moon'));
  assert.equal(game.forest.objects.length, game.forest.placements.filter((p) => p.kind === 'billboard').length);
  assert.ok(game.forest.objects.length > 700);
  assert.deepEqual(Object.keys(game.scene.activeCamera.inputs.attached), []);
  assert.equal(game.mode, 'menu');
  assert.deepEqual(logger.warnings, []);

  game.renderFrame();
  game.renderFrame();
});

test('sprites usam billboard, instâncias e materiais coerentes', async (t) => {
  const { game, spriteManager } = createGame();
  t.after(() => game.dispose());
  await game.init();

  assert.ok(game.forest.objects.every((o) => o.billboardMode === BABYLON.TransformNode.BILLBOARDMODE_Y));
  for (const [id, base] of game.forest.bases) {
    const record = spriteManager.get(id);
    const size = base.getBoundingInfo().boundingBox.extendSize;
    assert.ok(Math.abs(size.x / size.y - record.aspect) < 1e-6, `proporção de ${id}`);
    assert.ok(Math.abs(base.getBoundingInfo().boundingBox.minimum.y) < 1e-6, `pivô de ${id}`);
    const expected = record.definition.alphaMode === 'blend'
      ? BABYLON.Material.MATERIAL_ALPHABLEND
      : BABYLON.Material.MATERIAL_ALPHATEST;
    assert.equal(base.material.transparencyMode, expected, id);
    assert.equal(base.material.diffuseTexture.samplingMode, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    assert.equal(base.material.useAlphaFromDiffuseTexture, true, `transparência de ${id}`);
  }
});

test('a cena inicia mesmo sem nenhuma imagem disponível', async (t) => {
  const { game, spriteManager } = createGame({ loadImage: async () => { throw new Error('404'); } });
  t.after(() => game.dispose());
  await game.init();
  assert.equal(game.state, 'ready');
  assert.ok(spriteManager.getProblems().length >= 7);
  game.renderFrame();
});

test('ciclo start/stop e estados inválidos', async (t) => {
  const { game } = createGame();
  t.after(() => game.dispose());
  assert.throws(() => game.start(), /estado/);
  await game.init();
  await assert.rejects(game.init(), /estado/);
  game.start();
  game.start();
  assert.equal(game.state, 'running');
  game.stop();
  assert.equal(game.state, 'ready');
});

test('falha ao criar o motor 3D é propagada', async () => {
  const { game } = createGame({ createEngine: () => { throw new Error('WebGL not supported'); } });
  await assert.rejects(game.init(), /WebGL/);
  assert.equal(game.state, 'failed');
});

test('trocar resolução repetidamente recria a floresta sem vazar recursos', async (t) => {
  const { game } = createGame();
  t.after(() => game.dispose());
  await game.init();
  const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length];
  const before = count();
  await Promise.all([game.setSpriteResolution(0.5), game.setSpriteResolution(0.75), game.setSpriteResolution(1)]);
  assert.deepEqual(count(), before);
});

test('o planejamento da floresta é determinístico e mantém a trilha livre', () => {
  const groups = (group) => [`${group}_x`];
  const first = planForest(CONFIG.forest, groups);
  assert.deepEqual(first, planForest(CONFIG.forest, groups));
  const blocked = first
    .filter((p) => !p.fixed)
    .filter((p) => distanceToPaths(p.position[0], p.position[2], CONFIG.forest.paths) < CONFIG.forest.pathHalfWidth * 0.8);
  assert.equal(blocked.length, 0);
  assert.equal(planForest(CONFIG.forest, () => []).length, CONFIG.forest.landmarks.length);
});
