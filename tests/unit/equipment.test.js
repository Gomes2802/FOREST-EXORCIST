/** Seleção de item, cruz equipada e animação de uso. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createInventory } from '../../src/player/inventory.js';
import { createFrameClock, CROSS_STATES } from '../../src/player/cross.js';
import { createGame } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';
import { projectPath, readPngAlpha } from '../helpers/fakes.js';

const { UNEQUIPPED, IDLE, USING } = CROSS_STATES;
const settings = CONFIG.exorcism.cross;
const LAST = settings.frames - 1;
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} x ${b}`);

async function ready(t) {
  const context = createGame();
  const { game, dom } = context;
  t.after(() => game.dispose());
  await game.init();
  await game.play();
  game.haunting.summon(1.3, 11, { pinned: true });

  context.hold = () => emit(dom.element, 'pointerdown', { button: 0, buttons: 1 });
  context.release = () => emit(dom.window, 'pointerup', { button: 0, buttons: 0 });
  context.key = (code, props = {}) => emit(dom.window, 'keydown', { code, ...props });
  context.run = (seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i += 1) game.update(1 / fps);
  };
  context.face = () => {
    game.player.teleport(0.5, 6);
    game.view.reset(game.player.position);
    const { x, y, z } = game.entity.center;
    const { mouseSensitivity } = CONFIG.camera;
    game.view.look(
      Math.atan2(x - 0.5, z - 6) / mouseSensitivity,
      Math.atan2(CONFIG.player.eyeHeight - y, Math.hypot(x - 0.5, z - 6)) / mouseSensitivity,
    );
    context.run(0.5);
  };
  /** Cruz equipada e já parada na mão. */
  context.equip = () => {
    context.key('Digit1');
    context.run(1);
  };
  /** O que está desenhado: textura em uso e faixa horizontal dela. */
  context.drawn = () => {
    const { mesh } = game.cross;
    const u = [...mesh.getVerticesData('uv')].filter((_, i) => i % 2 === 0);
    return { width: mesh.material.diffuseTexture.getSize().width, from: Math.min(...u), to: Math.max(...u) };
  };
  /** Confere que o quadro pedido ocupa exatamente a sua fatia da folha. */
  context.assertFrame = (frame) => {
    const { from, to } = context.drawn();
    close(from, (frame + settings.crop.left) / settings.frames);
    close(to, (frame + 1) / settings.frames);
  };
  return context;
}

const pose = (cross) => [...cross.root.position.asArray(), cross.root.rotation.z];
const resources = (game) => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length];

// ---------------------------------------------------------------- Seleção

test('o inventário seleciona, alterna, guarda e aceita novos itens', () => {
  const inventory = createInventory([{ id: 'cross', slot: 1 }, { id: 'candle', slot: 2 }]);
  assert.equal(inventory.selected, null);
  assert.equal(inventory.select(1), true);
  assert.equal(inventory.selected, 'cross');
  assert.equal(inventory.select(2), true);
  assert.equal(inventory.selected, 'candle');
  assert.equal(inventory.select(2), true);
  assert.equal(inventory.selected, null, 'a mesma tecla guarda');
  assert.equal(inventory.select(7), false, 'espaço vazio');
  inventory.select(1);
  assert.equal(inventory.stow(), true);
  assert.equal(inventory.stow(), false, 'já estava guardado');
  inventory.select(1);
  inventory.reset();
  assert.equal(inventory.selected, null);
});

test('começa com a cruz guardada: nada na mão e o botão esquerdo não faz nada', async (t) => {
  const { game, face, hold, run } = await ready(t);
  face();
  hold();
  run(CONFIG.exorcism.duration + 1);
  assert.equal(game.inventory.selected, null);
  assert.equal(game.cross.state, UNEQUIPPED);
  assert.deepEqual([game.cross.visible, game.cross.amount, game.cross.root.isEnabled()], [false, 0, false]);
  assert.deepEqual([game.entity.state, game.entity.progress], ['watching', 0]);
});

test('a tecla 1 equipa sem usar: held cross parado, sem exorcismo', async (t) => {
  const { game, face, equip, drawn, run } = await ready(t);
  face();
  equip();
  assert.equal(game.inventory.selected, 'cross');
  assert.equal(game.cross.state, IDLE);
  assert.equal(game.cross.frame, null);
  assert.equal(game.cross.root.isEnabled(), true);
  assert.equal(drawn().width, 500);
  const still = pose(game.cross);
  for (let i = 0; i < 120; i += 1) {
    game.update(1 / 60);
    assert.deepEqual(pose(game.cross), still, 'parada na tela');
  }
  run(CONFIG.exorcism.duration);
  assert.deepEqual([game.cross.amount, game.entity.progress], [0, 0]);
});

test('1 de novo ou G guardam a cruz, que sai da tela', async (t) => {
  const { game, key, equip, run } = await ready(t);
  for (const code of ['Digit1', 'KeyG', 'Numpad1']) {
    equip();
    assert.equal(game.cross.state, IDLE, code);
    key(code);
    assert.equal(game.cross.state, UNEQUIPPED, code);
    run(1);
    assert.deepEqual([game.cross.visible, game.cross.root.isEnabled()], [false, false], code);
  }
});

test('repetição da tecla, espaço vazio e Ctrl+1 não mudam a seleção', async (t) => {
  const { game, key } = await ready(t);
  key('Digit1');
  key('Digit1', { repeat: true });
  key('Digit2');
  key('Digit1', { ctrlKey: true });
  assert.equal(game.inventory.selected, 'cross');
});

test('equipar ou guardar leva a cruz suavemente, sem saltos', async (t) => {
  const { game, key } = await ready(t);
  for (const code of ['Digit1', 'KeyG']) {
    key(code);
    const heights = [];
    for (let i = 0; i < 60; i += 1) {
      game.update(1 / 60);
      heights.push(game.cross.root.position.y);
    }
    for (let i = 1; i < heights.length; i += 1) {
      assert.ok(Math.abs(heights[i] - heights[i - 1]) < 0.15, `salto ao apertar ${code}`);
    }
    assert.ok(Math.abs(heights.at(-1) - heights[0]) > 0.3, 'sem movimento');
  }
});

// ---------------------------------------------------------------- Animação

test('o relógio de quadros passa por todos, em ordem, e para no último', () => {
  const clock = createFrameClock({ frames: 5, fps: 10, loop: false });
  const seen = [clock.update(0.016)];
  for (let i = 0; i < 100; i += 1) seen.push(clock.update(0.016));
  assert.deepEqual([...new Set(seen)], [0, 1, 2, 3, 4]);
  assert.equal(seen.at(-1), 4);
  clock.reset();
  assert.equal(clock.update(0.5), 0, 'recomeça do primeiro');
});

test('com repetição ligada, volta ao primeiro quadro depois do último', () => {
  const clock = createFrameClock({ frames: 3, fps: 10, loop: true });
  const seen = [];
  for (let i = 0; i < 8; i += 1) seen.push(clock.update(0.1));
  assert.deepEqual(seen, [0, 1, 2, 0, 1, 2, 0, 1]);
});

test('nenhum quadro é pulado, mesmo com o jogo muito lento', () => {
  const clock = createFrameClock({ frames: 5, fps: 12, loop: false });
  const seen = [];
  for (let i = 0; i < 7; i += 1) seen.push(clock.update(0.1));
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 4, 4]);
});

test('a velocidade da animação não depende da taxa de quadros', () => {
  for (const fps of [15, 30, 60, 144, 240]) {
    const clock = createFrameClock({ frames: 5, fps: 12, loop: false });
    clock.update(1 / fps);
    let time = 0;
    while (clock.update(1 / fps) < 4) time += 1 / fps;
    time += 1 / fps;
    // Quatro trocas a 12 quadros/s = 0,333 s, com no máximo um quadro de tela de folga.
    assert.ok(time >= 4 / 12 - 1e-6 && time <= 4 / 12 + 1 / fps + 1e-6, `${fps} FPS: ${time}`);
  }
});

test('segurar o botão toca a folha do primeiro ao último quadro, sem mover a cruz', async (t) => {
  const { game, equip, hold, drawn, assertFrame } = await ready(t);
  equip();
  const { material } = game.cross.mesh;
  const still = pose(game.cross);
  const { mesh } = game.cross;
  const before = resources(game);
  hold();
  const frames = [];
  for (let i = 0; i < 60; i += 1) {
    game.update(1 / 60);
    assert.equal(game.cross.state, USING);
    assert.equal(drawn().width, 2500);
    assertFrame(game.cross.frame);
    assert.equal(game.cross.mesh, mesh);
    assert.equal(mesh.material, material, 'o mesmo material: nenhum shader novo');
    assert.deepEqual(pose(game.cross), still, 'a animação não desloca a imagem');
    frames.push(game.cross.frame);
  }
  assert.deepEqual([...new Set(frames)], [0, 1, 2, 3, 4]);
  assert.equal(frames.at(-1), LAST);
  assert.deepEqual(resources(game), before);
});

test('soltar volta ao held cross no mesmo instante; repetir recomeça do início', async (t) => {
  const { game, equip, hold, release, drawn, run } = await ready(t);
  equip();
  const before = resources(game);
  for (let n = 0; n < 6; n += 1) {
    hold();
    game.update(1 / 60);
    assert.equal(game.cross.frame, 0, `repetição ${n}`);
    run(0.1 * n);
    release();
    game.update(1 / 60);
    assert.deepEqual([game.cross.state, game.cross.frame, drawn().width], [IDLE, null, 500]);
    close(drawn().from, settings.crop.left);
    close(drawn().to, 1);
  }
  assert.deepEqual(resources(game), before);
});

test('a malha cobre a mesma área nas duas imagens e não corta a arte', async (t) => {
  const { game } = await ready(t);
  const { left, top } = settings.crop;
  const bounds = game.cross.mesh.getBoundingInfo().boundingBox;
  const width = bounds.maximum.x - bounds.minimum.x;
  const height = bounds.maximum.y - bounds.minimum.y;
  close(width / height, (500 * (1 - left)) / (666 * (1 - top)), 1e-4);
  for (const [file, frames] of [['held_cross.png', 1], ['using_cross.png', settings.frames]]) {
    const png = readPngAlpha(projectPath(`assets/sprites/items/${file}`));
    assert.deepEqual([png.width, png.height], [500 * frames, 666], file);
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        if (png.alpha(x, y) < 128) continue;
        assert.ok((x % 500) >= left * 500 && y >= top * 666, `${file}: pixel cortado em ${x},${y}`);
      }
    }
  }
});

test('as imagens são carregadas na resolução original, uma única vez', async (t) => {
  const { game, spriteManager } = await ready(t);
  for (const [id, width] of [[settings.sprite, 500], [settings.useSprite, 2500]]) {
    const record = spriteManager.get(id);
    assert.deepEqual([record.textureWidth, record.textureHeight], [width, 666], id);
  }
  assert.equal(game.scene.materials.filter((m) => m.name.includes('_cross')).length, 1);
  assert.equal(game.scene.textures.filter((x) => x.getSize().width === 2500).length, 1);
});

test('mudar a resolução dos sprites no meio do uso mantém o quadro e os recursos', async (t) => {
  const { game, equip, hold, run, assertFrame } = await ready(t);
  equip();
  hold();
  run(1);
  const before = resources(game);
  await game.setSpriteResolution(0.5);
  assert.deepEqual(resources(game), before);
  assert.equal(game.cross.frame, LAST);
  assertFrame(LAST);
});

// ---------------------------------------------------------------- Exorcismo e interrupções

test('com a cruz equipada, segurar sobre a entidade exorciza no mesmo tempo de antes', async (t) => {
  const { game, face, equip, hold, run } = await ready(t);
  face();
  equip();
  hold();
  const expected = settings.raiseTime * CONFIG.exorcism.requiredRaise + CONFIG.exorcism.duration;
  run(expected - 0.1);
  assert.equal(game.entity.state, 'exorcizing');
  assert.equal(game.cross.frame, LAST);
  run(0.2);
  assert.equal(game.entity.state, 'exorcised');
  assert.equal(game.cross.state, USING, 'a cruz segue em uso enquanto o botão está pressionado');
});

test('usar sem mirar em nada anima, sem progresso', async (t) => {
  const { game, equip, hold, run } = await ready(t);
  equip();
  game.view.look(Math.PI / CONFIG.camera.mouseSensitivity, 0);
  hold();
  run(2);
  assert.equal(game.target, null);
  assert.deepEqual([game.cross.state, game.cross.frame, game.entity.progress], [USING, LAST, 0]);
});

test('equipar com o botão já pressionado não usa; é preciso apertar de novo', async (t) => {
  const { game, face, hold, release, key, run } = await ready(t);
  face();
  hold();
  key('Digit1');
  run(1);
  assert.deepEqual([game.cross.state, game.entity.progress], [IDLE, 0]);
  release();
  run(0.1);
  hold();
  run(1);
  assert.equal(game.cross.state, USING);
  assert.ok(game.entity.progress > 0);
});

test('guardar durante o uso encerra o exorcismo e mantém o progresso', async (t) => {
  const { game, face, equip, hold, key, run } = await ready(t);
  face();
  equip();
  hold();
  run(1.5);
  const { progress } = game.entity;
  key('KeyG');
  run(1);
  assert.deepEqual([game.cross.state, game.entity.state], [UNEQUIPPED, 'watching']);
  close(game.entity.progress, progress, 0.02);
});

for (const [name, open, close_] of [
  ['a pausa', (g) => g.pause(), (g) => g.resume()],
  ['o caderno', (g) => g.openJournal(), (g) => g.closeNotebook()],
  ['um documento', (g) => g.openDocument('diario'), (g) => g.closeNotebook()],
]) {
  test(`abrir ${name} durante o uso volta ao held cross e exige apertar de novo`, async (t) => {
    const { game, face, equip, hold, key, run, drawn } = await ready(t);
    face();
    equip();
    hold();
    run(1.5);
    const { progress } = game.entity;
    open(game);
    assert.deepEqual([game.cross.state, game.cross.frame, drawn().width], [IDLE, null, 500]);
    assert.equal(game.cross.root.isEnabled(), true);
    key('Digit1');
    key('KeyG');
    hold();
    run(2);
    assert.equal(game.inventory.selected, 'cross', 'as teclas de item não valem com a tela aberta');
    assert.equal(game.entity.progress, progress);
    await close_(game);
    run(0.5);
    assert.deepEqual([game.mode, game.cross.state, game.entity.progress], ['playing', IDLE, progress]);
    hold();
    run(1);
    assert.ok(game.entity.progress > progress);
  });
}

test('perder o foco da janela durante o uso pausa com a cruz em repouso', async (t) => {
  const { game, dom, equip, hold, run } = await ready(t);
  equip();
  hold();
  run(0.5);
  emit(dom.window, 'blur');
  assert.deepEqual([game.mode, game.cross.state, game.cross.frame], ['paused', IDLE, null]);
});

test('voltar ao menu guarda a cruz', async (t) => {
  const { game, equip } = await ready(t);
  equip();
  game.pause();
  game.quitToMenu();
  assert.deepEqual([game.inventory.selected, game.cross.state, game.cross.root.isEnabled()], [null, UNEQUIPPED, false]);
});

test('a interface sabe qual item está selecionado e quando a cruz está em uso', async (t) => {
  const { game, equip, hold, run } = await ready(t);
  let hud;
  game.onHud = (state) => {
    hud = state;
  };
  run(0.1);
  assert.deepEqual([hud.item, hud.raised], [null, false]);
  equip();
  assert.deepEqual([hud.item, hud.raised], ['cross', false]);
  hold();
  run(1);
  assert.deepEqual([hud.item, hud.raised], ['cross', true]);
});

test('a cruz não consome o olhar: a câmera gira igual durante o uso', async (t) => {
  const { game, dom, equip, hold, run } = await ready(t);
  equip();
  hold();
  const { yaw } = game.view;
  emit(dom.document, 'pointermove', { movementX: 100, movementY: 0, buttons: 1 });
  run(0.5);
  close(game.view.yaw - yaw, 100 * CONFIG.camera.mouseSensitivity, 1e-4);
});
