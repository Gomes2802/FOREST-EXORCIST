/** Etapa 3: terreno, trilhas, distribuição da vegetação e desempenho do planejamento. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { distanceToPaths, samplePath, createValueNoise } from '../../src/world/environment.js';
import { planForest, visibleDistance } from '../../src/world/forest.js';
import { solidCircles } from '../../src/world/colliders.js';
import { createGame, intent } from '../helpers/world.js';

const settings = CONFIG.forest;
const { radius: PLAYER, boundaryRadius: BOUNDARY } = CONFIG.player;
const TREES = ['tree', 'tree_small', 'dead_tree'];

let game;
let spriteManager;
let circles;

before(async () => {
  ({ game, spriteManager } = createGame());
  await game.init();
  circles = solidCircles(game.forest.placements, (id) => spriteManager.get(id));
});
after(() => game.dispose());

const groupOf = (p) => spriteManager.get(p.sprite).definition.group;
const ofGroup = (...groups) => game.forest.placements.filter((p) => groups.includes(groupOf(p)));

test('as trilhas são contínuas, passam pelo início e fazem curvas', () => {
  const [main] = settings.paths;
  const samples = samplePath(main.points, 0.5);
  for (let i = 1; i < samples.length; i += 1) {
    assert.ok(Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z) <= 0.75);
  }
  assert.ok(distanceToPaths(0, 0, settings.paths) < 0.3, 'o jogador começa na trilha');
  const xs = samples.map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 3, 'trilha reta demais');
  // As duas pontas ficam fora do alcance do jogador: a trilha some na neblina.
  for (const end of [samples[0], samples.at(-1)]) assert.ok(Math.hypot(end.x, end.z) > BOUNDARY + 6);
  assert.ok(settings.paths.length >= 2);
});

test('o terreno tem chão, trilhas, variação de tom e ultrapassa a área alcançável', () => {
  const { ground, trails } = game.forest;
  assert.ok(settings.groundSize / 2 > BOUNDARY + 35);
  assert.equal(trails.length, settings.paths.length);
  for (const mesh of [ground, ...trails]) {
    const colors = mesh.getVerticesData('color');
    const tones = new Set();
    for (let i = 0; i < colors.length; i += 4) tones.add(colors[i].toFixed(2));
    assert.ok(tones.size > 8, `${mesh.name} sem variação de tom`);
    // Irregularidades são só visuais: o jogador anda em um plano.
    const positions = mesh.getVerticesData('position');
    for (let i = 1; i < positions.length; i += 3) assert.ok(Math.abs(positions[i]) < 0.05);
  }
  assert.notEqual(trails[0].material.diffuseTexture, ground.material.diffuseTexture);
});

test('o ruído é determinístico, contínuo e limitado', () => {
  const noise = createValueNoise(5);
  assert.equal(noise(3.2, -7.9), createValueNoise(5)(3.2, -7.9));
  for (let i = 0; i < 200; i += 1) {
    const value = noise(i * 0.37, i * 0.11);
    assert.ok(value >= 0 && value <= 1);
    assert.ok(Math.abs(noise(i * 0.37 + 0.001, i * 0.11) - value) < 0.01);
  }
});

test('há todos os tipos de vegetação, em quantidade', () => {
  const expected = {
    tree: 200, tree_small: 40, dead_tree: 15, vegetation: 100, plant: 80, grass: 1500, rock: 25, log: 6,
  };
  for (const [group, minimum] of Object.entries(expected)) {
    assert.ok(ofGroup(group).length >= minimum, `${group}: ${ofGroup(group).length} < ${minimum}`);
  }
  for (const group of ['tree', 'dead_tree', 'vegetation', 'grass', 'rock']) {
    assert.ok(new Set(ofGroup(group).map((p) => p.sprite)).size >= 2, `sem variações em ${group}`);
  }
});

test('a distribuição varia em tamanho e tom, é determinística e muda com a semente', () => {
  const trees = ofGroup('tree');
  const scales = trees.map((p) => p.scale);
  assert.ok(Math.max(...scales) - Math.min(...scales) > 0.35);
  assert.ok(new Set(trees.map((p) => p.shade.toFixed(2))).size > 10);
  assert.ok(new Set(trees.map((p) => p.stretch.toFixed(2))).size > 10);

  const ids = (group) => spriteManager.idsByGroup(group);
  const describe = (id) => spriteManager.get(id);
  const first = planForest(settings, ids, describe);
  assert.deepEqual(first, planForest(settings, ids, describe));
  assert.notDeepEqual(first, planForest({ ...settings, seed: 2 }, ids, describe));
});

test('a densidade de árvores aumenta em direção ao horizonte', () => {
  const trees = ofGroup('tree').map((p) => Math.hypot(p.position[0], p.position[2]));
  const density = (a, b) => trees.filter((r) => r >= a && r < b).length / (Math.PI * (b * b - a * a));
  assert.ok(density(34, 50) > density(6, 30) * 1.3, `${density(34, 50)} x ${density(6, 30)}`);
});

test('nenhum sólido bloqueia as trilhas', () => {
  assert.ok(circles.length > 100);
  for (const circle of circles) {
    const clearance = distanceToPaths(circle.x, circle.z, settings.paths) - circle.radius;
    assert.ok(clearance >= settings.pathHalfWidth - 1e-6,
      `${circle.placement.sprite} a ${clearance.toFixed(2)} da trilha`);
  }
});

test('copas e arbustos não ficam sobre o meio das trilhas', () => {
  for (const p of ofGroup(...TREES, 'vegetation')) {
    const distance = distanceToPaths(p.position[0], p.position[2], settings.paths);
    assert.ok(distance >= settings.pathHalfWidth, `${p.sprite} sobre a trilha (${distance.toFixed(2)})`);
  }
});

test('obstáculos alcançáveis deixam passagem entre si e o início está livre', () => {
  const near = circles.filter((c) => Math.hypot(c.x, c.z) < BOUNDARY + 1);
  for (const a of near) {
    assert.ok(Math.hypot(a.x, a.z) - a.radius > 1.5, 'obstáculo no ponto inicial');
    for (const b of near) {
      if (a.placement === b.placement || (a.placement.fixed && b.placement.fixed)) continue;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius;
      assert.ok(gap >= PLAYER * 2, `${a.placement.sprite}/${b.placement.sprite}: vão de ${gap.toFixed(2)}`);
    }
  }
});

test('o jogador percorre cada trilha inteira, correndo, sem desviar', () => {
  for (const path of settings.paths) {
    const points = samplePath(path.points, 1).filter((p) => Math.hypot(p.x, p.z) < BOUNDARY - 1);
    assert.ok(points.length > 10);
    game.player.teleport(points[0].x, points[0].z);
    for (const target of points.slice(1)) {
      let frames = 0;
      const p = game.player.body.position;
      while (Math.hypot(target.x - p.x, target.z - p.z) > 0.4 && frames < 120) {
        game.player.update(1 / 60, intent(1, 0), Math.atan2(target.x - p.x, target.z - p.z));
        frames += 1;
      }
      assert.ok(frames < 120, `bloqueado em (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`);
    }
  }
});

test('troncos caídos são sólidos em todo o comprimento', () => {
  const log = ofGroup('log').find((p) => Math.hypot(p.position[0], p.position[2]) < BOUNDARY - 5);
  const own = circles.filter((c) => c.placement === log);
  assert.ok(own.length >= 3, `${own.length} círculos`);
  // De lado, pelo meio e perto das pontas (nas pontas em si, desliza em volta).
  const normal = { x: Math.sin(log.yaw), z: Math.cos(log.yaw) };
  for (const circle of [own[1], own[Math.floor(own.length / 2)], own.at(-2)]) {
    for (const side of [1, -1]) {
      game.player.teleport(circle.x + normal.x * side * 1.6, circle.z + normal.z * side * 1.6);
      const yaw = Math.atan2(-normal.x * side, -normal.z * side);
      for (let i = 0; i < 90; i += 1) {
        game.player.update(1 / 60, intent(1, 0, true), yaw);
        const { x, z } = game.player.position;
        const crossed = ((x - circle.x) * normal.x + (z - circle.z) * normal.z) * side;
        assert.ok(crossed > 0, `atravessou o tronco: ${crossed.toFixed(2)}`);
      }
    }
  }
});

test('sprites distantes deixam de ser desenhados, sem afetar colisões', () => {
  const { forest } = game;
  const colliders = forest.colliders.length;
  const far = () => {
    const limit = visibleDistance(CONFIG.environment, game.scene.fogDensity);
    forest.follow({ x: 0, y: 1.7, z: 0 });
    const { smallHeight, smallDistance } = CONFIG.environment.culling;
    for (const object of forest.objects) {
      const distance = Math.hypot(object.position.x, object.position.z);
      const height = object.sourceMesh.getBoundingInfo().boundingBox.maximum.y * object.scaling.y;
      const reach = height < smallHeight ? Math.min(limit, smallDistance) : limit;
      assert.equal(object.isEnabled(), distance <= reach, `${object.name} a ${distance.toFixed(1)}`);
    }
    return forest.objects.filter((o) => o.isEnabled()).length;
  };
  const normal = far();
  assert.ok(normal < forest.objects.length);
  game.setFogDensity(0.085);
  assert.ok(far() < normal, 'neblina densa deve desenhar menos');
  game.setFogDensity(CONFIG.environment.fog.density);
  assert.ok(forest.colliders.every((c) => c.isEnabled()));
  assert.equal(forest.colliders.length, colliders);
});

test('a grama usa uma malha por sprite e desenha somente a que está perto', () => {
  const { forest } = game;
  assert.equal(forest.grass.length, spriteManager.idsByGroup('grass').length);
  const limit = CONFIG.environment.culling.grassDistance;
  for (const center of [{ x: 0, z: 0 }, { x: -20, z: 15 }, { x: 0, z: 0 }]) {
    forest.follow({ ...center, y: 1.7 });
    const near = ofGroup('grass').filter(
      (p) => Math.hypot(p.position[0] - center.x, p.position[2] - center.z) <= limit,
    ).length;
    const drawn = forest.grass.reduce((sum, mesh) => sum + mesh.thinInstanceCount, 0);
    assert.equal(drawn, near);
    assert.ok(drawn > 100 && drawn < ofGroup('grass').length);
  }
});

test('desempenho básico: planejamento e atualização por quadro são rápidos', () => {
  let start = performance.now();
  planForest(settings, (g) => spriteManager.idsByGroup(g), (id) => spriteManager.get(id));
  assert.ok(performance.now() - start < 1000, 'planejamento lento');
  start = performance.now();
  for (let i = 0; i < 600; i += 1) game.update(1 / 60);
  const perFrame = (performance.now() - start) / 600;
  assert.ok(perFrame < 4, `${perFrame.toFixed(2)} ms por atualização`);
});
