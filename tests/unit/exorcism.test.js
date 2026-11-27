/** Etapa 4: cruz, detecção de entidades e exorcismo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { isBlocked } from '../../src/systems/interaction.js';
import { createExorcism } from '../../src/systems/exorcism.js';
import { createEntityState } from '../../src/entities/entity.js';
import { createRaise } from '../../src/player/cross.js';
import { createGame } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';

const settings = CONFIG.exorcism;
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} x ${b}`);

/** Jogo em andamento, com atalhos para segurar o botão e mirar. */
async function ready(t, options) {
  const context = createGame(options);
  const { game, dom } = context;
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  // Etapa 4 isolada: entidade presente no lugar antigo, sem o comportamento da Etapa 5.
  game.haunting.summon(1.3, 11, { pinned: true });

  context.hold = () => emit(dom.element, 'pointerdown', { button: 0, buttons: 1 });
  context.release = () => emit(dom.window, 'pointerup', { button: 0, buttons: 0 });
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) game.update(1 / fps);
  };
  /** Coloca o jogador em (x, z) olhando para um ponto do mundo. */
  context.aim = (x, z, point) => {
    game.player.teleport(x, z);
    game.view.reset(game.player.position);
    const target = point ?? game.entity.center;
    const dx = target.x - x;
    const dz = target.z - z;
    const dy = target.y - CONFIG.player.eyeHeight;
    const { mouseSensitivity } = CONFIG.camera;
    game.view.look(Math.atan2(dx, dz) / mouseSensitivity, Math.atan2(-dy, Math.hypot(dx, dz)) / mouseSensitivity);
    context.run(0.5);
  };
  /** Em frente à entidade, dentro do alcance. */
  context.face = () => context.aim(0.5, 6);
  return context;
}

test('há uma única entidade de teste, visível, não sólida e fora da floresta', async (t) => {
  const { game } = await ready(t);
  const { entity, forest } = game;
  assert.equal(entity.state, 'watching');
  assert.equal(entity.progress, 0);
  assert.ok(entity.mesh.isEnabled() && entity.mesh.isVisible);
  assert.equal(entity.mesh.checkCollisions, false);
  assert.equal(entity.mesh.renderingGroupId, 1);
  assert.ok(forest.placements.every((p) => p.sprite !== CONFIG.entity.sprite));
});

test('a cruz só aparece com o botão esquerdo, subindo e descendo suavemente', async (t) => {
  const { game, hold, release, run } = await ready(t);
  const { cross } = game;
  run(0.2);
  assert.equal(cross.visible, false);
  hold();
  const heights = [];
  for (let i = 0; i < 30; i += 1) {
    game.update(1 / 60);
    heights.push(cross.root.position.y);
  }
  assert.equal(cross.visible, true);
  assert.equal(cross.amount, 1);
  for (let i = 1; i < heights.length; i += 1) {
    assert.ok(heights[i] >= heights[i - 1] - 1e-9, 'subida irregular');
    assert.ok(heights[i] - heights[i - 1] < 0.15, 'salto na animação');
  }
  assert.ok(heights.filter((h, i) => i > 0 && h > heights[i - 1] + 1e-6).length > 8, 'sem animação');
  release();
  run(settings.cross.lowerTime / 2);
  assert.ok(cross.amount > 0.2 && cross.amount < 0.8, `descendo: ${cross.amount}`);
  run(0.3);
  assert.equal(cross.visible, false);
});

test('a cruz fica presa à câmera, abaixo da mira, sem luz nem neblina', async (t) => {
  const { game, hold, run, aim } = await ready(t);
  hold();
  aim(0, 0, { x: 5, y: 0, z: 5 });
  run(0.5);
  const { root, mesh } = game.cross;
  assert.equal(root.parent, game.view.camera);
  assert.equal(mesh.renderingGroupId, 2);
  assert.equal(mesh.material.disableLighting, true);
  assert.equal(mesh.material.fogEnabled, false);
  const { x, y, z } = root.position;
  const halfHeight = settings.cross.height / 2;
  assert.ok(y + halfHeight < -0.05 * z, 'a cruz cobre a mira');
  assert.ok(x > 0.15, 'a cruz fica ao lado do centro');
});

test('só o botão esquerdo levanta a cruz, e só durante o jogo', async (t) => {
  const { game, dom, run } = await ready(t);
  emit(dom.element, 'pointerdown', { button: 2, buttons: 2 });
  run(0.4);
  assert.equal(game.cross.amount, 0);
  // Botão esquerdo apertado e solto enquanto outro continua pressionado.
  emit(dom.document, 'pointermove', { button: 0, buttons: 3, movementX: 0, movementY: 0 });
  run(0.4);
  assert.equal(game.cross.amount, 1);
  emit(dom.document, 'pointermove', { button: 0, buttons: 2, movementX: 0, movementY: 0 });
  run(0.4);
  assert.equal(game.cross.amount, 0);
  game.quitToMenu();
  emit(dom.element, 'pointerdown', { button: 0, buttons: 1 });
  run(0.4);
  assert.equal(game.cross.amount, 0);
});

test('a mira detecta a entidade, mesmo com a cruz abaixada', async (t) => {
  const { game, face } = await ready(t);
  face();
  assert.equal(game.target, game.entity);
  assert.equal(game.entity.progress, 0, 'sem cruz não há progresso');
});

test('mirar ao lado, acima ou de costas não detecta', async (t) => {
  const { game, aim } = await ready(t);
  const { x, y, z } = game.entity.center;
  for (const point of [{ x: x + 2.5, y, z }, { x, y: y + 3, z }, { x, y: 0, z: z - 3 }, { x: 0, y, z: -10 }]) {
    aim(0.5, 6, point);
    assert.equal(game.target, null, JSON.stringify(point));
  }
});

test('árvores, pedras e arbustos nunca são detectados', async (t) => {
  const { game, aim, hold, run } = await ready(t);
  game.entity.setActive(false);
  hold();
  const objects = game.forest.placements.filter(
    (p) => p.kind === 'billboard' && Math.hypot(p.position[0], p.position[2]) < 20,
  );
  assert.ok(objects.length > 50);
  for (const p of objects.slice(0, 60)) {
    const [x, , z] = p.position;
    aim(x, z - 2.5, { x, y: 0.5, z });
    run(0.1);
    assert.equal(game.target, null, p.sprite);
  }
});

test('respeita o alcance configurado', async (t) => {
  const { game, aim, hold, run } = await ready(t);
  const { x, z } = game.entity.center;
  aim(x, z - settings.range - 1);
  assert.equal(game.target, null);
  hold();
  run(1);
  assert.equal(game.entity.progress, 0);
  aim(x, z - settings.range + 0.8);
  assert.equal(game.target, game.entity);
});

test('um obstáculo entre o jogador e a entidade bloqueia a mira', () => {
  const origin = { x: 0, y: 1.7, z: 0 };
  const point = { x: 0, y: 1.5, z: 8 };
  assert.equal(isBlocked(origin, point, [{ x: 0, z: 4, radius: 0.4, height: 5 }]), true);
  assert.equal(isBlocked(origin, point, [{ x: 1.5, z: 4, radius: 0.4, height: 5 }]), false, 'ao lado');
  assert.equal(isBlocked(origin, point, [{ x: 0, z: 4, radius: 0.4, height: 0.7 }]), false, 'baixo demais');
  assert.equal(isBlocked(origin, point, [{ x: 0, z: 11, radius: 0.4, height: 5 }]), false, 'atrás');
  assert.equal(isBlocked(origin, point, [{ x: 0, z: -2, radius: 0.4, height: 5 }]), false, 'às costas');
});

test('o progresso começa com a cruz erguida sobre a entidade', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  game.update(1 / 60);
  assert.equal(game.entity.progress, 0, 'a cruz ainda está subindo');
  run(1);
  assert.equal(game.entity.state, 'exorcizing');
  assert.ok(game.entity.progress > 0.1 && game.entity.progress < 0.4, `${game.entity.progress}`);
});

test('soltar o botão interrompe e o progresso para', async (t) => {
  const { game, face, hold, release, run } = await ready(t);
  face();
  hold();
  run(1.5);
  const before = game.entity.progress;
  release();
  run(2);
  assert.equal(game.entity.state, 'watching');
  close(game.entity.progress, before);
  hold();
  run(1);
  assert.ok(game.entity.progress > before, 'retoma de onde parou');
});

test('perder a mira interrompe e o progresso para', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  run(1.5);
  const before = game.entity.progress;
  game.view.look(900, 0);
  run(0.5);
  const lost = game.entity.progress;
  run(2);
  assert.equal(game.target, null);
  assert.equal(game.entity.state, 'watching');
  close(game.entity.progress, lost);
  assert.ok(lost - before < 0.05, 'só avança enquanto a câmera ainda estava sobre ela');
});

test('o tempo total é o configurado, e a entidade desaparece suavemente', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  const expected = settings.cross.raiseTime * settings.requiredRaise + settings.duration / settings.speed;
  run(expected - 0.1);
  assert.equal(game.entity.state, 'exorcizing');
  run(0.2);
  assert.equal(game.entity.state, 'exorcised');
  assert.equal(game.entity.progress, 1);
  const fading = [];
  for (let i = 0; i < CONFIG.entity.fadeDuration * 60 + 5; i += 1) {
    game.update(1 / 60);
    fading.push(game.entity.mesh.isEnabled() ? game.entity.mesh.visibility : 0);
  }
  assert.ok(fading[0] > 0.9, 'sumiu de uma vez');
  for (let i = 1; i < fading.length; i += 1) assert.ok(fading[i] <= fading[i - 1] + 1e-9);
  assert.equal(fading.at(-1), 0);
  assert.equal(game.entity.mesh.isEnabled(), false);
  assert.equal(game.target, null, 'entidade exorcizada não é alvo');
});

test('o resultado não depende da taxa de quadros', async (t) => {
  const results = [];
  for (const fps of [15, 30, 60, 144]) {
    const { game, face, hold, run } = await ready(t);
    face();
    hold();
    run(2, fps);
    results.push(game.entity.progress);
  }
  for (const value of results) close(value, results[0], 1e-6);
});

test('pausar congela o progresso e a cruz; retomar exige apertar de novo', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  run(1.5);
  const frozen = [game.entity.progress, game.cross.amount, game.entity.mesh.position.y];
  game.pause();
  run(3);
  assert.deepEqual([game.entity.progress, game.cross.amount, game.entity.mesh.position.y], frozen);
  await game.resume();
  run(1);
  assert.equal(game.cross.amount, 0, 'nenhum botão fica preso');
  close(game.entity.progress, frozen[0]);
  hold();
  run(1);
  assert.ok(game.entity.progress > frozen[0]);
});

test('voltar ao menu restaura a entidade e a cruz', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  run(10);
  assert.equal(game.entity.state, 'exorcised');
  game.pause();
  game.quitToMenu();
  assert.deepEqual([game.entity.state, game.entity.progress, game.cross.amount], ['dormant', 0, 0]);
  assert.equal(game.entity.mesh.isEnabled(), false);
});

test('a interface recebe os estados certos', async (t) => {
  const { game, face, hold, run } = await ready(t);
  let hud;
  game.onHud = (state) => {
    hud = state;
  };
  run(0.1);
  assert.deepEqual(hud, { raised: false, aim: 'idle', progress: null, message: null, notice: null });
  face();
  assert.equal(hud.aim, 'target');
  assert.equal(hud.progress, null);
  hold();
  run(1);
  assert.deepEqual([hud.raised, hud.aim], [true, 'exorcising']);
  close(hud.progress, game.entity.progress);
  run(10);
  assert.equal(hud.aim, 'idle');
  assert.equal(hud.progress, null);
  assert.equal(hud.message, null, 'a mensagem é temporária');
});

test('ao concluir, a mensagem aparece por tempo limitado', async (t) => {
  const { game, face, hold, run } = await ready(t);
  let hud;
  game.onHud = (state) => {
    hud = state;
  };
  face();
  hold();
  run(settings.duration + 0.5);
  assert.equal(hud.message, settings.message);
  run(settings.messageDuration + 0.2);
  assert.equal(hud.message, null);
});

test('mudar a resolução dos sprites preserva o estado da entidade e a cruz', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  run(1.5);
  const before = game.entity.progress;
  const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length];
  const resources = count();
  await game.setSpriteResolution(0.5);
  await game.setSpriteResolution(1);
  assert.deepEqual(count(), resources);
  close(game.entity.progress, before);
  run(0.5);
  assert.ok(game.entity.progress > before);
});

test('regras do exorcismo: velocidade e perda de progresso configuráveis', () => {
  const entity = createEntityState();
  entity.materialize();
  const exorcism = createExorcism({ ...settings, duration: 4, speed: 2, decayPerSecond: 0.1 });
  exorcism.update(1, { holding: true, readyTime: 1, target: entity });
  close(entity.progress, 0.5);
  exorcism.update(2, { holding: false, readyTime: 0, target: entity });
  close(entity.progress, 0.3);
  assert.equal(entity.state, 'watching');
  const completed = exorcism.update(5, { holding: true, readyTime: 5, target: entity });
  assert.equal(completed, entity);
  assert.equal(exorcism.update(1, { holding: true, readyTime: 1, target: entity }), null);
  assert.equal(entity.progress, 1);
});

test('a subida da cruz informa quanto do quadro ela passou erguida', () => {
  const raise = createRaise({ raiseTime: 0.4, lowerTime: 0.2 }, 0.75);
  close(raise.update(0.2, true), 0);
  close(raise.update(0.2, true), 0.1); // passou de 75% aos 0,3 s
  close(raise.update(0.2, true), 0.2);
  close(raise.update(0.1, false), 0);
  close(raise.amount, 0.5);
});
