/** Menu, jogo, pausa e retomada integrados (NullEngine e DOM falso). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../helpers/world.js';
import { emit } from '../helpers/dom.js';

async function ready(t, options) {
  const context = createGame(options);
  t.after(() => context.game.dispose());
  await context.game.init();
  context.run = (seconds) => {
    for (let i = 0; i < seconds * 60; i += 1) context.game.update(1 / 60);
  };
  return context;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('no menu a câmera balança e os controles não movem o jogador', async (t) => {
  const { game, press, run } = await ready(t);
  press('KeyW');
  run(2);
  assert.equal(game.player.position.z, 0);
  assert.notEqual(game.view.camera.rotation.y, 0);
});

test('jogar captura o mouse; andar e olhar funcionam juntos', async (t) => {
  const { game, dom, press, run, changes } = await ready(t);
  assert.equal(await game.play(), 'playing');
  assert.deepEqual(changes.at(-1), { mode: 'playing', control: 'lock', notice: null });
  emit(dom.document, 'pointermove', { movementX: Math.PI / 2 / 0.0022 / 4, movementY: 0 });
  emit(dom.document, 'pointermove', { movementX: Math.PI / 2 / 0.0022 / 4, movementY: 0 });
  emit(dom.document, 'pointermove', { movementX: Math.PI / 2 / 0.0022 / 4, movementY: 0 });
  emit(dom.document, 'pointermove', { movementX: Math.PI / 2 / 0.0022 / 4, movementY: 0 });
  press('KeyW');
  run(1);
  assert.ok(game.player.position.x > 1, 'andou para onde está olhando');
  assert.ok(Math.abs(game.player.position.z) < 0.2);
  const { position } = game.view.camera;
  assert.ok(Math.abs(position.x - game.player.position.x) < 0.1);
  assert.ok(game.lights.lantern.direction.x > 0.99, 'lanterna aponta para onde o jogador olha');
  assert.ok(Math.abs(game.lights.lantern.position.x - position.x) < 0.5, 'lanterna acompanha');
});

for (const [name, interrupt] of [
  ['ESC do Chrome (captura perdida)', (dom) => dom.loseLock()],
  ['tecla ESC', (dom) => emit(dom.window, 'keydown', { code: 'Escape' })],
  ['janela sem foco', (dom) => emit(dom.window, 'blur')],
]) {
  test(`pausa por ${name} e retomada`, async (t) => {
    const { game, dom, press, run, input } = await ready(t);
    await game.play();
    press('KeyW');
    run(1);
    interrupt(dom);
    await settle();
    assert.equal(game.mode, 'paused');
    assert.equal(input.isLocked, false);
    const frozen = [game.player.position.z, ...game.view.camera.position.asArray()];
    press('KeyW');
    run(1);
    assert.deepEqual([game.player.position.z, ...game.view.camera.position.asArray()], frozen);
    assert.equal(await game.resume(), 'playing');
    run(0.5);
    assert.equal(game.player.position.z, frozen[0], 'nenhuma tecla fica presa');
    press('KeyW');
    run(0.5);
    assert.ok(game.player.position.z > frozen[0] + 1);
  });
}

test('recusa de captura leva à pausa com aviso, e dá para tentar de novo', async (t) => {
  const { game, dom, changes } = await ready(t, { lock: 'deny' });
  assert.equal(await game.play(), 'paused');
  assert.equal(changes.at(-1).notice, 'lock-denied');
  assert.equal(await game.resume(), 'paused');
  dom.lock = 'grant';
  assert.equal(await game.resume(), 'playing');
});

test('recusa permite jogar sem captura', async (t) => {
  const { game, dom, changes, press, run } = await ready(t, { lock: 'reject' });
  await game.play();
  game.resumeWithoutLock();
  assert.equal(changes.at(-1).control, 'drag');
  emit(dom.element, 'pointerdown', { button: 0 });
  emit(dom.document, 'pointermove', { movementX: 200, movementY: 0 });
  press('KeyW');
  run(1);
  assert.ok(game.view.yaw > 0.4 && game.player.position.z > 1);
  emit(dom.window, 'keydown', { code: 'Escape' });
  assert.equal(game.mode, 'paused');
});

test('sem Pointer Lock no navegador, joga arrastando', async (t) => {
  const { game, changes } = await ready(t, { lock: 'unsupported' });
  assert.equal(await game.play(), 'playing');
  assert.equal(changes.at(-1).control, 'drag');
});

test('voltar ao menu reinicia a posição', async (t) => {
  const { game, press, run } = await ready(t);
  await game.play();
  press('KeyW');
  run(1);
  game.pause();
  game.quitToMenu();
  assert.equal(game.mode, 'menu');
  assert.equal(game.player.position.z, 0);
  assert.equal(await game.play(), 'playing');
});

test('captura que termina depois de voltar ao menu é descartada', async (t) => {
  const { game, input } = await ready(t);
  const pending = game.play();
  game.quitToMenu();
  assert.equal(await pending, 'menu');
  await settle();
  assert.equal(input.isLocked, false);
});

test('jogar de novo logo após cancelar uma captura funciona', async (t) => {
  const { game, input } = await ready(t);
  const first = game.play();
  game.quitToMenu();
  const second = game.play();
  await Promise.all([first, second]);
  await settle();
  assert.equal(game.mode, 'playing');
  assert.equal(input.isLocked, true);
});

test('cliques repetidos em Jogar não duplicam a sessão', async (t) => {
  const { game, dom, changes } = await ready(t);
  await Promise.all([game.play(), game.play()]);
  assert.equal(game.mode, 'playing');
  assert.equal(dom.requests, 1);
  assert.equal(changes.filter((c) => c.mode === 'playing').length, 1);
});
