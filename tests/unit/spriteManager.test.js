import test from 'node:test';
import assert from 'node:assert/strict';
import { SpriteManager } from '../../src/graphics/spriteManager.js';
import { PixelRenderer } from '../../src/graphics/pixelRenderer.js';
import {
  FakeCanvas, createCanvas, createLogger, fetchJsonFromDisk, loadImageFromDisk, projectPath, readPngSize,
} from '../helpers/fakes.js';

const MANIFEST = 'assets/sprites/manifest.json';
const REQUIRED = ['tree_01', 'dead_tree_01', 'ghost_01', 'cross', 'bush_01', 'rock_01'];

function create({ loadImage = loadImageFromDisk, fetchJson = fetchJsonFromDisk, settings } = {}) {
  const logger = createLogger();
  const manager = new SpriteManager({
    pixelRenderer: new PixelRenderer(settings, { createCanvas }),
    loadImage,
    fetchJson,
    logger,
  });
  return { manager, logger };
}

test('carrega todos os sprites do manifesto a partir dos arquivos reais', async () => {
  const { manager, logger } = create();
  assert.equal(await manager.loadManifest(MANIFEST), true);
  for (const id of REQUIRED) assert.ok(manager.has(id), `falta ${id}`);
  const records = await manager.loadAll();
  assert.deepEqual(records.filter((r) => r.status !== 'loaded').map((r) => r.id), []);
  assert.deepEqual(logger.warnings, []);
});

test('os PNGs provisórios são RGBA (com transparência) e pequenos', async () => {
  const { sprites } = await fetchJsonFromDisk(MANIFEST);
  for (const { file } of Object.values(sprites)) {
    const png = readPngSize(projectPath(`assets/sprites/${file}`));
    assert.equal(png.colorType, 6, file);
    assert.ok(Math.max(png.width, png.height) <= 256, file);
  }
});

test('imagens de qualquer dimensão mantêm a proporção no mundo e na textura', async () => {
  const { manager } = create({ loadImage: async () => new FakeCanvas(900, 300) });
  manager.register('largo', { file: 'environment/largo.png', worldHeight: 2 });
  const record = await manager.load('largo');
  assert.equal(record.worldWidth, 6);
  assert.equal(record.worldHeight, 2);
  assert.deepEqual([record.textureWidth, record.textureHeight], [96, 32]);
});

test('sprite ausente vira alternativa visual e é registrado uma única vez', async () => {
  const { manager, logger } = create({ loadImage: async () => { throw new Error('404'); } });
  manager.register('sumido', { file: 'items/sumido.png', worldHeight: 2 });
  const record = await manager.load('sumido');
  await manager.load('sumido');
  assert.equal(record.status, 'fallback');
  assert.deepEqual(record.canvas.pixel(0, 0), [255, 0, 255, 255]);
  assert.equal(record.worldHeight, 2);
  assert.equal(logger.warnings.length, 1);
  assert.equal(manager.getProblems()[0].id, 'sumido');
});

test('ID desconhecido não quebra o jogo', async () => {
  let requests = 0;
  const { manager } = create({ loadImage: async () => { requests += 1; return new FakeCanvas(1, 1); } });
  assert.equal((await manager.load('nao_existe')).status, 'fallback');
  assert.equal(manager.get('outro').status, 'fallback');
  assert.equal(requests, 0);
});

test('ID com pasta é resolvido por convenção, sem registro', async () => {
  const urls = [];
  const { manager } = create({ loadImage: async (url) => { urls.push(url); return new FakeCanvas(8, 8); } });
  assert.equal((await manager.load('environment/carvalho')).status, 'loaded');
  assert.deepEqual(urls, ['assets/sprites/environment/carvalho.png']);
});

test('pedidos simultâneos carregam o arquivo uma só vez', async () => {
  let requests = 0;
  const { manager } = create({ loadImage: async () => { requests += 1; return new FakeCanvas(8, 8); } });
  manager.register('a', { file: 'a.png' });
  const [first, second] = await Promise.all([manager.load('a'), manager.load('a')]);
  assert.equal(first, second);
  assert.equal(requests, 1);
});

test('recusa endereços remotos e caminhos fora da pasta', async () => {
  const { manager } = create();
  for (const file of ['https://exemplo.com/a.png', '//exemplo.com/a.png', '../segredo.png', 'data:image/png;base64,AA']) {
    assert.throws(() => manager.register('x', { file }), /não permitido/);
  }
  assert.equal((await manager.load('../../etc/x')).status, 'fallback');
  await assert.rejects(manager.loadTexture('https://exemplo.com/a.png'));
});

test('manifesto quebrado é informado sem lançar exceção', async () => {
  const { manager } = create({ fetchJson: async () => { throw new SyntaxError('JSON inválido'); } });
  assert.equal(await manager.loadManifest(MANIFEST), false);
  assert.equal(manager.getProblems().length, 1);
});

test('uma entrada inválida não impede as demais', async () => {
  const { manager } = create({
    fetchJson: async () => ({ sprites: { ruim: { file: '/etc/a.png' }, bom: { file: 'a.png' } } }),
  });
  assert.equal(await manager.loadManifest(MANIFEST), true);
  assert.deepEqual(manager.ids(), ['bom']);
});

test('grupos permitem acrescentar variações só pelo manifesto', async () => {
  const { manager } = create();
  await manager.loadManifest(MANIFEST);
  manager.register('tree_02', { file: 'environment/tree_02.png', group: 'tree' });
  assert.deepEqual(manager.idsByGroup('tree'), ['tree_01', 'tree_02']);
});

test('repixelate reaplica a resolução sem recarregar arquivos', async () => {
  let requests = 0;
  const { manager } = create({ loadImage: async () => { requests += 1; return new FakeCanvas(320, 320); } });
  manager.register('a', { file: 'a.png', worldHeight: 4 });
  assert.equal((await manager.load('a')).textureHeight, 64);
  manager.pixelRenderer.configure({ resolutionScale: 0.5 });
  manager.repixelate();
  assert.equal(manager.get('a').textureHeight, 32);
  assert.equal(requests, 1);
});
