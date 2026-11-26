/**
 * Captura REAL do mouse e ESC real, em um Chrome com janela dentro de um servidor
 * X isolado (Xephyr). Uma janela aparece na tela durante o teste.
 *
 * Opcional: npm run test:real  (requer Xephyr e python3-xlib)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';

const DISPLAY = process.env.FE_XDISPLAY ?? ':77';
const missing = () => {
  if (!findChrome()) return 'Chrome não encontrado';
  if (!existsSync('/usr/bin/Xephyr')) return 'Xephyr não instalado';
  if (!process.env.DISPLAY) return 'sem sessão gráfica';
  try {
    execFileSync('python3', ['-I', '-c', 'import Xlib'], { stdio: 'ignore' });
  } catch {
    return 'python3-xlib não instalado';
  }
  return false;
};

test('Pointer Lock real: jogar, olhar, andar, ESC e continuar', { skip: missing(), timeout: 120000 }, async (t) => {
  const xephyr = spawn('Xephyr', [DISPLAY, '-screen', '1280x720', '-title', 'Teste Forest Exorcist'], { stdio: 'ignore' });
  t.after(() => xephyr.kill());
  await delay(1500);
  assert.equal(xephyr.exitCode, null, `Xephyr não iniciou em ${DISPLAY}`);

  const server = await startServer(projectPath('.'));
  t.after(() => server.close());
  const page = await launchChrome({ display: DISPLAY });
  t.after(() => page.close());

  const script = projectPath('tests/real/xinput.py');
  const send = (...commands) => execFileSync('python3', ['-I', script, DISPLAY, ...commands]);
  const state = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    return { mode: game.mode, locked: Boolean(document.pointerLockElement), yaw: game.view.yaw,
      pitch: game.view.pitch, x: game.player.position.x, z: game.player.position.z };
  })()`);
  const click = async (action) => {
    const [x, y] = await page.evaluate(`(() => {
      const box = document.querySelector('[data-action="${action}"]').getBoundingClientRect();
      return [Math.round(box.x + box.width / 2 + screenX), Math.round(box.y + box.height / 2 + screenY)];
    })()`);
    send(`move:${x}:${y}`, 'wait:0.2', 'click');
    await delay(900);
  };

  await page.open(server.url);
  await page.waitFor('window.forestExorcist?.status === "ready"');

  await click('play');
  assert.deepEqual([(await state()).mode, (await state()).locked], ['playing', true]);

  send(...Array(10).fill('rel:30:0'), ...Array(10).fill('rel:0:20'));
  await delay(400);
  let now = await state();
  assert.ok(Math.abs(now.yaw - 300 * 0.0022) < 0.01, `yaw ${now.yaw}`);
  assert.ok(Math.abs(now.pitch - 200 * 0.0022) < 0.01, `pitch ${now.pitch}`);

  send(...Array(60).fill('rel:0:30'));
  await delay(400);
  assert.ok(Math.abs((await state()).pitch - (80 * Math.PI) / 180) < 0.001);

  // Com um botão pressionado a câmera continua respondendo.
  const level = await state();
  send('buttondown', ...Array(10).fill('rel:30:0'), 'buttonup');
  await delay(400);
  assert.ok(Math.abs((await state()).yaw - level.yaw - 300 * 0.0022) < 0.01, 'travou com botão pressionado');

  const before = await state();
  send('down:w', 'wait:1', 'up:w');
  await delay(300);
  const walked = Math.hypot((await state()).x - before.x, (await state()).z - before.z);
  assert.ok(walked > 2.5 && walked < 4, `andou ${walked}`);

  send('down:Escape', 'up:Escape');
  await delay(1500); // o Chrome recusa uma nova captura logo após o ESC
  now = await state();
  assert.deepEqual([now.mode, now.locked], ['paused', false]);
  if (process.env.FE_SCREENSHOTS) {
    mkdirSync(process.env.FE_SCREENSHOTS, { recursive: true });
    writeFileSync(join(process.env.FE_SCREENSHOTS, '20-pausa-real.png'), await page.screenshot());
  }

  await click('resume');
  now = await state();
  assert.deepEqual([now.mode, now.locked], ['playing', true]);

  // ESC seguido de Continuar imediato: pode ser recusado, mas nunca trava.
  send('down:Escape', 'up:Escape');
  await delay(200);
  await click('resume');
  if ((await state()).mode !== 'playing') {
    await delay(1500);
    await click('resume');
  }
  assert.equal((await state()).mode, 'playing');
  assert.deepEqual(page.log.errors.filter((e) => !/pointer ?lock/i.test(e)), []);
});
