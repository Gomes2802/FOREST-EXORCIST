import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredVelocity } from '../../src/player/player.js';
import { createEmptyWorld, intent, simulate } from '../helpers/world.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} esperado ${expected}, obtido ${actual}`);

function withWorld(t, overrides) {
  const world = createEmptyWorld(overrides);
  t.after(world.dispose);
  return world;
}

const CASES = [
  ['frente', intent(1, 0), 0, 1],
  ['trás', intent(-1, 0), 0, -1],
  ['esquerda', intent(0, -1), -1, 0],
  ['direita', intent(0, 1), 1, 0],
];

for (const [name, move, dirX, dirZ] of CASES) {
  test(`movimento: ${name}`, (t) => {
    const { player, settings } = withWorld(t);
    simulate(player, move, { seconds: 2 });
    const distance = settings.walkSpeed * 2;
    close(player.position.x, dirX * distance, 0.25, 'x');
    close(player.position.z, dirZ * distance, 0.25, 'z');
    close(player.speed, settings.walkSpeed, 1e-6, 'velocidade');
    assert.equal(player.state, 'walking');
  });
}

test('o movimento segue a direção horizontal do olhar', (t) => {
  const { player } = withWorld(t);
  simulate(player, intent(1, 0), { yaw: Math.PI / 2 });
  assert.ok(player.position.x > 2.5);
  close(player.position.z, 0, 1e-6, 'z');
  player.reset();
  simulate(player, intent(0, 1), { yaw: Math.PI / 2 });
  assert.ok(player.position.z < -2.5);
});

test('a diagonal é normalizada e não é mais rápida', (t) => {
  const { player, settings } = withWorld(t);
  for (const run of [false, true]) {
    const expected = run ? settings.runSpeed : settings.walkSpeed;
    for (const [forward, right] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const target = desiredVelocity(intent(forward, right, run), 0.7, settings);
      close(Math.hypot(target.x, target.z), expected, 1e-9);
      player.reset();
      simulate(player, intent(forward, right, run));
      close(player.speed, expected, 1e-6);
    }
  }
});

test('correr é mais rápido que andar, e só conta quando há movimento', (t) => {
  const { player, settings } = withWorld(t);
  simulate(player, intent(1, 0, true));
  assert.equal(player.state, 'running');
  close(player.speed, settings.runSpeed, 1e-6);
  player.reset();
  simulate(player, intent(0, 0, true));
  assert.equal(player.state, 'idle');
  assert.equal(player.position.z, 0);
});

test('acelera e freia suavemente, com resposta rápida', (t) => {
  const { player, settings } = withWorld(t);
  player.update(1 / 60, intent(1, 0), 0);
  assert.ok(player.speed > 0 && player.speed < settings.walkSpeed, 'não salta para o máximo');
  simulate(player, intent(1, 0), { seconds: 0.2 });
  close(player.speed, settings.walkSpeed, 1e-6, 'atinge o máximo em menos de 0,25 s');
  player.update(1 / 60, intent(), 0);
  assert.ok(player.speed > 0, 'não para instantaneamente');
  simulate(player, intent(), { seconds: 0.2 });
  assert.equal(player.speed, 0);
  assert.equal(player.state, 'idle');
});

test('o resultado não depende da taxa de quadros', (t) => {
  const { player } = withWorld(t);
  const run = (fps) => {
    player.reset();
    simulate(player, intent(1, 1, true), { seconds: 3, fps, yaw: 0.4 });
    simulate(player, intent(), { seconds: 1, fps, yaw: 0.4 });
    return [player.position.x, player.position.z];
  };
  const reference = run(60);
  for (const fps of [20, 30, 75, 144, 240]) {
    const [x, z] = run(fps);
    close(x, reference[0], 0.06, `x a ${fps} FPS`);
    close(z, reference[1], 0.06, `z a ${fps} FPS`);
  }
});

test('em alta taxa de quadros a posição avança em todos os quadros (interpolação)', (t) => {
  const { player } = withWorld(t);
  simulate(player, intent(1, 0), { seconds: 0.5, fps: 300 });
  for (let i = 0; i < 20; i += 1) {
    const before = player.position.z;
    player.update(1 / 300, intent(1, 0), 0);
    assert.ok(player.position.z > before);
  }
});

test('um quadro muito longo não teleporta o jogador', (t) => {
  const { player } = withWorld(t);
  player.update(30, intent(1, 0, true), 0);
  assert.ok(player.position.z < 1.2);
});

test('não voa nem atravessa o chão', (t) => {
  const { player, settings } = withWorld(t);
  simulate(player, intent(1, 1, true), { seconds: 3 });
  assert.equal(player.body.position.y, settings.height / 2);
  assert.equal(player.position.y, 0);
});

test('respeita o limite do terreno e desliza pela borda', (t) => {
  const { player, settings } = withWorld(t);
  const radius = settings.boundaryRadius;
  simulate(player, intent(1, 0, true), { seconds: 12 });
  close(Math.hypot(player.position.x, player.position.z), radius, 1e-6);
  assert.equal(player.state, 'idle', 'parado contra a borda');
  simulate(player, intent(1, 1, true), { seconds: 2 });
  assert.ok(player.position.x > 3, 'desliza na diagonal');
  assert.ok(Math.hypot(player.position.x, player.position.z) <= radius + 1e-6);
});
