import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraController } from '../../src/core/camera.js';
import { CONFIG } from '../../src/config.js';
import { BABYLON, createEmptyWorld, intent } from '../helpers/world.js';

function setup(t, overrides = {}) {
  const world = createEmptyWorld();
  t.after(world.dispose);
  const settings = { ...CONFIG.camera, ...overrides };
  const view = createCameraController(BABYLON, world.scene, settings, 1.7, [0, 0, 0]);
  /** Roda jogador e câmera juntos e devolve os deslocamentos do balanço. */
  const walk = (move, seconds, fps = 60) => {
    const samples = [];
    for (let i = 0; i < Math.round(seconds * fps); i += 1) {
      world.player.update(1 / fps, move, view.yaw);
      view.update(1 / fps, world.player);
      samples.push(view.bobOffset);
    }
    return samples;
  };
  return { ...world, view, settings, walk };
}

const peak = (samples) => Math.max(...samples.map((s) => Math.abs(s.up)));

test('o mouse gira a câmera nos dois eixos', (t) => {
  const { view, settings, walk } = setup(t);
  view.look(100, 50);
  walk(intent(), 0.5);
  assert.ok(Math.abs(view.camera.rotation.y - 100 * settings.mouseSensitivity) < 1e-6);
  assert.ok(Math.abs(view.camera.rotation.x - 50 * settings.mouseSensitivity) < 1e-6);
});

test('limita a rotação vertical e nunca inclina o horizonte', (t) => {
  const { view, walk } = setup(t);
  const limit = (80 * Math.PI) / 180;
  for (const direction of [1, -1]) {
    view.look(300, direction * 100000);
    walk(intent(), 0.5);
    assert.ok(Math.abs(view.camera.rotation.x - direction * limit) < 1e-6);
    assert.equal(view.camera.rotation.z, 0);
  }
  // Depois de bater no limite, o retorno é imediato.
  view.look(0, 100);
  assert.ok(view.pitch > -limit);
});

test('a rotação horizontal é livre e olhar para cima não muda a direção do corpo', (t) => {
  const { view, player, walk } = setup(t);
  view.look(100000, 0);
  assert.ok(view.yaw > Math.PI * 2);
  view.reset();
  view.look(0, -100000);
  walk(intent(1, 0), 1);
  assert.equal(view.yaw, 0);
  assert.ok(Math.abs(player.position.x) < 1e-6);
  assert.ok(player.position.z > 2.5);
  assert.ok(Math.abs(view.camera.position.y - 1.7) < 0.1);
});

test('a suavização é rápida e independente da taxa de quadros', (t) => {
  const { view, walk } = setup(t);
  const after = (fps) => {
    view.reset();
    view.look(200, 0);
    walk(intent(), 0.1, fps);
    return view.camera.rotation.y / view.yaw;
  };
  assert.ok(after(60) > 0.95);
  assert.ok(Math.abs(after(30) - after(120)) < 1e-6);
});

test('inversão do eixo vertical é configurável', (t) => {
  const { view } = setup(t, { invertY: true });
  view.look(0, 100);
  assert.ok(view.pitch < 0);
});

test('balanço só ao andar, maior ao correr, e volta suavemente ao parar', (t) => {
  const { view, settings, walk, player } = setup(t);
  assert.equal(peak(walk(intent(), 1)), 0);
  const walking = peak(walk(intent(1, 0), 2));
  player.reset();
  view.reset();
  const running = peak(walk(intent(1, 0, true), 2));
  assert.ok(walking > settings.bob.walkAmplitude * 0.8 && walking <= settings.bob.walkAmplitude + 1e-9);
  assert.ok(running > walking * 1.4);
  const stopping = walk(intent(), 1.5);
  for (let i = 1; i < stopping.length; i += 1) {
    assert.ok(Math.abs(stopping[i].up - stopping[i - 1].up) < 0.02, 'sem saltos ao parar');
  }
  assert.deepEqual(view.bobOffset, { side: 0, up: 0 });
  assert.equal(view.camera.position.y, 1.7);
});

test('empurrar o limite do terreno não gera balanço', (t) => {
  const { view, walk, player, settings } = setup(t);
  player.teleport(0, CONFIG.player.boundaryRadius);
  walk(intent(1, 0), 1);
  assert.deepEqual(view.bobOffset, { side: 0, up: 0 });
  assert.ok(settings);
});

test('amplitude zero desliga o balanço', (t) => {
  const { walk } = setup(t, { bob: { ...CONFIG.camera.bob, walkAmplitude: 0, runAmplitude: 0 } });
  assert.equal(peak(walk(intent(1, 0), 1)), 0);
});
