/** Cruz e exorcismo no Google Chrome, com o botão do mouse de verdade. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';
import { CONFIG } from '../../src/config.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';

describe('Exorcismo no Chrome', { skip }, () => {
  let page;
  let server;

  before(async () => {
    server = await startServer(projectPath('.'));
    page = await launchChrome();
  });
  after(async () => {
    await page?.close();
    await server?.close();
  });

  const shot = async (name) => {
    if (!process.env.FE_SCREENSHOTS) return;
    mkdirSync(process.env.FE_SCREENSHOTS, { recursive: true });
    writeFileSync(join(process.env.FE_SCREENSHOTS, `${name}.png`), await page.screenshot());
  };
  const state = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    const visible = (id) => !document.getElementById(id).hidden;
    return {
      mode: game.mode, cross: game.cross.amount, entity: game.entity.state,
      progress: game.entity.progress, entityDrawn: game.entity.mesh.isEnabled(),
      aim: document.getElementById('crosshair').dataset.aim,
      indicator: visible('cross-indicator'), bar: visible('exorcism'),
      barWidth: document.getElementById('exorcism-fill').style.width,
      message: visible('hud-message') ? document.getElementById('hud-message').textContent : null,
    };
  })()`);
  const noProblems = () => {
    assert.deepEqual(page.log.errors.filter((e) => !/pointer ?lock/i.test(e)), []);
    assert.deepEqual(page.log.warnings.filter((w) => !/GL Driver Message|pointer ?lock/i.test(w)), []);
    const external = page.log.requests.filter((url) => !url.startsWith(server.url) && !/^(data|blob):/.test(url));
    assert.deepEqual(external, []);
  };

  /** Entra no jogo sem captura do mouse (caminho real no Chrome sem janela). */
  const play = async () => {
    await page.open(server.url);
    await page.waitFor('window.forestExorcist?.status === "ready"');
    await page.evaluate('window.forestExorcist.game.scene.whenReadyAsync().then(() => true)');
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await page.click('[data-action="resume-nolock"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    await summon();
    await delay(300);
  };
  /** Etapa 4 isolada: entidade presente no lugar antigo, sem decisões próprias. */
  const summon = () => page.evaluate('window.forestExorcist.game.haunting.summon(1.3, 11, { pinned: true })');
  /** Posiciona o jogador em (x, z) olhando para a entidade (mais um desvio). */
  const aim = async (x = 0.5, z = 6, offset = 0) => {
    await page.evaluate(`(() => {
      const { game } = window.forestExorcist;
      game.player.teleport(${x}, ${z});
      game.view.reset(game.player.position);
      const c = game.entity.center;
      const dx = c.x - ${x}, dz = c.z - ${z};
      game.view.look((Math.atan2(dx, dz) + ${offset}) / 0.0022,
        Math.atan2(1.7 - c.y, Math.hypot(dx, dz)) / 0.0022);
    })()`);
    await delay(400);
  };
  const button = async (type, buttons) => {
    await page.send('Input.dispatchMouseEvent', { type, x: 640, y: 360, button: 'left', buttons, clickCount: 1 });
  };
  /** Equipa a cruz (tecla 1) se estiver guardada e aperta o botão esquerdo. */
  const press = async () => {
    await page.evaluate('(() => { const { game } = window.forestExorcist; if (!game.inventory.selected) game.selectSlot(1); })()');
    await button('mousePressed', 1);
  };
  const release = () => button('mouseReleased', 0);

  test('sem o botão, nada aparece; a mira identifica a entidade', async () => {
    await play();
    let now = await state();
    assert.deepEqual([now.cross, now.indicator, now.bar, now.aim, now.message], [0, false, false, 'idle', null]);
    await aim();
    now = await state();
    assert.deepEqual([now.aim, now.progress, now.bar, now.cross], ['target', 0, false, 0]);
    await shot('20-entidade-identificada');
    await aim(0.5, 6, 0.6);
    assert.equal((await state()).aim, 'idle');
    noProblems();
  });

  /** Pixels amarelados (latão) na área onde a cruz fica. */
  const brass = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    game.scene.render();
    const gl = game.engine._gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const width = Math.floor(w * 0.35), height = Math.floor(h * 0.4);
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(Math.floor(w * 0.55), 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 100 && data[i] > data[i + 2] * 1.6 && data[i + 1] > data[i + 2] * 1.2) count += 1;
    }
    return count;
  })()`);

  test('usar a cruz a desenha na tela; guardada, ela some', async () => {
    await play();
    // De costas para a entidade, com a lanterna apagada: só a cruz muda a área.
    await page.evaluate(`(() => { const { game } = window.forestExorcist;
      game.view.look(Math.PI / 0.0022, 0); game.lights.flashlight.setOn(false); })()`);
    await delay(400);
    const without = await brass();
    await press();
    await page.waitFor('window.forestExorcist.game.cross.amount === 1');
    await delay(200);
    assert.equal((await state()).indicator, true);
    const withCross = await brass();
    assert.ok(withCross > without + 800, `cruz não desenhada: ${without} -> ${withCross}`);
    await shot('21-cruz-erguida');
    await release();
    await page.waitFor('window.forestExorcist.game.cross.amount === 0');
    assert.equal((await state()).indicator, false);
    await page.evaluate('window.forestExorcist.game.stowItem()');
    await page.waitFor('!window.forestExorcist.game.cross.visible');
    await delay(200);
    assert.ok((await brass()) <= without + 50);
    noProblems();
  });

  test('exorcismo completo: barra, desaparecimento suave e mensagem', async () => {
    await play();
    await aim();
    const start = Date.now();
    await press();
    await page.waitFor('window.forestExorcist.game.entity.progress > 0.4');
    const middle = await state();
    assert.deepEqual([middle.entity, middle.aim, middle.bar], ['exorcizing', 'exorcising', true]);
    assert.ok(parseInt(middle.barWidth, 10) >= 40, middle.barWidth);
    await shot('22-exorcizando');
    await page.waitFor('window.forestExorcist.game.entity.state === "exorcised"');
    const seconds = (Date.now() - start) / 1000;
    assert.ok(seconds >= CONFIG.exorcism.duration - 0.1, `rápido demais: ${seconds}s`);
    await delay(500);
    const done = await state();
    assert.deepEqual([done.bar, done.aim, done.message], [false, 'idle', CONFIG.exorcism.message]);
    assert.equal(done.entityDrawn, true, 'ainda desaparecendo');
    await shot('23-desaparecendo');
    await release();
    await page.waitFor('!window.forestExorcist.game.entity.mesh.isEnabled()');
    await page.waitFor('document.getElementById("hud-message").hidden');
    await shot('24-concluido');
    noProblems();
  });

  test('soltar o botão ou perder a mira interrompe', async () => {
    await play();
    await aim();
    await press();
    await page.waitFor('window.forestExorcist.game.entity.progress > 0.2');
    await release();
    await delay(300);
    const released = await state();
    await delay(700);
    const later = await state();
    assert.equal(later.progress, released.progress);
    assert.equal(later.entity, 'watching');
    await press();
    await page.waitFor(`window.forestExorcist.game.entity.progress > ${released.progress + 0.1}`);
    await page.evaluate('window.forestExorcist.game.view.look(900, 0)');
    await delay(400);
    const lost = await state();
    await delay(700);
    assert.equal((await state()).progress, lost.progress);
    assert.deepEqual([lost.entity, lost.aim, lost.cross], ['watching', 'idle', 1]);
    await release();
    noProblems();
  });

  test('pausa congela o exorcismo e a retomada continua; menu reinicia', async () => {
    await play();
    await aim();
    await press();
    await page.waitFor('window.forestExorcist.game.entity.progress > 0.25');
    await page.key('Escape', 27);
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await release();
    const paused = await state();
    await delay(900);
    assert.deepEqual(await state(), paused);
    await page.click('[data-action="resume"]');
    await page.waitFor('!document.querySelector(\'[data-action="resume-nolock"]\').hidden');
    await page.click('[data-action="resume-nolock"]');
    await delay(500);
    assert.equal((await state()).progress, paused.progress);
    assert.equal((await state()).cross, 0);
    await press();
    await page.waitFor(`window.forestExorcist.game.entity.progress > ${paused.progress + 0.1}`);
    await release();
    await page.click('[data-action="pause"]');
    await page.click('[data-screen="pause"] [data-action="back"]');
    const menu = await state();
    assert.deepEqual([menu.mode, menu.entity, menu.progress, menu.cross], ['menu', 'dormant', 0, 0]);
    noProblems();
  });

  test('com o ponteiro capturado, o botão esquerdo também funciona', async () => {
    await page.open(server.url);
    await page.waitFor('window.forestExorcist?.status === "ready"');
    await page.evaluate(`(() => {
      let element = null;
      const set = (value) => { element = value; document.dispatchEvent(new Event('pointerlockchange')); };
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => element });
      document.exitPointerLock = () => queueMicrotask(() => set(null));
      HTMLCanvasElement.prototype.requestPointerLock = function () {
        return Promise.resolve().then(() => set(this));
      };
    })()`);
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    await summon();
    await aim();
    await press();
    await page.waitFor('window.forestExorcist.game.entity.progress > 0.2');
    await release();
    await page.waitFor('window.forestExorcist.game.cross.amount === 0');
    noProblems();
  });

  test('desempenho com a cruz erguida durante o exorcismo', async () => {
    await play();
    await aim();
    await press();
    const result = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const counter = new window.BABYLON.SceneInstrumentation(game.scene);
      let draws = 0, frames = 0;
      const start = performance.now();
      while (performance.now() - start < 3000) {
        await new Promise(requestAnimationFrame);
        draws = Math.max(draws, counter.drawCallsCounter.current);
        frames += 1;
      }
      counter.dispose();
      return { draws, fps: frames / 3, lights: game.scene.lights.length,
        size: [game.engine.getRenderWidth(), game.engine.getRenderHeight()] };
    })()`);
    await release();
    // v0.4.1: a vegetação passou de instâncias para malhas por região. São mais
    // chamadas de desenho (eram 24), mas cada instância custava quase uma chamada
    // no Chrome sem placa de vídeo, e o tempo total de desenho caiu (ver README).
    assert.ok(result.draws <= 40, `${result.draws} chamadas de desenho`);
    assert.equal(result.lights, 4); // três externas e a lamparina da cabana
    assert.deepEqual(result.size, [853, 480]);
    // Limite frouxo: o Chrome sem janela desenha por software.
    assert.ok(result.fps > 10, `${result.fps} FPS`);
    noProblems();
  });
});
