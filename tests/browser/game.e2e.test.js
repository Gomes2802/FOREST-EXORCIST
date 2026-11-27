/**
 * Testes de ponta a ponta no Google Chrome (sem janela, sem internet).
 * FE_SCREENSHOTS=pasta salva capturas de tela.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { findChrome, launchChrome, startServer } from '../helpers/chrome.js';
import { projectPath } from '../helpers/fakes.js';
import { encodePng } from '../../tools/png.mjs';

const READY = 'window.forestExorcist?.status === "ready"';
const skip = findChrome() ? false : 'Google Chrome/Chromium não encontrado (defina CHROME_PATH)';

describe('Forest Exorcist no Chrome', { skip }, () => {
  let page;
  let server;
  let sandbox;

  before(async () => {
    // Cópia descartável: os testes alteram sprites sem tocar no projeto.
    sandbox = mkdtempSync(join(tmpdir(), 'fe-game-'));
    for (const entry of ['index.html', 'style.css', 'serve.py', 'src', 'lib', 'assets']) {
      cpSync(projectPath(entry), join(sandbox, entry), { recursive: true });
    }
    server = await startServer(sandbox);
    page = await launchChrome();
  });

  after(async () => {
    await page?.close();
    await server?.close();
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  const load = async () => {
    await page.open(server.url);
    await page.waitFor(READY);
    // Os shaders compilam em segundo plano: só então os pixels são confiáveis.
    await page.evaluate('window.forestExorcist.game.scene.whenReadyAsync().then(() => true)');
  };

  const visible = () => page.evaluate(
    '[...document.querySelectorAll("[data-screen]")].filter(e => e.tagName === "SECTION" && !e.hidden).map(e => e.dataset.screen)',
  );

  const shot = async (name) => {
    if (!process.env.FE_SCREENSHOTS) return;
    mkdirSync(process.env.FE_SCREENSHOTS, { recursive: true });
    writeFileSync(join(process.env.FE_SCREENSHOTS, `${name}.png`), await page.screenshot());
  };

  /** Renderiza um quadro e lê os pixels do canvas WebGL na mesma tarefa. */
  const sampleScene = () => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    game.scene.render();
    const gl = game.engine._gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const colors = new Set();
    let red = null, green = null, magenta = 0;
    const add = (acc, x) => ({ n: (acc?.n ?? 0) + 1, x: (acc?.x ?? 0) + x });
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const x = (i / 4) % w;
      colors.add((r << 16) | (g << 8) | b);
      if (r > 150 && g < 60 && b < 60) red = add(red, x);
      if (g > 150 && r < 60 && b < 60) green = add(green, x);
      if (r > 150 && b > 150 && g < 60) magenta += 1;
    }
    return { width: w, height: h, colors: colors.size, magenta, glError: gl.getError(),
      red: red && red.x / red.n, green: green && green.x / green.n };
  })()`);

  test('abre sem internet, sem erros nem avisos no console', async () => {
    await load();
    await delay(1500);
    await shot('01-menu');
    assert.deepEqual(page.log.errors, []);
    // Avisos do driver de captura (ReadPixels) não pertencem ao jogo.
    assert.deepEqual(page.log.warnings.filter((w) => !/GL Driver Message/.test(w)), []);
    const external = page.log.requests.filter((url) => !url.startsWith(server.url) && !/^(data|blob):/.test(url));
    assert.deepEqual(external, []);
    assert.equal(await page.evaluate('window.forestExorcist.spriteManager.getProblems().length'), 0);
  });

  test('renderiza a cena 3D em resolução reduzida e pixelada', async () => {
    await load();
    const info = await page.evaluate(`(() => {
      const canvas = document.getElementById('game-canvas');
      const { game } = window.forestExorcist;
      return { rendering: getComputedStyle(canvas).imageRendering, state: game.state,
        client: [canvas.clientWidth, canvas.clientHeight], webgl: game.engine.webGLVersion };
    })()`);
    assert.equal(info.state, 'running');
    assert.equal(info.rendering, 'pixelated');
    assert.deepEqual(info.client, [1280, 720]);
    const frame = await sampleScene();
    assert.deepEqual([frame.width, frame.height], [853, 480]);
    assert.equal(frame.glError, 0);
    assert.ok(frame.colors > 100, `cena quase vazia: ${frame.colors} cores`);
    assert.equal(frame.magenta, 0);
  });

  /** Renderiza a câmera parada e devolve a cor RGB de pontos do canvas (0..1, origem no topo). */
  const colorsAt = (setup, points) => page.evaluate(`(() => {
    const { game } = window.forestExorcist;
    const { scene, engine } = game;
    game.stop();
    game.resetPlayer();
    ${setup}
    scene.render();
    const gl = engine._gl;
    return ${JSON.stringify(points)}.map(([x, y]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(x * gl.drawingBufferWidth),
        Math.floor((1 - y) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel.slice(0, 3)];
    });
  })()`);

  /** Projeta um ponto do mundo para coordenadas 0..1 do canvas. */
  const project = (x, y, z) => page.evaluate(`(() => {
    const { scene } = window.forestExorcist.game;
    const B = window.BABYLON;
    window.forestExorcist.game.resetPlayer();
    scene.render();
    const p = B.Vector3.Project(new B.Vector3(${x}, ${y}, ${z}), B.Matrix.Identity(),
      scene.getTransformMatrix(), new B.Viewport(0, 0, 1, 1));
    return [p.x, p.y];
  })()`);

  test('o chão mostra a textura e não encobre os objetos', async () => {
    await load();
    const row = Array.from({ length: 60 }, (_, i) => [0.3 + i * 0.006, 0.93]);
    const ground = await colorsAt('scene.fogDensity = 0;', row);
    assert.ok(new Set(ground.map(String)).size >= 4, 'chão sem textura');

    // Braço da cruz (posição fixa em CONFIG), bem abaixo da linha do horizonte.
    const arm = await project(-1.82, 1.03, 5);
    const [color] = await colorsAt('scene.fogDensity = 0;', [arm]);
    assert.ok(color[0] > 120 && color[1] > 80 && color[2] < 140, `cruz encoberta: ${color}`);
  });

  test('as áreas transparentes dos sprites não são desenhadas', async () => {
    await load();
    // Canto superior da cruz: transparente, deve mostrar o mesmo que sem a cruz.
    const corner = await project(-1.95, 1.4, 5);
    const [withSprite] = await colorsAt('', [corner]);
    const [without] = await colorsAt(
      'game.forest.billboards.filter(b => b.sprites.some(s => s.sprite === "cross")).forEach(b => b.mesh.setEnabled(false));',
      [corner],
    );
    assert.deepEqual(withSprite, without);
  });

  test('as texturas dos sprites chegam à GPU com filtro nearest', async () => {
    await load();
    const textures = await page.evaluate(`(() => {
      const { game } = window.forestExorcist;
      // Todos os sprites da floresta passam pelos atlas (um por material).
      return game.forest.atlases.map((atlas) => {
        const texture = atlas.material.diffuseTexture;
        const rects = Object.fromEntries([...atlas.rects].map(([id, r]) => [id, [r.width, r.height]]));
        return { id: atlas.key, ready: texture.isReady(), sampling: texture.samplingMode,
          size: [texture.getSize().width, texture.getSize().height], rects };
      });
    })()`);
    const sprites = textures.flatMap((t) => Object.keys(t.rects));
    assert.equal(sprites.length, 14, sprites.join());
    for (const texture of textures) {
      assert.equal(texture.ready, true, texture.id);
      assert.equal(texture.sampling, 1, texture.id);
    }
    // Cada sprite mantém a resolução definida pelo pixelRenderer.
    const scenery = textures.find((t) => t.rects.tree_01);
    assert.deepEqual(scenery.rects.tree_01, [48, 88]);
    assert.ok(scenery.size[0] >= 48 && scenery.size[1] >= 88);
  });

  test('o canvas do navegador reduz imagens sem misturar cores e preserva a transparência', async () => {
    await load();
    const colors = await page.evaluate(`(() => {
      const source = document.createElement('canvas');
      source.width = source.height = 64;
      const context = source.getContext('2d');
      for (let x = 0; x < 64; x += 2) { context.fillStyle = '#ff0000'; context.fillRect(x, 0, 1, 32);
        context.fillStyle = '#0000ff'; context.fillRect(x + 1, 0, 1, 32); }
      const small = window.forestExorcist.pixelRenderer.pixelate(source, { pixelHeight: 16 });
      const data = small.getContext('2d').getImageData(0, 0, 16, 16).data;
      const found = new Set();
      for (let i = 0; i < data.length; i += 4) found.add(data.slice(i, i + 4).join(','));
      return [...found];
    })()`);
    assert.ok(colors.every((c) => ['255,0,0,255', '0,0,255,255', '0,0,0,0'].includes(c)), colors.join(' | '));
    assert.ok(colors.includes('0,0,0,0'));
  });

  test('o título da interface é pixelado', async () => {
    await load();
    const title = await page.evaluate(`(() => {
      const img = document.querySelector('.title-image');
      return { src: img.src.slice(0, 22), source: img.dataset.source,
        size: [img.naturalWidth, img.naturalHeight], rendering: getComputedStyle(img).imageRendering };
    })()`);
    assert.equal(title.src, 'data:image/png;base64,');
    assert.equal(title.source, 'assets/textures/ui/title.png');
    assert.deepEqual(title.size, [51, 22]);
    assert.equal(title.rendering, 'pixelated');
  });

  test('menu: configurações e sair', async () => {
    await load();
    assert.deepEqual(await visible(), ['main']);

    await page.click('[data-screen="main"] [data-action="settings"]');
    assert.deepEqual(await visible(), ['settings']);
    await shot('03-configuracoes');
    const change = (name, value) => page.evaluate(`(() => {
      const select = document.querySelector('[data-setting="${name}"]');
      select.value = '${value}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await change('renderScale', 4);
    await change('fogDensity', 0.085);
    await change('resolutionScale', 0.5);
    await page.waitFor('window.forestExorcist.game.forest.atlases.find((a) => a.ids.has("tree_01")).rects.get("tree_01").height === 44');
    assert.equal((await sampleScene()).width, 320);
    assert.equal(await page.evaluate('window.forestExorcist.game.scene.fogDensity'), 0.085);
    await page.key('Escape', 27);
    assert.deepEqual(await visible(), ['main']);

    await page.click('[data-action="quit"]');
    assert.deepEqual(await visible(), ['quit']);
    await shot('04-sair');
    await page.click('[data-screen="quit"] [data-action="back"]');
    assert.deepEqual(await visible(), ['main']);
    assert.deepEqual(page.log.errors, []);
  });

  test('qualidade gráfica: pelo menu e pelo endereço, com a resolução em 16:9', async () => {
    await load();
    const read = () => page.evaluate(`(() => {
      const { game } = window.forestExorcist;
      return { quality: game.quality, level: game.level, size: [game.engine.getRenderWidth(), game.engine.getRenderHeight()],
        menuQuality: document.querySelector('[data-setting="quality"]').value,
        menuScale: document.querySelector('[data-setting="renderScale"]').value,
        sprites: game.forest.billboards.reduce((n, b) => n + b.visibleCount, 0) };
    })()`);
    const initial = await read();
    assert.deepEqual([initial.quality, initial.level, initial.size, initial.menuQuality], ['auto', 'medio', [853, 480], 'auto']);
    await page.click('[data-screen="main"] [data-action="settings"]');
    const change = (name, value) => page.evaluate(`(() => {
      const select = document.querySelector('[data-setting="${name}"]');
      select.value = '${value}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    for (const [quality, size, scale] of [['muito-baixo', [426, 240], '3'], ['baixo', [512, 288], '2.5'], ['alto', [853, 480], '1.5']]) {
      await change('quality', quality);
      const now = await read();
      assert.deepEqual([now.level, now.size, now.menuScale], [quality, size, scale]);
      assert.equal((await sampleScene()).magenta, 0);
    }
    await change('renderScale', 3);
    assert.deepEqual((await read()).size, [426, 240], 'a resolução pode ser trocada à parte');
    await page.key('Escape', 27);

    await page.open(`${server.url}?qualidade=muito-baixo`);
    await page.waitFor(READY);
    const shortcut = await read();
    assert.deepEqual([shortcut.quality, shortcut.size, shortcut.menuQuality], ['muito-baixo', [426, 240], 'muito-baixo']);
    assert.ok(shortcut.sprites < initial.sprites, 'menos sprites desenhados');
    assert.deepEqual(page.log.errors, []);
  });

  test('menu cabe em uma janela menor', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false });
    try {
      await load();
      const fits = await page.evaluate(`[...document.querySelectorAll('[data-screen="main"] button')]
        .every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })`);
      assert.equal(fits, true);
    } finally {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    }
  });

  test('substituir o PNG troca o sprite ao recarregar, sem espelhar e com outra proporção', async () => {
    const file = join(sandbox, 'assets/sprites/items/cross.png');
    // 300x200: metade esquerda vermelha, metade direita verde.
    const rgba = Buffer.alloc(300 * 200 * 4);
    for (let i = 0; i < 300 * 200; i += 1) rgba.set(i % 300 < 150 ? [255, 0, 0, 255] : [0, 255, 0, 255], i * 4);
    writeFileSync(file, encodePng(300, 200, rgba));
    await load();
    const record = await page.evaluate(`(() => {
      const r = window.forestExorcist.spriteManager.get('cross');
      return { status: r.status, texture: [r.textureWidth, r.textureHeight], world: [r.worldWidth, r.worldHeight] };
    })()`);
    assert.deepEqual(record, { status: 'loaded', texture: [36, 24], world: [2.25, 1.5] });
    const frame = await sampleScene();
    assert.ok(frame.red !== null && frame.green !== null, 'novo sprite não apareceu na cena');
    assert.ok(frame.red < frame.green, 'sprite espelhado');
    await shot('05-sprite-substituido');
    cpSync(projectPath('assets/sprites/items/cross.png'), file);
  });

  test('sprite ausente ou corrompido vira alternativa visual e o jogo continua', async () => {
    const missing = join(sandbox, 'assets/sprites/entities/ghost_01.png');
    const corrupt = join(sandbox, 'assets/sprites/items/cross.png');
    unlinkSync(missing);
    writeFileSync(corrupt, 'isto não é um png');
    await load();
    const problems = await page.evaluate('window.forestExorcist.spriteManager.getProblems().map(p => p.id).sort()');
    assert.deepEqual(problems, ['cross', 'ghost_01']);
    assert.ok((await sampleScene()).magenta > 0);
    assert.equal(await page.evaluate('document.getElementById("menu-status").dataset.level'), 'warning');
    // Erros esperados: só o do arquivo que não existe (404).
    assert.deepEqual(page.log.errors.filter((e) => !/404.*ghost_01\.png/.test(e)), []);
    await shot('06-sprite-ausente');
    for (const path of ['entities/ghost_01.png', 'items/cross.png']) {
      cpSync(projectPath(`assets/sprites/${path}`), join(sandbox, 'assets/sprites', path));
    }
  });

  test('em file:// mostra a instrução para usar o servidor local', async () => {
    await page.open(pathToFileURL(join(sandbox, 'index.html')).href);
    await page.waitFor('document.readyState === "complete"');
    await delay(800);
    const state = await page.evaluate(`({
      warning: !document.getElementById('file-warning').hidden,
      menu: !document.getElementById('menu').hidden,
      status: window.forestExorcist?.status ?? null,
    })`);
    await shot('07-file');
    assert.deepEqual(state, { warning: true, menu: false, status: null });
  });
});
