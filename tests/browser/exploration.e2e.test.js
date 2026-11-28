/** Etapas 6 e 9 no Chrome: cabana, tecla E, entidades novas, exorcismo e desempenho. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';
import { CONFIG } from '../../src/config.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';
const doorZ = CONFIG.buildings[0].center[1];
const eastWall = CONFIG.buildings[0].center[0] + CONFIG.buildings[0].size[0] / 2;

describe('Cabana e entidades no Chrome', { skip }, () => {
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
    const cabin = game.buildings.buildings[0];
    const text = (id) => { const el = document.getElementById(id); return el.hidden || el.closest('[data-screen]').hidden ? null : el.textContent.trim(); };
    return { mode: game.mode, x: game.player.position.x, z: game.player.position.z, door: cabin.doorAmount,
      prompt: text('interact-prompt'), note: text('interact-message'),
      entities: game.entities.members.map((m) => [m.id, m.entity.state]), message: text('hud-message') };
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
    await delay(400);
  };
  /** Posiciona o jogador olhando para um ponto. */
  const look = async (x, z, tx, tz, ty = 1.4) => {
    await page.evaluate(`(() => { const { game } = window.forestExorcist;
      game.player.teleport(${x}, ${z}); game.view.reset(game.player.position);
      game.view.look(Math.atan2(${tx - x}, ${tz - z}) / 0.0022, Math.atan2(${1.7 - ty}, ${Math.hypot(tx - x, tz - z)}) / 0.0022); })()`);
    await delay(400);
  };
  const pressE = async () => {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
    await delay(150);
  };
  const walk = async (milliseconds) => {
    await page.keyDown('KeyW');
    await delay(milliseconds);
    await page.keyUp('KeyW');
    await delay(300);
  };

  test('abrir a porta com E, entrar, examinar e sair', async () => {
    await play();
    await look(eastWall + 1.5, doorZ, eastWall - 3, doorZ);
    assert.match((await state()).prompt ?? '', /Abrir a porta/);
    await shot('40-porta');
    await walk(900);
    assert.ok((await state()).x > eastWall + 0.3, 'entrou com a porta fechada');
    await look(eastWall + 1.5, doorZ, eastWall - 3, doorZ);
    await pressE();
    await page.waitFor('window.forestExorcist.game.buildings.buildings[0].doorAmount === 1', 5000);
    await walk(1100);
    const inside = await state();
    assert.ok(inside.x < eastWall - 0.8, `não entrou: ${inside.x}`);
    await shot('41-dentro');
    await look(-17.6, -11.5, -18.55, -10.45, 0.9);
    assert.match((await state()).prompt ?? '', /Examinar os papéis/);
    await pressE();
    const note = await state();
    assert.ok(note.note?.includes('cruz'), String(note.note));
    await shot('42-exame');
    await look(eastWall - 1.8, doorZ, eastWall + 3, doorZ);
    await walk(1300);
    assert.ok((await state()).x > eastWall + 0.5, 'não saiu');
    noProblems();
  });

  test('pausa e menu: a porta congela, E é ignorado e o menu a fecha', async () => {
    await play();
    await look(eastWall + 1.5, doorZ, eastWall - 3, doorZ);
    await pressE();
    await page.click('[data-action="pause"]');
    const paused = await state();
    await pressE();
    await delay(700);
    assert.deepEqual(await state(), paused);
    assert.equal(paused.prompt, null, 'a ação aparece na pausa');
    await page.click('[data-screen="pause"] [data-action="back"]');
    assert.equal((await state()).door, 0);
    noProblems();
  });

  test('as três entidades são exorcizadas com o botão esquerdo', async () => {
    await play();
    for (const { id, exorcism } of CONFIG.entityTypes) {
      await page.evaluate(`(() => { const { game } = window.forestExorcist; game.entities.reset();
        game.entities.get('${id}').haunting.summon(1.3, 11, { pinned: true }); })()`);
      await look(0.5, 5, 1.3, 11, 1.6);
      assert.equal(await page.evaluate('document.getElementById("crosshair").dataset.aim'), 'target', id);
      await shot(`43-${id}`);
      await page.evaluate('(() => { const { game } = window.forestExorcist; if (!game.inventory.selected) game.selectSlot(1); })()');
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', buttons: 1, clickCount: 1 });
      await page.waitFor(`window.forestExorcist.game.entities.get('${id}').entity.state === "exorcised"`, 15000);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', buttons: 0, clickCount: 1 });
      await delay(200);
      assert.equal((await state()).message, exorcism?.message ?? CONFIG.exorcism.message);
    }
    noProblems();
  });

  test('olhar a cabana e fazer as entidades surgirem não compila shaders durante o jogo', async () => {
    await play();
    await delay(1000);
    const count = () => page.evaluate('Object.keys(window.forestExorcist.game.engine._compiledEffects).length');
    const before = await count();
    for (const [x, z, tx, tz] of [[-8, -11, -17, -12], [-17, -11.6, -19, -10]]) await look(x, z, tx, tz);
    for (const [id, x] of [['ghost', -3], ['watcher', 3], ['unstable', 0]]) {
      await page.evaluate(`(() => { const { game } = window.forestExorcist; game.entities.reset();
        game.entities.get('${id}').haunting.summon(${x}, 13, { stay: 3 }); })()`);
      await look(0, 3, x, 13, 1.6);
      await delay(600);
    }
    assert.equal(await count(), before, 'um shader novo foi compilado durante o jogo');
    noProblems();
  });

  test('aparições livres com todos os tipos: limite respeitado, recursos estáveis e sem erros', async () => {
    await play();
    const result = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length, game.scene.lights.length];
      const before = count();
      // Acelera as esperas: avança o comportamento sem desenhar, mantendo o jogo rodando.
      let most = 0, appeared = new Set(), draws = 0, frames = 0;
      const counter = new window.BABYLON.SceneInstrumentation(game.scene);
      const start = performance.now();
      while (performance.now() - start < 14000) {
        const camera = game.view.camera;
        const viewer = { x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y, eyeHeight: 1.7 };
        for (let i = 0; i < 12; i++) { game.entities.update(0.1, viewer); }
        game.view.look(12, 0);
        await new Promise(requestAnimationFrame);
        frames += 1;
        most = Math.max(most, game.entities.activeCount);
        for (const m of game.entities.members) if (m.entity.state !== 'dormant') appeared.add(m.id);
        draws = Math.max(draws, counter.drawCallsCounter.current);
      }
      counter.dispose();
      return { before, after: count(), most, appeared: [...appeared].sort(), draws, fps: frames / 14, glError: game.engine._gl.getError() };
    })()`);
    assert.deepEqual(result.after, result.before);
    assert.ok(result.most <= CONFIG.encounters.maxActive, `${result.most} ao mesmo tempo`);
    assert.deepEqual(result.appeared, ['ghost', 'unstable', 'watcher']);
    assert.ok(result.draws <= 50, `${result.draws} chamadas de desenho`);
    assert.equal(result.glError, 0);
    assert.ok(result.fps > 10, `${result.fps} FPS`);
    noProblems();
  });
});
