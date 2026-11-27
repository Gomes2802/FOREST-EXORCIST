/** Etapa 5 no Chrome: aparições, observação, desaparecimento e exorcismo, em tempo real. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';
import { CONFIG } from '../../src/config.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';
const settings = CONFIG.haunting;

describe('Presença sobrenatural no Chrome', { skip }, () => {
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
    const { entity } = game;
    return { mode: game.mode, state: entity.state, presence: entity.presence, progress: entity.progress,
      drawn: entity.mesh.isEnabled(), visibility: entity.mesh.visibility,
      x: entity.center.x, z: entity.center.z, mood: game.haunting.mood, timer: game.haunting.timer,
      px: game.view.camera.position.x, pz: game.view.camera.position.z, yaw: game.view.camera.rotation.y,
      aim: document.getElementById('crosshair').dataset.aim };
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
  };
  /** Olha para a entidade a partir da posição atual do jogador. */
  const lookAtEntity = async () => {
    await page.evaluate(`(() => {
      const { game } = window.forestExorcist;
      const c = game.entity.center, p = game.player.position;
      const dx = c.x - p.x, dz = c.z - p.z;
      game.view.reset(p);
      game.view.look(Math.atan2(dx, dz) / 0.0022, Math.atan2(1.7 - c.y, Math.hypot(dx, dz)) / 0.0022);
    })()`);
    await delay(300);
  };
  const press = (buttons, type) => page.send('Input.dispatchMouseEvent',
    { type, x: 640, y: 360, button: 'left', buttons, clickCount: 1 });

  test('começa sem entidade e ela aparece sozinha, gradualmente, em lugar válido', async () => {
    await play();
    let now = await state();
    assert.deepEqual([now.state, now.drawn], ['dormant', false]);
    await page.waitFor('window.forestExorcist.game.entity.state === "appearing"', (settings.first.delay + 20) * 1000);
    const first = await state();
    assert.ok(first.visibility < 0.5, `surgiu de uma vez: ${first.visibility}`);
    const distance = Math.hypot(first.x - first.px, first.z - first.pz);
    assert.ok(distance >= settings.minDistance - 0.5 && distance <= settings.maxDistance + 0.5, `${distance}`);
    await page.waitFor('window.forestExorcist.game.entity.state === "watching"', 10000);
    now = await state();
    assert.equal(now.presence, 1);
    assert.ok(now.drawn && now.visibility > 0.7);
    await lookAtEntity();
    await shot('30-aparicao');
    noProblems();
  });

  test('desaparece suavemente, e a próxima aparição é em outro lugar', async () => {
    await play();
    await page.evaluate('window.forestExorcist.game.haunting.summon(-6, 16, { mood: "still", stay: 6 })');
    const first = await state();
    await page.waitFor('window.forestExorcist.game.entity.state === "disappearing"', 15000);
    const leaving = await state();
    assert.ok(leaving.drawn && leaving.visibility > 0, 'sumiu de uma vez');
    await shot('31-desaparecendo');
    await page.waitFor('window.forestExorcist.game.entity.state === "dormant"', 8000);
    const gone = await state();
    assert.deepEqual([gone.drawn, gone.x, gone.z], [false, first.x, first.z], 'não muda de lugar ao sumir');
    assert.ok(gone.timer >= settings.interval.min - 1, 'sem intervalo');
    await page.evaluate('window.forestExorcist.game.haunting.reset(); 0');
    noProblems();
  });

  test('a cruz exorciza a entidade em tempo real, sem ela sumir durante o processo', async () => {
    await play();
    await page.evaluate('window.forestExorcist.game.haunting.summon(1.3, 11, { mood: "shy", stay: 3 })');
    await page.evaluate('window.forestExorcist.game.player.teleport(0.5, 4)');
    await lookAtEntity();
    await press(1, 'mousePressed');
    await page.waitFor('window.forestExorcist.game.entity.state === "exorcizing"', 5000);
    const start = await state();
    await delay(1500);
    const middle = await state();
    assert.deepEqual([middle.state, middle.x, middle.z], ['exorcizing', start.x, start.z]);
    assert.equal(middle.aim, 'exorcising');
    await shot('32-exorcizando');
    await page.waitFor('window.forestExorcist.game.entity.state === "exorcised"', 10000);
    await press(0, 'mouseReleased');
    await page.waitFor('!window.forestExorcist.game.entity.mesh.isEnabled()', 6000);
    await delay(1500);
    assert.equal((await state()).state, 'exorcised');
    noProblems();
  });

  test('pausa congela a presença; menu a apaga', async () => {
    await play();
    await page.evaluate('window.forestExorcist.game.haunting.summon(1.3, 14, { mood: "still", stay: 60 })');
    await delay(300);
    await page.click('[data-action="pause"]');
    const paused = await state();
    await delay(1200);
    assert.deepEqual(await state(), paused);
    await page.click('[data-screen="pause"] [data-action="back"]');
    const menu = await state();
    assert.deepEqual([menu.mode, menu.state, menu.drawn], ['menu', 'dormant', false]);
    await delay(1200);
    assert.equal((await state()).state, 'dormant');
    noProblems();
  });

  test('a primeira aparição e a primeira cruz não compilam shaders (sem engasgo)', async () => {
    await play();
    await delay(1000);
    const count = () => page.evaluate('Object.keys(window.forestExorcist.game.engine._compiledEffects).length');
    const before = await count();
    // Caminho real: surge sozinha, observa, com a cruz erguida, e desaparece.
    await page.waitFor('window.forestExorcist.game.entity.state === "watching"', 40000);
    await page.evaluate('window.forestExorcist.game.input.isPrimaryHeld = true');
    await delay(1000);
    await page.evaluate('window.forestExorcist.game.haunting.summon(0, 14, { mood: "still", stay: 3 })');
    await page.waitFor('window.forestExorcist.game.entity.state === "dormant"', 15000);
    assert.equal(await count(), before, 'um shader novo foi compilado durante o jogo');
    noProblems();
  });

  test('várias aparições seguidas sem erros, recursos estáveis e desempenho aceitável', async () => {
    await play();
    const result = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const count = () => [game.scene.meshes.length, game.scene.materials.length, game.scene.textures.length];
      const before = count();
      const counter = new window.BABYLON.SceneInstrumentation(game.scene);
      let draws = 0, frames = 0, appearances = 0, last = game.entity.state;
      const start = performance.now();
      while (performance.now() - start < 12000) {
        // Acelera a espera: chama o próximo aparecimento assim que dormir.
        if (game.entity.state === 'dormant') {
          const a = Math.random() * 6.28;
          game.haunting.summon(Math.sin(a) * 16, Math.cos(a) * 16, { mood: 'still', stay: 6 });
          game.entity.vanish(0.4);
          appearances += 1;
        }
        game.view.look(8, 0);
        await new Promise(requestAnimationFrame);
        frames += 1;
        draws = Math.max(draws, counter.drawCallsCounter.current);
      }
      counter.dispose();
      return { before, after: count(), fps: frames / 12, draws, appearances,
        lights: game.scene.lights.length, glError: game.engine._gl.getError() };
    })()`);
    assert.deepEqual(result.after, result.before, 'recursos criados a cada aparição');
    assert.ok(result.appearances >= 5, `${result.appearances}`);
    assert.ok(result.draws <= 42, `${result.draws} chamadas de desenho`);
    assert.equal(result.lights, 4); // três externas e a lamparina da cabana
    assert.equal(result.glError, 0);
    assert.ok(result.fps > 10, `${result.fps} FPS`);
    noProblems();
  });
});
