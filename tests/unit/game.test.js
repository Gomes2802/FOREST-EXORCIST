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
  assert.deepEqual(game.scene.lights.map((l) => l.name), ['ambient', 'moonlight', 'lantern', 'cabin:lamp']);
  assert.ok(game.scene.getMeshByName('ground:0,0'));
  assert.ok(game.scene.getMeshByName('moon'));
  const sprites = game.forest.billboards.reduce((sum, batch) => sum + batch.sprites.length, 0);
  assert.equal(sprites, game.forest.placements.filter((p) => p.kind === 'billboard').length);
  assert.ok(sprites > 700);
  // Só os troncos caídos usam instâncias (poucos); a vegetação fica agrupada.
  const instances = game.scene.meshes.filter((m) => m instanceof BABYLON.InstancedMesh);
  assert.ok(instances.every((m) => m.name.startsWith('log_')), instances.map((m) => m.name).join());
  assert.ok(game.scene.meshes.every((m) => !m.hasThinInstances));
  assert.deepEqual(Object.keys(game.scene.activeCamera.inputs.attached), []);
  assert.equal(game.mode, 'menu');
  assert.deepEqual(logger.warnings, []);

  game.renderFrame();
  game.renderFrame();
});

test('sprites agrupados mantêm proporção, pivô na base e materiais coerentes', async (t) => {
  const { game, spriteManager } = createGame();
  t.after(() => game.dispose());
  await game.init();
  game.update(1 / 60);

  for (const batch of game.forest.billboards) {
    batch.sprites.forEach((s) => {
      const record = spriteManager.get(s.sprite);
      const aspect = s.width / s.placement.stretch / s.height;
      assert.ok(Math.abs(aspect - record.aspect) < 1e-6, `proporção de ${s.sprite}`);
      assert.equal(s.y, s.placement.position[1], `pivô de ${s.sprite}`);
    });
  }
  for (const atlas of game.forest.atlases) {
    const { material } = atlas;
    const expected = atlas.alphaMode === 'blend'
      ? BABYLON.Material.MATERIAL_ALPHABLEND
      : BABYLON.Material.MATERIAL_ALPHATEST;
    assert.equal(material.transparencyMode, expected, atlas.key);
    assert.equal(material.diffuseTexture.samplingMode, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    assert.equal(material.diffuseTexture.noMipmap, true);
    assert.equal(material.useAlphaFromDiffuseTexture, true, `transparência de ${atlas.key}`);
    for (const id of atlas.ids) {
      const record = spriteManager.get(id);
      assert.equal(atlas.alphaMode, record.definition.alphaMode, id);
    }
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
