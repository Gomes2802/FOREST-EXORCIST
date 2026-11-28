/** Seleção, equipamento e animação da cruz no Google Chrome, com teclado e mouse reais. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';

describe('Equipamento da cruz no Chrome', { skip }, () => {
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
    const slot = document.querySelector('#item-bar [data-item="cross"]');
    return {
      mode: game.mode, cross: game.cross.state, frame: game.cross.frame,
      slots: document.querySelectorAll('#item-bar li').length,
      selected: slot.dataset.selected, label: slot.textContent.replace(/\\s+/g, ' ').trim(),
      progress: game.entity.progress,
    };
  })()`);
  const noProblems = () => {
    assert.deepEqual(page.log.errors.filter((e) => !/pointer ?lock/i.test(e)), []);
    assert.deepEqual(page.log.warnings.filter((w) => !/GL Driver Message|pointer ?lock/i.test(w)), []);
    const external = page.log.requests.filter((url) => !url.startsWith(server.url) && !/^(data|blob):/.test(url));
    assert.deepEqual(external, []);
  };
  const play = async () => {
    await page.open(server.url);
    await page.waitFor('window.forestExorcist?.status === "ready"');
    await page.evaluate('window.forestExorcist.game.scene.whenReadyAsync().then(() => true)');
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await page.click('[data-action="resume-nolock"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    // De costas para tudo o que brilha, com a lanterna apagada: só a mão muda a imagem.
    await page.evaluate(`(() => { const { game } = window.forestExorcist;
      game.haunting.summon(1.3, 11, { pinned: true });
      game.lights.flashlight.setOn(false); })()`);
    await delay(300);
  };
  const tap = async (code) => {
    await page.keyDown(code);
    await page.keyUp(code);
    await delay(500);
  };
  const button = (type, buttons) =>
    page.send('Input.dispatchMouseEvent', { type, x: 640, y: 300, button: 'left', buttons, clickCount: 1 });
  const press = () => button('mousePressed', 1);
  const release = () => button('mouseReleased', 0);

  /** Pixels desenhados pela mão (quentes) na metade direita de baixo da imagem 3D. */
  const skin = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    game.scene.render();
    const gl = game.engine._gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const width = Math.floor(w / 2), height = Math.floor(h * 0.45);
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(w - width, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 70 && data[i] > data[i + 2] * 1.25 && data[i] >= data[i + 1]) count += 1;
    }
    return count;
  })()`);

  test('1 equipa, 1 ou G guardam, e o indicador acompanha', async () => {
    await play();
    let now = await state();
    assert.deepEqual([now.cross, now.slots, now.selected, now.label], ['unequipped', 1, 'false', '1 Cruz']);
    const empty = await skin();
    await shot('30-guardada');
    await tap('Digit1');
    now = await state();
    assert.deepEqual([now.cross, now.selected], ['equipped_idle', 'true']);
    const held = await skin();
    assert.ok(held > empty + 1500, `held cross não desenhado: ${empty} -> ${held}`);
    await shot('31-equipada');
    await tap('KeyG');
    assert.deepEqual([(await state()).cross, (await state()).selected], ['unequipped', 'false']);
    assert.ok((await skin()) <= empty + 50);
    await tap('Digit1');
    await tap('Digit1');
    assert.equal((await state()).cross, 'unequipped');
    noProblems();
  });

  test('o botão esquerdo toca os cinco quadros e soltar volta ao repouso', async () => {
    await play();
    await press();
    await delay(300);
    assert.equal((await state()).cross, 'unequipped', 'guardada: o botão não faz nada');
    await release();
    await tap('Digit1');
    const shaders = () => page.evaluate('Object.keys(window.forestExorcist.game.engine._compiledEffects).sort()');
    const compiled = await shaders();
    for (let n = 0; n < 3; n += 1) {
      await page.evaluate(`(() => { const { game } = window.forestExorcist; window.__frames = [];
        window.__watch = game.scene.onBeforeRenderObservable.add(() => window.__frames.push(game.cross.frame)); })()`);
      await press();
      await page.waitFor('window.forestExorcist.game.cross.frame === 4');
      await delay(200);
      const frames = await page.evaluate('window.__frames.filter((f) => f !== null)');
      assert.deepEqual([...new Set(frames)], [0, 1, 2, 3, 4], `repetição ${n}`);
      assert.ok((await skin()) > 1500);
      await shot('32-em-uso');
      await release();
      await delay(200);
      assert.deepEqual([(await state()).cross, (await state()).frame], ['equipped_idle', null]);
      await page.evaluate('window.forestExorcist.game.scene.onBeforeRenderObservable.remove(window.__watch)');
    }
    assert.deepEqual(await shaders(), compiled, 'usar a cruz não troca nem recompila shaders');
    noProblems();
  });

  test('cada quadro da folha aparece inteiro, sem vizinhos', async () => {
    await play();
    await tap('Digit1');
    for (let frame = 0; frame < 5; frame += 1) {
      await page.evaluate(`(() => { const { game } = window.forestExorcist;
        game.mode = 'menu-test';
        game.cross.reset(); game.cross.equip(true);
        for (let i = 0; i < 90; i += 1) game.cross.update(1 / 60, false);
        for (let i = 0; i <= ${frame}; i += 1) game.cross.update(i ? 1 / 12 : 0.001, true);
        game.scene.render(); })()`);
      assert.equal(await page.evaluate('window.forestExorcist.game.cross.frame'), frame);
      await delay(100);
      await shot(`33-quadro-${frame}`);
    }
    noProblems();
  });

  test('pausa e caderno interrompem o uso e a cruz continua equipada', async () => {
    await play();
    await tap('Digit1');
    await press();
    await page.waitFor('window.forestExorcist.game.cross.frame !== null');
    await page.key('Escape', 27);
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await release();
    assert.deepEqual([(await state()).cross, (await state()).frame], ['equipped_idle', null]);
    await shot('34-pausa');
    await page.click('[data-action="resume"]');
    await page.waitFor('!document.querySelector(\'[data-action="resume-nolock"]\').hidden');
    await page.click('[data-action="resume-nolock"]');
    await delay(500);
    assert.equal((await state()).cross, 'equipped_idle');
    await press();
    await page.waitFor('window.forestExorcist.game.cross.frame !== null');
    await page.evaluate('window.forestExorcist.game.openJournal()');
    await release();
    assert.deepEqual([(await state()).mode, (await state()).cross], ['journal', 'equipped_idle']);
    await page.click('[data-action="close-notebook"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    await delay(300);
    assert.equal((await state()).cross, 'equipped_idle');
    await press();
    await page.waitFor('window.forestExorcist.game.cross.frame === 4');
    await release();
    noProblems();
  });
});
