import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelRenderer, processPixels, nearestPowerOfTwo } from '../../src/graphics/pixelRenderer.js';
import { FakeCanvas, createCanvas, loadBabylon } from '../helpers/fakes.js';

const renderer = (settings) => new PixelRenderer(settings, { createCanvas });

test('reduz imagens grandes pela altura no mundo, preservando a proporção', () => {
  assert.deepEqual(renderer().computeSize(1000, 2000, { worldHeight: 4 }), { width: 32, height: 64 });
  assert.deepEqual(renderer().computeSize(1920, 1080, { worldHeight: 4 }), { width: 114, height: 64 });
});

test('nunca amplia uma imagem menor que a resolução desejada', () => {
  assert.deepEqual(renderer({ resolutionScale: 2 }).computeSize(16, 24, { worldHeight: 5 }), { width: 16, height: 24 });
});

test('aplica escala global, altura fixa e tamanho máximo', () => {
  assert.deepEqual(renderer({ resolutionScale: 0.5 }).computeSize(640, 640, { worldHeight: 4 }), { width: 32, height: 32 });
  assert.deepEqual(renderer().computeSize(400, 800, { pixelHeight: 100, worldHeight: 4 }), { width: 50, height: 100 });
  assert.deepEqual(renderer({ maxTextureSize: 128 }).computeSize(4000, 1000, {}), { width: 128, height: 32 });
});

test('rejeita dimensões inválidas', () => {
  assert.throws(() => renderer().computeSize(0, 10), RangeError);
});

test('configure ignora valores inválidos e limita extremos', () => {
  const pixel = renderer();
  pixel.configure({ renderScale: 99, pixelsPerUnit: Number.NaN, desconhecido: 3 });
  assert.equal(pixel.settings.renderScale, 6);
  assert.equal(pixel.settings.pixelsPerUnit, 16);
  assert.equal('desconhecido' in pixel.settings, false);
});

test('pixeliza sem suavização, sem criar cores intermediárias e mantendo o alfa', () => {
  const source = new FakeCanvas(4, 4);
  for (let i = 0; i < 16; i += 1) {
    source.data.set(i % 4 < 2 ? [255, 0, 0, 255] : [0, 0, 255, 90], i * 4);
  }
  const result = renderer().pixelate(source, { pixelHeight: 2 });
  assert.deepEqual([result.width, result.height], [2, 2]);
  assert.equal(result.getContext().imageSmoothingEnabled, false);
  assert.deepEqual(result.pixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(result.pixel(1, 1), [0, 0, 255, 90]);
});

test('alfa binário e posterização são opcionais', () => {
  const data = new Uint8ClampedArray([100, 200, 30, 127, 100, 200, 30, 128]);
  processPixels(data, { alphaCutoff: 128, colorLevels: 2 });
  assert.deepEqual([...data], [0, 255, 0, 0, 0, 255, 0, 255]);
});

test('texturas repetidas podem ser ajustadas para potência de 2', () => {
  const result = renderer().pixelate(new FakeCanvas(100, 60), { powerOfTwo: true });
  assert.deepEqual([result.width, result.height], [128, 64]);
  assert.equal(nearestPowerOfTwo(1), 1);
});

test('filtros de textura usam nearest', () => {
  const BABYLON = loadBabylon();
  const sprite = renderer().getSampling(BABYLON, 'sprite');
  assert.equal(sprite.samplingMode, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  assert.equal(sprite.generateMipMaps, false);
  assert.equal(sprite.wrap, BABYLON.Texture.CLAMP_ADDRESSMODE);
  const surface = renderer().getSampling(BABYLON, 'surface');
  assert.equal(surface.samplingMode, BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR);
  assert.equal(surface.wrap, BABYLON.Texture.WRAP_ADDRESSMODE);
});

test('motor sem antialias, resolução reduzida e canvas ampliado sem suavização', () => {
  const pixel = renderer({ renderScale: 3 });
  assert.equal(pixel.getEngineOptions().antialias, false);
  const canvas = { style: {} };
  let level = 0;
  pixel.applyToEngine({ setHardwareScalingLevel: (v) => { level = v; }, getRenderingCanvas: () => canvas });
  assert.equal(level, 3);
  assert.equal(canvas.style.imageRendering, 'pixelated');
});
