import test from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../../src/core/input.js';
import { createFakeDom, emit } from '../helpers/dom.js';

function setup(options, mode = 'lock') {
  const dom = createFakeDom(options);
  const input = new InputController(dom);
  const reasons = [];
  input.onPauseRequest = (reason) => reasons.push(reason);
  input.attach();
  if (mode) input.enable(mode);
  const down = (code, extra) => emit(dom.window, 'keydown', { code, ...extra });
  const up = (code) => emit(dom.window, 'keyup', { code });
  const move = (movementX, movementY) => emit(dom.document, 'pointermove', { movementX, movementY });
  return { dom, input, reasons, down, up, move };
}

test('lê W, A, S, D e Shift', () => {
  const { input, down, up } = setup();
  const cases = [['KeyW', 1, 0], ['KeyS', -1, 0], ['KeyA', 0, -1], ['KeyD', 0, 1]];
  for (const [code, forward, right] of cases) {
    assert.equal(down(code).defaultPrevented, true);
    assert.deepEqual(input.getIntent(), { forward, right, run: false }, code);
    up(code);
  }
  for (const shift of ['ShiftLeft', 'ShiftRight']) {
    down(shift);
    assert.equal(input.getIntent().run, true);
    up(shift);
  }
  assert.deepEqual(input.getIntent(), { forward: 0, right: 0, run: false });
});

test('teclas opostas se anulam e combinações funcionam', () => {
  const { input, down, up } = setup();
  down('KeyW'); down('KeyS');
  assert.equal(input.getIntent().forward, 0);
  up('KeyS'); down('KeyD'); down('KeyD', { repeat: true });
  assert.deepEqual(input.getIntent(), { forward: 1, right: 1, run: false });
});

test('ignora atalhos do navegador, outras teclas e comandos quando desativado', () => {
  const { input, down } = setup();
  assert.equal(down('KeyW', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(down('KeyQ').defaultPrevented, false);
  assert.equal(input.getIntent().forward, 0);
  input.disable();
  assert.equal(down('KeyW').defaultPrevented, false);
  assert.equal(input.getIntent().forward, 0);
});

test('perda de foco e aba oculta soltam as teclas e pedem pausa', () => {
  const { dom, input, reasons, down } = setup();
  down('KeyW');
  emit(dom.window, 'blur');
  assert.equal(input.getIntent().forward, 0);
  dom.document.visibilityState = 'hidden';
  emit(dom.document, 'visibilitychange');
  assert.deepEqual(reasons, ['focus-lost', 'focus-lost']);
});

test('ESC e perda da captura pedem pausa', () => {
  const { dom, reasons, down } = setup();
  dom.grant();
  down('Escape');
  down('Escape', { repeat: true });
  dom.loseLock();
  assert.deepEqual(reasons, ['escape', 'lock-lost']);
});

test('com captura, acumula o movimento do mouse e descarta saltos', () => {
  const { dom, input, move } = setup();
  move(50, 50); // ainda sem captura
  dom.grant();
  move(10, -4); move(5, 2); move(5000, 0);
  assert.deepEqual(input.consumeLook(), { dx: 15, dy: -2 });
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 });
});

test('sem captura, olha somente enquanto o botão esquerdo está pressionado', () => {
  const { dom, input, move } = setup({ lock: 'unsupported' }, 'drag');
  move(10, 10);
  emit(dom.element, 'pointerdown', { button: 2 });
  move(10, 10);
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 });
  emit(dom.element, 'pointerdown', { button: 0 });
  move(7, 3);
  emit(dom.window, 'pointerup', { button: 0 });
  move(10, 10);
  assert.deepEqual(input.consumeLook(), { dx: 7, dy: 3 });
});

for (const [lock, expected] of [
  ['grant', 'locked'], ['legacy', 'locked'], ['deny', 'denied'], ['reject', 'denied'],
  ['throw', 'denied'], ['unsupported', 'unsupported'],
]) {
  test(`pedido de captura (${lock}) resolve para "${expected}"`, async () => {
    const { input } = setup({ lock }, null);
    assert.equal(await input.requestLock(), expected);
    assert.equal(input.pendingRequest, null);
  });
}

test('navegador sem resposta não trava o jogo, e captura atrasada é devolvida', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { dom, input } = setup({ lock: 'silent' }, null);
  const request = input.requestLock();
  assert.equal(input.requestLock(), request, 'não duplica pedidos');
  t.mock.timers.tick(2000);
  assert.equal(await request, 'denied');
  assert.equal(dom.requests, 1);
  dom.grant();
  await Promise.resolve();
  assert.equal(input.isLocked, false);
});

test('disable libera o ponteiro sem pedir pausa; detach remove os ouvintes', async () => {
  const { dom, input, reasons, down } = setup();
  dom.grant();
  input.disable();
  await Promise.resolve();
  assert.equal(input.isLocked, false);
  assert.deepEqual(reasons, []);
  input.enable('lock');
  input.detach();
  down('KeyW');
  assert.equal(input.getIntent().forward, 0);
});
