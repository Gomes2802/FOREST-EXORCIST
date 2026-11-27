/** Colisões na floresta real, com o sistema de colisões do Babylon.js. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createRandom } from '../../src/world/forest.js';
import { solidCircles } from '../../src/world/colliders.js';
import { createGame, intent, simulate } from '../helpers/world.js';

const { radius: PLAYER, boundaryRadius: BOUNDARY } = CONFIG.player;
let game;
let spriteManager;

before(async () => {
  ({ game, spriteManager } = createGame());
  await game.init();
});
after(() => game.dispose());

/** Distância mínima permitida: apótema do octógono mais o raio do jogador. */
const clearance = (collider) => collider.scaling.x * Math.cos(Math.PI / 8) + PLAYER - 0.002;
const reachable = () => game.forest.colliders.filter((c) => Math.hypot(c.position.x, c.position.z) < BOUNDARY - 3);

function assertOutside(label) {
  const { x, z } = game.player.position;
  for (const c of game.forest.colliders) {
    const distance = Math.hypot(x - c.position.x, z - c.position.z);
    assert.ok(distance >= clearance(c),
      `${label}: atravessou ${c.name} (${distance.toFixed(3)} < ${clearance(c).toFixed(3)})`);
  }
}

const isFree = (x, z) => game.forest.colliders.every(
  (c) => Math.hypot(x - c.position.x, z - c.position.z) > c.scaling.x + PLAYER + 0.05,
);

test('árvores, pedras e troncos são sólidos; vegetação, entidade e cruz não', () => {
  const solid = solidCircles(game.forest.placements, (id) => spriteManager.get(id));
  assert.equal(game.forest.colliders.length, solid.length);
  assert.deepEqual(
    [...new Set(solid.map((c) => c.placement.sprite))].sort(),
    ['dead_tree_01', 'dead_tree_02', 'log_01', 'rock_01', 'rock_02', 'tree_01', 'tree_02', 'tree_small_01'],
  );
  // Tudo o que é sólido e está ao alcance do jogador tem colisão.
  for (const p of game.forest.placements) {
    if (spriteManager.get(p.sprite).definition.collisionRadius === 0) continue;
    if (Math.hypot(p.position[0], p.position[2]) > BOUNDARY + 2) continue;
    assert.ok(solid.some((c) => c.placement === p), `${p.sprite} sem colisão`);
  }
  assert.ok(game.forest.colliders.every((c) => c.checkCollisions && !c.isVisible));
});

test('o ponto inicial está livre', () => {
  assert.ok(isFree(0, 0));
});

test('nenhum obstáculo é atravessado de frente, de qualquer lado, nem correndo', () => {
  let checked = 0;
  for (const collider of reachable()) {
    const { x, z } = collider.position;
    for (let k = 0; k < 8; k += 1) {
      const yaw = (k / 8) * Math.PI * 2;
      const start = [x - Math.sin(yaw) * 2, z - Math.cos(yaw) * 2];
      if (!isFree(...start)) continue;
      game.player.teleport(...start);
      for (let frame = 0; frame < 45; frame += 1) {
        game.player.update(1 / 30, intent(1, 0, true), yaw);
        const distance = Math.hypot(game.player.position.x - x, game.player.position.z - z);
        assert.ok(distance >= clearance(collider), `atravessou ${collider.name} por ${k}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 400, `poucos casos: ${checked}`);
});

test('ao raspar em um obstáculo, o jogador desliza e passa', () => {
  const rock = game.forest.colliders.find((c) => c.name.startsWith('collider:rock_01#'));
  const { x, z } = rock.position;
  for (const side of [-0.45, 0.45]) {
    game.player.teleport(x + side, z - 2);
    simulate(game.player, intent(1, 0), { seconds: 2 });
    assert.ok(game.player.position.z > z + 0.5, `ficou preso (lado ${side}): z=${game.player.position.z}`);
  }
});

test('colisão na diagonal desliza sem ganhar velocidade', () => {
  const rock = game.forest.colliders.find((c) => c.name.startsWith('collider:rock_01#'));
  game.player.teleport(rock.position.x - 1.5, rock.position.z - 1.2);
  let fastest = 0;
  for (let i = 0; i < 90; i += 1) {
    game.player.update(1 / 60, intent(1, 1), 0);
    fastest = Math.max(fastest, game.player.speed);
    assertOutside('diagonal');
  }
  assert.ok(fastest <= CONFIG.player.walkSpeed * 1.02, `acelerou até ${fastest}`);
  assert.ok(game.player.position.x > rock.position.x, 'não deslizou');
});

test('passeio aleatório longo nunca atravessa obstáculos nem sai do terreno', () => {
  const random = createRandom(99);
  game.player.reset();
  let yaw = 0;
  let move = intent(1, 0);
  for (let frame = 0; frame < 18000; frame += 1) {
    if (frame % 90 === 0) {
      yaw = random() * Math.PI * 2;
      move = intent(random() < 0.9 ? 1 : -1, Math.round(random() * 2) - 1, random() < 0.5);
    }
    game.player.update(1 / 60, move, yaw);
    assertOutside(`quadro ${frame}`);
    assert.ok(Math.hypot(game.player.position.x, game.player.position.z) <= BOUNDARY + 1e-6);
    assert.equal(game.player.body.position.y, CONFIG.player.height / 2);
  }
  assert.ok(game.player.travelled > 300, `andou pouco: ${game.player.travelled}`);
});

test('empurrar um obstáculo nunca prende o jogador: é sempre possível recuar', () => {
  let checked = 0;
  for (const collider of reachable()) {
    const { x, z } = collider.position;
    for (let k = 0; k < 8; k += 1) {
      const yaw = (k / 8) * Math.PI * 2;
      const start = [x - Math.sin(yaw) * 2, z - Math.cos(yaw) * 2];
      if (!isFree(...start)) continue;
      game.player.teleport(...start);
      for (let frame = 0; frame < 90; frame += 1) {
        const p = game.player.body.position;
        game.player.update(1 / 60, intent(1, 0), Math.atan2(x - p.x, z - p.z));
        assertOutside(`empurrando ${collider.name}`);
      }
      const before = game.player.travelled;
      simulate(game.player, intent(-1, 0), { seconds: 0.5, yaw });
      assert.ok(game.player.travelled - before > 0.4, `preso em ${collider.name}, lado ${k}`);
      checked += 1;
    }
  }
  assert.ok(checked > 400);
});

test('passeios aleatórios com outras sementes também não atravessam nada', () => {
  for (const seed of [1, 3, 4]) {
    const random = createRandom(seed);
    game.player.reset();
    let yaw = 0;
    let move = intent(1, 0);
    for (let frame = 0; frame < 18000; frame += 1) {
      if (frame % 90 === 0) {
        yaw = random() * Math.PI * 2;
        move = intent(random() < 0.9 ? 1 : -1, Math.round(random() * 2) - 1, random() < 0.5);
      }
      game.player.update(1 / 60, move, yaw);
      assertOutside(`semente ${seed}, quadro ${frame}`);
    }
    assert.ok(game.player.travelled > 200, `semente ${seed} andou pouco: ${game.player.travelled}`);
  }
});

test('as colisões continuam depois de recriar a floresta', async () => {
  const count = game.forest.colliders.length;
  await game.setSpriteResolution(0.5);
  await game.setSpriteResolution(1);
  assert.equal(game.forest.colliders.length, count);
  // Etapa 6: além dos obstáculos da floresta, as caixas das construções.
  const buildings = game.buildings.buildings.reduce((sum, b) => sum + b.colliders.length, 0);
  assert.equal(game.scene.meshes.filter((m) => m.checkCollisions).length, count + buildings);
});
