/** Passos no Chrome real: arquivo carregado, passos ao andar, mais rápidos ao correr, silêncio na pausa. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';

describe('Passos no Chrome', { skip }, () => {
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

  const footsteps = () => page.evaluate(`(() => {
    const f = window.forestExorcist.game.footsteps;
    return { loaded: f.loaded, active: f.active, played: f.played, rate: f.lastRate,
      state: f.active ? 'on' : 'off', mode: window.forestExorcist.game.mode };
  })()`);
  const noProblems = () => {
    assert.deepEqual(page.log.errors.filter((e) => !/pointer ?lock/i.test(e)), []);
    assert.deepEqual(page.log.warnings.filter((w) => !/GL Driver Message|pointer ?lock/i.test(w)), []);
  };

  /** Entra no jogo sem captura do mouse (como nos outros testes de navegador). */
  const play = async () => {
    await page.open(server.url);
    await page.waitFor('window.forestExorcist?.status === "ready"');
    await page.evaluate('window.forestExorcist.game.scene.whenReadyAsync().then(() => true)');
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await page.click('[data-action="resume-nolock"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    await delay(300);
  };
  const hold = async (codes, milliseconds) => {
    for (const code of codes) await page.keyDown(code);
    await delay(milliseconds);
    for (const code of [...codes].reverse()) await page.keyUp(code);
    await delay(200);
  };

  test('o arquivo de passos é carregado e o áudio liga ao jogar', async () => {
    await play();
    const now = await footsteps();
    assert.equal(now.loaded, true, 'arquivo de passos não carregou');
    assert.equal(now.active, true);
    assert.equal(await page.evaluate('window.forestExorcist.game.footsteps.played'), 0);
    noProblems();
  });

  test('andando, toca passos; parado, fica em silêncio', async () => {
    await play();
    const before = (await footsteps()).played;
    await hold(['KeyW'], 1500);
    const walking = (await footsteps()).played - before;
    assert.ok(walking >= 2, `${walking} passos andando`);
    const rate = (await footsteps()).rate;
    assert.ok(Math.abs(rate - 1) < 0.1, `velocidade ao andar: ${rate}`);

    const idle = (await footsteps()).played;
    await delay(1200);
    assert.equal((await footsteps()).played, idle, 'passos parado');
    noProblems();
  });

  test('correndo, os passos são mais frequentes e mais rápidos', async () => {
    await play();
    const start = (await footsteps()).played;
    await hold(['KeyW'], 1500);
    const walk = (await footsteps()).played - start;

    const runStart = (await footsteps()).played;
    // Registra a velocidade de cada passo enquanto a corrida dura (o último passo
    // pode ser da desaceleração, já no ritmo de caminhada).
    await page.evaluate(`(() => {
      const f = window.forestExorcist.game.footsteps;
      window.__rates = [];
      window.__sampler = setInterval(() => {
        if (f.played > 0) window.__rates.push(f.lastRate);
      }, 20);
    })()`);
    await hold(['ShiftLeft', 'KeyW'], 1500);
    const rates = await page.evaluate('(clearInterval(window.__sampler), window.__rates)');
    const running = (await footsteps()).played - runStart;
    assert.ok(running > walk, `${running} passos correndo x ${walk} andando`);
    const fastest = Math.max(...rates);
    assert.ok(fastest > 1.25, `velocidade máxima na corrida: ${fastest}`);
    noProblems();
  });

  test('pausa silencia, e a distância da pausa não gera passos ao voltar', async () => {
    await play();
    await page.keyDown('KeyW');
    await delay(600);
    await page.keyUp('KeyW');
    await page.click('[data-action="pause"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    const paused = await footsteps();
    assert.equal(paused.active, false, 'o áudio ainda estava ligado na pausa');
    await delay(800);
    assert.equal((await footsteps()).played, paused.played, 'passos na pausa');

    await page.click('[data-action="resume"]');
    await delay(300);
    await page.click('[data-action="resume-nolock"]');
    await page.waitFor('window.forestExorcist.game.mode === "playing"');
    assert.equal((await footsteps()).active, true, 'o áudio não voltou');
    noProblems();
  });

  test('voltar ao menu silencia o áudio', async () => {
    await play();
    await page.click('[data-action="pause"]');
    await page.click('[data-screen="pause"] [data-action="back"]');
    assert.equal((await footsteps()).active, false);
    noProblems();
  });
});
