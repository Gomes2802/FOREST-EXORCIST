/** v0.4.1: qualidade gráfica, modo automático e geometria agrupada. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { buildAtlas, createChunkedBatch } from '../../src/graphics/batches.js';
import { BABYLON, createGame } from '../helpers/world.js';
import { FakeCanvas, createCanvas, loadImageFromDisk } from '../helpers/fakes.js';

async function ready(t) {
  const context = createGame();
  t.after(() => context.game.dispose());
  await context.game.init();
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) context.game.update(1 / fps);
  };
  return context;
}

const solid = (width, height, rgba) => {
  const canvas = new FakeCanvas(width, height);
  for (let i = 0; i < width * height; i += 1) canvas.data.set(rgba, i * 4);
  return canvas;
};

test('o atlas copia cada imagem pixel a pixel, sem sobreposição', () => {
  const records = [
    { id: 'a', canvas: solid(48, 88, [255, 0, 0, 255]) },
    { id: 'b', canvas: solid(20, 14, [0, 255, 0, 255]) },
    { id: 'c', canvas: solid(30, 24, [0, 0, 255, 128]) },
  ];
  const { canvas, rects } = buildAtlas(records, createCanvas);
  const boxes = [];
  for (const { id, canvas: source } of records) {
    const r = rects.get(id);
    const x = Math.round(r.u0 * canvas.width);
    const y = Math.round((1 - r.v1) * canvas.height);
    assert.deepEqual([r.width, r.height], [source.width, source.height]);
    assert.equal(Math.round(r.u1 * canvas.width) - x, source.width);
    for (const [px, py] of [[0, 0], [source.width - 1, source.height - 1]]) {
      assert.deepEqual(canvas.pixel(x + px, y + py), source.pixel(px, py), id);
    }
    // Borda transparente em volta: o filtro nearest nunca pega o vizinho.
    assert.equal(canvas.pixel(x - 1, y)[3], 0, `${id} sem margem`);
    boxes.push([x, y, source.width, source.height]);
  }
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
      assert.ok(apart, 'recortes sobrepostos');
    }
  }
});

test('regiões desenham um prefixo dos itens conforme a densidade', () => {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const items = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) + 0.5, z: Math.floor(i / 8) + 0.5, rank: (i * 7 % 40) / 40 }));
  const batch = createChunkedBatch(BABYLON, scene, {
    name: 'teste', items, chunkSize: 100, material: null, vertices: 4, indices: [0, 1, 2, 0, 2, 3],
    write(item, out) {
      for (let k = 0; k < 4; k += 1) {
        out.positions.push(item.x, 0, item.z);
        out.normals.push(0, 1, 0);
        out.uvs.push(0, 0);
      }
    },
  });
  const [chunk] = batch.chunks;
  assert.deepEqual(chunk.items.map((i) => i.rank), [...chunk.items.map((i) => i.rank)].sort((a, b) => a - b));
  batch.update({ x: 0, z: 0 }, 1000, () => 0.25);
  assert.equal(chunk.drawn, 10);
  assert.equal(chunk.mesh.subMeshes[0].indexCount, 60);
  batch.update({ x: 500, z: 0 }, 10);
  assert.equal(chunk.mesh.isEnabled(false), false);
  assert.equal(batch.drawnCount, 0);
  scene.dispose();
  engine.dispose();
});

test('cada nível de qualidade muda resolução e distâncias, nunca a jogabilidade', async (t) => {
  const { game } = await ready(t);
  assert.equal(game.quality, CONFIG.graphics.quality);
  const gameplay = () => ({
    colliders: game.forest.colliders.map((c) => [c.position.x, c.position.z, c.metadata.solidRadius]),
    occluders: game.forest.occluders.length,
    range: game.config.exorcism.range,
    walk: game.config.player.walkSpeed,
    hitbox: game.entity.boundingRadius,
  });
  const before = gameplay();
  const changes = [];
  game.onQualityChange = (change) => changes.push(change);
  const seen = [];
  for (const level of CONFIG.graphics.levels) {
    assert.equal(game.setQuality(level), true);
    const preset = CONFIG.graphics.presets[level];
    assert.equal(game.level, level);
    assert.equal(game.pixelRenderer.settings.renderScale, preset.renderScale);
    assert.equal(game.forest.detail, preset);
    assert.deepEqual(gameplay(), before, level);
    seen.push(game.forest.distances);
  }
  assert.ok(seen[0].far < seen.at(-1).far && seen[0].grass < seen.at(-1).grass);
  assert.deepEqual(changes.map((c) => c.level), CONFIG.graphics.levels);
  assert.equal(game.setQuality('ultra'), false);
  assert.equal(game.level, 'alto', 'nome inválido não muda nada');
});

test('as resoluções dos níveis mantêm 16:9', () => {
  for (const level of CONFIG.graphics.levels) {
    const scale = CONFIG.graphics.presets[level].renderScale;
    const width = Math.floor(CONFIG.display.width / scale);
    const height = Math.floor(CONFIG.display.height / scale);
    assert.ok(Math.abs(width / height - 16 / 9) < 0.01, `${level}: ${width}x${height}`);
    assert.ok(height >= 240, `${level}: resolução baixa demais`);
  }
});

test('qualidade sobrevive à troca de resolução dos sprites', async (t) => {
  const { game } = await ready(t);
  game.setQuality('muito-baixo');
  await game.setSpriteResolution(0.5);
  assert.equal(game.forest.detail, CONFIG.graphics.presets['muito-baixo']);
});

test('automática: lenta, desce um nível por vez e avisa; nunca sobe', async (t) => {
  const { game, run } = await ready(t);
  const { auto, levels } = CONFIG.graphics;
  let hud;
  game.onHud = (state) => {
    hud = state;
  };
  game.setQuality('auto');
  await game.play();
  run(auto.warmup + auto.window + 1, 60);
  assert.equal(game.level, auto.start, 'rápida: fica como está');

  run(auto.warmup + auto.window + 0.5, 15);
  const lower = levels[levels.indexOf(auto.start) - 1];
  assert.equal(game.level, lower);
  assert.match(hud.notice, /Qualidade gráfica reduzida para Baixa/);
  run(auto.noticeDuration + 0.5, 15);
  assert.ok(levels.indexOf(game.level) <= levels.indexOf(lower));

  run(30, 15);
  assert.equal(game.level, levels[0], 'para no nível mais leve');
  run(auto.noticeDuration + 1, 60);
  assert.equal(hud.notice, null, 'o aviso é temporário');
  run(20, 60);
  assert.equal(game.level, levels[0], 'não sobe sozinha');
});

test('automática não mede no menu nem pausada; escolha manual a desliga', async (t) => {
  const { game, run } = await ready(t);
  game.setQuality('auto');
  run(20, 10);
  assert.equal(game.level, CONFIG.graphics.auto.start, 'no menu não mede');
  await game.play();
  game.pause();
  run(20, 10);
  assert.equal(game.level, CONFIG.graphics.auto.start, 'pausado não mede');
  await game.resume();
  game.setQuality('alto');
  run(20, 10);
  assert.equal(game.level, 'alto');
});

test('quadros desenhados durante a troca de resolução dos sprites não falham', async (t) => {
  // Texturas lentas: a nova floresta demora a ficar pronta, e o jogo segue desenhando.
  const slow = async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return loadImageFromDisk(url);
  };
  const { game } = createGame({ loadImage: slow });
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  const rebuild = game.setSpriteResolution(0.5);
  let frames = 0;
  let done = false;
  rebuild.then(() => {
    done = true;
  });
  while (!done) {
    // Como no menu: mudar a neblina durante a troca força o recálculo das regiões.
    game.setFogDensity(frames % 2 ? 0.055 : 0.085);
    game.update(1 / 60);
    game.scene.render();
    frames += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await rebuild;
  assert.ok(frames > 3, `poucos quadros durante a troca: ${frames}`);
  game.update(1 / 60);
  game.scene.render();
});
