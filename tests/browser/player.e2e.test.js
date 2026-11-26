/**
 * Movimentação, câmera, colisões, pausa e Pointer Lock no Google Chrome.
 *
 * O Chrome sem janela recusa a captura do mouse: isso testa a recusa de verdade.
 * O caminho de sucesso usa uma captura simulada na página (a captura real, com
 * ESC, está em tests/real/).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';

/** Substitui a Pointer Lock API por uma versão que sempre concede. */
const FAKE_LOCK = `(() => {
  let element = null;
  const set = (value) => { element = value; document.dispatchEvent(new Event('pointerlockchange')); };
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => element });
  document.exitPointerLock = () => queueMicrotask(() => set(null));
  HTMLCanvasElement.prototype.requestPointerLock = function () {
    return Promise.resolve().then(() => set(this));
  };
})()`;

describe('Exploração no Chrome', { skip }, () => {
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

  const load = async () => {
    await page.open(server.url);
    await page.waitFor('window.forestExorcist?.status === "ready"');
    // Os primeiros quadros (compilação de shaders) são lentos no Chrome sem
    // janela e distorceriam os testes que medem distância por tempo.
    await page.evaluate('window.forestExorcist.game.scene.whenReadyAsync().then(() => true)');
    await delay(500);
  };
  const state = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    const { input } = game;
    const { camera } = game.view;
    return {
      mode: game.mode, control: input.mode, screen: document.body.dataset.view,
      x: game.player.position.x, z: game.player.position.z, moving: game.player.state,
      yaw: camera.rotation.y, pitch: camera.rotation.x, roll: camera.rotation.z,
      eye: camera.position.y, locked: input.isLocked,
    };
  })()`);
  const shot = async (name) => {
    if (!process.env.FE_SCREENSHOTS) return;
    mkdirSync(process.env.FE_SCREENSHOTS, { recursive: true });
    writeFileSync(join(process.env.FE_SCREENSHOTS, `${name}.png`), await page.screenshot());
  };
  const hold = async (codes, milliseconds) => {
    for (const code of codes) await page.keyDown(code);
    await delay(milliseconds);
    const during = await state();
    for (const code of [...codes].reverse()) await page.keyUp(code);
    await delay(300);
    return during;
  };
  const drag = async (dx, dy) => {
    await page.mouse('mouseMoved', 640, 360);
    await page.mouse('mousePressed', 640, 360, 1);
    for (let i = 1; i <= 10; i += 1) await page.mouse('mouseMoved', 640 + (dx * i) / 10, 360 + (dy * i) / 10, 1);
    await page.mouse('mouseReleased', 640 + dx, 360 + dy);
    await delay(300);
  };
  /** Entra no jogo pela alternativa sem captura (caminho real no Chrome sem janela). */
  const playWithoutLock = async () => {
    await load();
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await page.click('[data-action="resume-nolock"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
  };
  const noProblems = () => {
    assert.deepEqual(page.log.errors, []);
    assert.deepEqual(page.log.warnings.filter((w) => !/GL Driver Message/.test(w)), []);
  };

  test('captura recusada pelo navegador: pausa com explicação, sem travar', async () => {
    await load();
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    const screen = await page.evaluate(`({
      title: document.querySelector('[data-screen="pause"] h2').textContent,
      notice: !document.getElementById('pause-notice').hidden,
      alternative: !document.querySelector('[data-action="resume-nolock"]').hidden,
      text: document.querySelector('[data-screen="pause"]').textContent,
    })`);
    assert.equal(screen.title, 'PAUSADO');
    assert.ok(screen.notice && screen.alternative);
    assert.match(screen.text, /libera o mouse/);
    await shot('10-captura-recusada');
    await page.click('[data-action="resume"]');
    await delay(300);
    assert.equal((await state()).mode, 'paused');
    assert.deepEqual(page.log.errors.filter((e) => !/pointer ?lock/i.test(e)), []);
  });

  test('WASD anda, Shift corre e a câmera mantém a altura', async () => {
    await playWithoutLock();
    const during = await hold(['KeyW'], 900);
    assert.equal(during.moving, 'walking');
    const forward = await state();
    assert.ok(forward.z > 2 && Math.abs(forward.x) < 0.01, JSON.stringify(forward));
    await hold(['KeyS'], 500);
    const back = await state();
    assert.ok(back.z < forward.z - 1);
    await hold(['KeyA'], 400);
    const left = await state();
    assert.ok(left.x < -0.8);
    await hold(['KeyD'], 400);
    assert.ok((await state()).x > left.x + 0.8);
    const running = await hold(['ShiftLeft', 'KeyS'], 700);
    assert.equal(running.moving, 'running');
    await page.waitFor('Math.abs(window.forestExorcist.game.view.camera.position.y - 1.7) < 0.002');
    const stopped = await state();
    assert.equal(stopped.moving, 'idle');
    assert.ok(Math.abs(stopped.eye - 1.7) < 0.002, `altura ${stopped.eye}`);
    noProblems();
  });

  test('o mouse olha nos dois eixos, com limite vertical e sem inclinar', async () => {
    await playWithoutLock();
    await drag(200, 100);
    const looked = await state();
    assert.ok(looked.yaw > 0.3 && looked.pitch > 0.15, JSON.stringify(looked));
    for (let i = 0; i < 6; i += 1) await drag(0, 300);
    const down = await state();
    assert.ok(Math.abs(down.pitch - (80 * Math.PI) / 180) < 0.001, `pitch ${down.pitch}`);
    assert.equal(down.roll, 0);
    await shot('11-olhando-para-baixo');
    // Mover o mouse sem o botão pressionado não gira a câmera.
    await page.mouse('mouseMoved', 100, 100);
    await page.mouse('mouseMoved', 900, 500);
    await delay(200);
    assert.ok(Math.abs((await state()).yaw - down.yaw) < 1e-6);
    // Andar olhando para o chão continua horizontal.
    await hold(['KeyW'], 500);
    // O balanço da caminhada leva alguns quadros para sumir.
    await page.waitFor('Math.abs(window.forestExorcist.game.view.camera.position.y - 1.7) < 0.002');
    const walked = await state();
    assert.ok(Math.hypot(walked.x, walked.z) > 1);
    assert.ok(Math.abs(walked.eye - 1.7) < 0.002);
    noProblems();
  });

  test('pedra bloqueia a passagem no navegador', async () => {
    await playWithoutLock();
    // Pedra fixa em (1.9, 4.6); parte de frente para ela.
    await page.evaluate('window.forestExorcist.game.player.teleport(1.9, 2.4)');
    const during = await hold(['KeyW'], 250);
    assert.equal(during.moving, 'walking');
    await page.evaluate(`(() => { const { game } = window.forestExorcist;
      window.__closest = 99;
      game.scene.onBeforeRenderObservable.add(() => {
        const { x, z } = game.player.position;
        window.__closest = Math.min(window.__closest, Math.hypot(x - 1.9, z - 4.6));
      }); })()`);
    await hold(['KeyW'], 1500);
    const closest = await page.evaluate('window.__closest');
    assert.ok(closest >= 0.45 * Math.cos(Math.PI / 8) + 0.35 - 0.002, `atravessou: ${closest}`);
    assert.ok(closest < 1.1, `não chegou à pedra: ${closest}`);
    await shot('12-junto-a-pedra');
    noProblems();
  });

  test('ESC pausa, a cena congela e Continuar retoma', async () => {
    await playWithoutLock();
    await shot('13-aviso-sem-captura');
    await page.keyDown('KeyW');
    await delay(300);
    await page.key('Escape', 27);
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    const paused = await state();
    assert.equal(paused.screen, 'pause');
    await delay(500);
    assert.deepEqual(await state(), paused);
    await shot('14-pausado');
    await page.keyUp('KeyW');
    await page.key('Escape', 27);
    assert.equal((await state()).mode, 'paused', 'ESC não sai da pausa nem volta ao menu');
    await page.click('[data-action="resume"]'); // recusado de novo: oferece a alternativa
    await page.waitFor('!document.querySelector(\'[data-action="resume-nolock"]\').hidden');
    await page.click('[data-action="resume-nolock"]');
    await hold(['KeyW'], 400);
    assert.ok((await state()).z > paused.z + 0.8);
    assert.deepEqual(page.log.errors.filter((e) => !/pointer ?lock/i.test(e)), []);
  });

  test('perder o foco da janela pausa o jogo', async () => {
    await playWithoutLock();
    await page.evaluate('window.dispatchEvent(new Event("blur"))');
    assert.equal((await state()).mode, 'paused');
  });

  test('botão Pausar e retorno ao menu principal', async () => {
    await playWithoutLock();
    await hold(['KeyW'], 400);
    await page.click('[data-action="pause"]');
    assert.equal((await state()).mode, 'paused');
    await page.click('[data-screen="pause"] [data-action="back"]');
    const menu = await state();
    assert.deepEqual([menu.mode, menu.screen, menu.x, menu.z], ['menu', 'main', 0, 0]);
  });

  test('com captura concedida: jogar, olhar, perder a captura e retomar', async () => {
    await load();
    await page.evaluate(FAKE_LOCK);
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    let now = await state();
    assert.deepEqual([now.control, now.locked, now.screen], ['lock', true, 'hud']);
    assert.equal(await page.evaluate('document.getElementById("drag-help").hidden'), true);
    assert.equal(await page.evaluate('document.activeElement === document.body'), true);
    await page.evaluate(`document.dispatchEvent(new PointerEvent('pointermove', { movementX: 150, movementY: -80 }))`);
    await delay(300);
    now = await state();
    assert.ok(now.yaw > 0.3 && now.pitch < -0.15);
    await shot('15-jogando');
    await page.evaluate('document.exitPointerLock()'); // o que o ESC do Chrome faz
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    assert.equal(await page.evaluate('document.getElementById("pause-notice").hidden'), true);
    await page.click('[data-action="resume"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    assert.equal((await state()).locked, true);
    noProblems();
  });

  test('sem Pointer Lock no navegador, o jogo funciona arrastando', async () => {
    await load();
    await page.evaluate('HTMLCanvasElement.prototype.requestPointerLock = undefined');
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    assert.equal((await state()).control, 'drag');
    assert.equal(await page.evaluate('document.getElementById("drag-help").hidden'), false);
    await drag(150, 0);
    assert.ok((await state()).yaw > 0.2);
    noProblems();
  });

  /** Brilho médio (0..255) de uma área central do chão, com a câmera parada. */
  const groundBrightness = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    game.scene.render();
    const gl = game.engine._gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const data = new Uint8Array(100 * 60 * 4);
    gl.readPixels(w / 2 - 50, h * 0.12, 100, 60, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return total / (data.length / 4);
  })()`);
  const pressF = async () => {
    await page.keyDown('KeyF');
    await page.keyUp('KeyF');
    await delay(200);
  };

  test('F liga e desliga a lanterna, que ilumina a trilha para onde se olha', async () => {
    await playWithoutLock();
    await drag(0, 120);
    const on = await groundBrightness();
    await shot('16-lanterna-ligada');
    await pressF();
    const off = await groundBrightness();
    await shot('17-lanterna-desligada');
    assert.ok(on > off * 1.25, `ligada ${on.toFixed(1)}, desligada ${off.toFixed(1)}`);
    assert.ok(off > 12, `sem lanterna ficou preto demais: ${off.toFixed(1)}`);
    await pressF();
    assert.ok(Math.abs((await groundBrightness()) - on) < 1);
    noProblems();
  });

  test('a lanterna também ilumina os sprites', async () => {
    await playWithoutLock();
    // Soma do vermelho (a luz é quente) olhando o pinheiro fixo bem de perto.
    const warmth = () => page.evaluate(`(() => {
      const { game } = window.forestExorcist;
      game.player.teleport(3.2, 7.5);
      game.view.reset(game.player.position);
      game.view.look(Math.atan2(2, 2) / 0.0022, 0);
      for (let i = 0; i < 40; i += 1) game.update(1 / 60);
      game.forest.ground.setEnabled(false);
      game.scene.render();
      const gl = game.engine._gl;
      const data = new Uint8Array(200 * 120 * 4);
      gl.readPixels(220, 120, 200, 120, gl.RGBA, gl.UNSIGNED_BYTE, data);
      game.forest.ground.setEnabled(true);
      let red = 0;
      for (let i = 0; i < data.length; i += 4) red += data[i];
      return red / (data.length / 4);
    })()`);
    const on = await warmth();
    await page.evaluate('window.forestExorcist.game.lights.flashlight.setOn(false)');
    const off = await warmth();
    assert.ok(on > off * 1.15, `ligada ${on.toFixed(1)}, desligada ${off.toFixed(1)}`);
    noProblems();
  });

  test('caminhada longa pela trilha, correndo e olhando em volta, sem erros', async () => {
    await playWithoutLock();
    await page.keyDown('ShiftLeft');
    await page.keyDown('KeyW');
    const result = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const start = performance.now();
      let frames = 0;
      while (performance.now() - start < 8000) {
        game.view.look(Math.sin(frames / 20) * 6, 0);
        await new Promise(requestAnimationFrame);
        frames += 1;
      }
      return { fps: frames / ((performance.now() - start) / 1000), travelled: game.player.travelled,
        enabled: game.forest.objects.filter((o) => o.isEnabled()).length, total: game.forest.objects.length,
        glError: game.engine._gl.getError() };
    })()`);
    await page.keyUp('KeyW');
    await page.keyUp('ShiftLeft');
    // Limite frouxo: o Chrome sem janela desenha por software.
    assert.ok(result.fps > 10, `${result.fps.toFixed(1)} FPS`);
    assert.ok(result.travelled > 5, `andou ${result.travelled}`);
    assert.ok(result.enabled < result.total);
    assert.equal(result.glError, 0);
    noProblems();
  });

  test('desempenho: poucas chamadas de desenho e resolução 640x360 em movimento', async () => {
    await playWithoutLock();
    await page.keyDown('KeyW');
    const result = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const counter = new window.BABYLON.SceneInstrumentation(game.scene);
      let most = 0;
      for (let i = 0; i < 60; i += 1) {
        game.view.look(40, 0);
        await new Promise(requestAnimationFrame);
        most = Math.max(most, counter.drawCallsCounter.current);
      }
      counter.dispose();
      return { most, size: [game.engine.getRenderWidth(), game.engine.getRenderHeight()] };
    })()`);
    await page.keyUp('KeyW');
    assert.ok(result.most > 0 && result.most <= 30, `${result.most} chamadas de desenho`);
    assert.deepEqual(result.size, [640, 360]);
    noProblems();
  });
});
