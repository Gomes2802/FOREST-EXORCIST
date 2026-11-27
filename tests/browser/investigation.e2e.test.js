/** Etapa 7 no Chrome: leitura, caderno, objetivos, congelamento e funcionamento offline. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';
import { CONFIG } from '../../src/config.js';

const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';
const { documents } = CONFIG.investigation;
const KEYS = { KeyE: 69, KeyJ: 74, KeyW: 87, Escape: 27, ArrowUp: 38, ArrowDown: 40 };

describe('Investigação no Chrome', { skip }, () => {
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
  const press = async (code, extra = {}) => {
    const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    for (const type of ['rawKeyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: KEYS[code], ...extra });
    }
    await delay(200);
  };
  /** Posiciona o jogador diante de um documento, olhando para ele. */
  const approach = async (id) => {
    const found = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const item = [...game.buildings.buildings.flatMap((b) => b.plan.interactables), ...game.buildings.props]
        .find((i) => i.documentId === ${JSON.stringify(id)});
      const solids = game.buildings.plans.flatMap((p) => p.solids);
      const touches = (x, z, b) => Math.hypot(x - Math.max(b.minX, Math.min(b.maxX, x)),
        z - Math.max(b.minZ, Math.min(b.maxZ, z))) < 0.4;
      const frame = () => new Promise(requestAnimationFrame);
      for (const distance of [1.2, 1, 1.4, 0.8]) {
        for (let turn = 0; turn < 24; turn += 1) {
          const angle = (turn / 24) * Math.PI * 2;
          const x = item.point.x + Math.sin(angle) * distance;
          const z = item.point.z + Math.cos(angle) * distance;
          if (solids.some((s) => touches(x, z, s))) continue;
          if (game.forest.occluders.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 0.4)) continue;
          game.player.teleport(x, z);
          game.view.reset(game.player.position);
          game.view.look(Math.atan2(item.point.x - x, item.point.z - z) / 0.0022,
            Math.atan2(1.7 - item.point.y, distance) / 0.0022);
          for (let i = 0; i < 20; i += 1) await frame();
          if (game.interactions.focus?.documentId === ${JSON.stringify(id)}) return true;
        }
      }
      return false;
    })()`);
    assert.ok(found, `sem foco em ${id}`);
  };
  const ui = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    const visible = [...document.querySelectorAll('section[data-screen]')].filter((e) => !e.hidden).map((e) => e.dataset.screen);
    const text = (id) => document.getElementById(id).textContent.trim();
    const list = (id) => [...document.getElementById(id).children].map((e) => e.textContent.trim());
    return { mode: game.mode, screen: visible.join(), view: document.getElementById('notebook').dataset.view,
      title: text('page-title'), body: text('page-text'), count: text('record-count'),
      records: list('record-list'), objectives: list('objective-list'), discoveries: list('discovery-list'),
      indexVisible: document.getElementById('notebook-index').offsetParent !== null,
      x: game.player.position.x, z: game.player.position.z, input: game.input.mode,
      prompt: document.getElementById('interact-text').textContent };
  })()`);

  test('ler com E, fechar com E, Esc e botão, e voltar à exploração', async () => {
    await play();
    await approach('cruz');
    await shot('50-estaca');
    assert.equal((await ui()).prompt, 'Ler a anotação na estaca');
    for (const close of [() => press('KeyE'), () => press('Escape'), () => page.click('[data-action="close-notebook"]')]) {
      await press('KeyE');
      const open = await ui();
      const doc = documents.find((d) => d.id === 'cruz');
      assert.deepEqual([open.mode, open.screen, open.view, open.title, open.indexVisible],
        ['reading', 'notebook', 'reading', doc.title, false]);
      assert.ok(open.body.includes(doc.text[0]));
      await shot('51-leitura');
      // Controles congelados.
      await page.keyDown('KeyW');
      await delay(400);
      await page.keyUp('KeyW');
      assert.deepEqual([(await ui()).x, (await ui()).z], [open.x, open.z]);
      await close();
      const back = await ui();
      assert.deepEqual([back.mode, back.screen, back.input], ['playing', 'hud', 'drag']);
    }
    // Segurar E (repetição) não fecha nem reabre.
    await press('KeyE');
    await press('KeyE', { autoRepeat: true });
    assert.equal((await ui()).mode, 'reading');
    await press('KeyE');
    assert.equal(await page.evaluate('window.forestExorcist.game.investigation.records().length'), 1);
    noProblems();
  });

  test('o caderno mostra só o encontrado, relê documentos e reaproveita a lista', async () => {
    await play();
    await press('KeyJ');
    const empty = await ui();
    assert.deepEqual([empty.mode, empty.screen, empty.view, empty.records, empty.indexVisible],
      ['journal', 'notebook', 'journal', [], true]);
    assert.equal(empty.count, `(0 de ${documents.length})`);
    for (const doc of documents) assert.ok(!(empty.title + empty.body).includes(doc.title));
    assert.ok(empty.objectives.every((o) => o.startsWith('[ ]')));
    await shot('52-caderno-vazio');
    await press('KeyJ');
    assert.equal((await ui()).mode, 'playing');

    for (const id of ['diario', 'foto']) {
      await approach(id);
      await press('KeyE');
      await shot(`53-${id}`);
      await press('KeyE');
    }
    await press('KeyJ');
    const first = await ui();
    const titles = ['diario', 'foto'].map((id) => documents.find((d) => d.id === id).title);
    assert.deepEqual(first.records, titles);
    assert.equal(first.title, titles[1]);
    assert.ok(first.objectives.includes('[x] Examinar a fotografia'), first.objectives.join('|'));
    assert.ok(first.objectives.includes('[x] Investigar a cabana abandonada'));
    assert.ok(first.discoveries.length >= 1);
    await shot('54-caderno');
    await page.click('[data-document="diario"]');
    assert.equal((await ui()).title, titles[0]);
    await press('ArrowDown');
    assert.equal((await ui()).title, titles[1]);

    // Abrir várias vezes não cria elementos novos.
    await page.evaluate('window.__nodes = [...document.querySelectorAll("#notebook *")]');
    for (let i = 0; i < 5; i += 1) {
      await press('KeyJ');
      await press('KeyJ');
    }
    assert.equal(await page.evaluate(`(() => { const now = [...document.querySelectorAll('#notebook *')];
      return now.length === window.__nodes.length && now.every((e, i) => e === window.__nodes[i]); })()`), true);
    await press('Escape');
    assert.equal((await ui()).mode, 'playing');
    noProblems();
  });

  test('aviso aparece uma vez; pausa e menu: J é ignorado e uma nova exploração começa vazia', async () => {
    await play();
    await approach('cruz');
    await press('KeyE');
    await press('KeyE');
    await page.waitFor('!document.getElementById("hud-toast").hidden', 5000);
    assert.match(await page.evaluate('document.getElementById("hud-toast").textContent'), /Novo registro/);
    await shot('55-aviso');
    await page.click('[data-action="pause"]');
    await press('KeyJ');
    assert.equal((await ui()).mode, 'paused');
    await page.click('[data-screen="pause"] [data-action="back"]');
    await press('KeyJ');
    assert.equal((await ui()).screen, 'main');
    await page.click('[data-action="play"]');
    await page.waitFor('window.forestExorcist.game.mode === "paused"');
    await page.click('[data-action="resume-nolock"]');
    await press('KeyJ');
    const fresh = await ui();
    assert.deepEqual([fresh.records, fresh.discoveries], [[], []]);
    assert.ok(fresh.objectives.every((o) => o.startsWith('[ ]')));
    noProblems();
  });

  test('com a leitura aberta a imagem permanece e o 3D não é redesenhado', async () => {
    await play();
    await approach('marco');
    await shot('56-marco');
    /** Quadros 3D desenhados em um segundo. */
    const renders = () => page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      let count = 0;
      const observer = game.scene.onAfterRenderObservable.add(() => { count += 1; });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      game.scene.onAfterRenderObservable.remove(observer);
      return count;
    })()`);
    assert.ok(await renders() > 5);
    const playing = await page.screenshot();
    await press('KeyE');
    assert.equal(await renders(), 0);
    await shot('57-marco-leitura');
    // Sem a interface, a cena congelada continua na tela (não fica preta).
    await page.evaluate('document.getElementById("menu").style.visibility = "hidden"');
    await delay(300);
    const behind = await page.screenshot();
    await shot('58-fundo');
    assert.ok(behind.length > playing.length / 3, `imagem perdida: ${behind.length} x ${playing.length}`);
    await page.evaluate('document.getElementById("menu").style.visibility = ""');
    // Redimensionar redesenha uma vez.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
    await delay(500);
    await shot('59-estreita');
    assert.equal(await renders(), 0);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await delay(300);
    await press('KeyE');
    assert.ok(await renders() > 5);
    noProblems();
  });

  test('todos os documentos podem ser lidos sem compilar shaders nem criar recursos', async () => {
    await play();
    await delay(500);
    const count = () => page.evaluate(`(() => { const { game } = window.forestExorcist;
      return [Object.keys(game.engine._compiledEffects).length, game.scene.meshes.length,
        game.scene.materials.length, game.scene.textures.length]; })()`);
    const before = await count();
    for (const doc of documents) {
      await approach(doc.id);
      await shot(`60-${doc.id}`);
      await press('KeyE');
      assert.equal((await ui()).title, doc.title);
      assert.equal(await page.evaluate('(() => { const p = document.getElementById("page"); return p.scrollWidth <= p.clientWidth; })()'), true);
      await press('KeyE');
    }
    assert.deepEqual(await count(), before);
    assert.equal(await page.evaluate('window.forestExorcist.game.investigation.objectives().find((o) => o.id === "arquivo").done'), true);
    noProblems();
  });
});
