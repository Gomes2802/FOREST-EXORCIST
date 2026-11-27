/**
 * Medição de desempenho reproduzível no Google Chrome.
 *
 *   node tools/benchmark.mjs [--seconds 8] [--quality medio] [--scenarios vazia,floresta,exorcismo]
 *
 * Modo gráfico (variáveis de ambiente, as mesmas dos testes de navegador):
 *   (padrão)               Chrome sem janela, WebGL por software (SwiftShader)
 *   FE_VISIBLE=1           janela visível, WebGL por software
 *   FE_VISIBLE=1 FE_GPU=1  janela visível, placa de vídeo
 *
 * Cenários (todos em 1280x720, com a câmera girando 360° em velocidade constante):
 *   vazia      só o céu: todas as malhas desligadas (custo fixo do navegador e do motor)
 *   floresta   jogando, no ponto inicial
 *   exorcismo  diante da entidade, com a cruz erguida e o exorcismo em andamento
 *   cabana     dentro da cabana, com a porta aberta, olhando em volta
 *   entidades  as entidades presentes ao mesmo tempo, com a cruz erguida
 *   vegetacao  parado, olhando para o trecho com mais sprites à vista
 *   exterior   parado, do lado de fora, olhando para a cabana
 *   exploracao andando para o norte pela trilha, passando por pistas
 *   pausa      jogo pausado
 *   leitura    um documento aberto (versão 0.7.0 em diante)
 *   caderno    o caderno aberto com todos os documentos (0.7.0 em diante)
 *
 * A coluna "3D/s" conta as imagens 3D desenhadas por segundo. Nas telas paradas
 * ela é zero e o FPS passa a ser o do navegador mostrando só a interface.
 *
 * --setup "<código>" executa JavaScript na página antes da medição (experimentos;
 * "game" e "f" = game.forest estão disponíveis).
 *
 * O resultado também é gravado em benchmarks/results/ (ignorado pelo Git).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { launchChrome, startServer } from '../tests/helpers/chrome.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split(/\s+/);
    return [key, value.join(' ') || true];
  }),
);
const seconds = Number(args.seconds ?? 8);
const scenarios = String(args.scenarios ?? 'vazia,floresta,exorcismo').split(',');
const quality = args.quality ?? null;
const mode = `${process.env.FE_VISIBLE ? 'janela' : 'sem janela'}, ${process.env.FE_GPU ? 'GPU' : 'software'}`;

const SETUP = {
  vazia: `game.player.teleport(0, 0);
    for (const mesh of game.scene.meshes) mesh.setEnabled(false);
    game.forest.follow = () => {};
    if (game.buildings) game.buildings.follow = () => {};`,
  floresta: 'game.player.teleport(0, 0);',
  vegetacao: 'game.player.teleport(0, 0);',
  exterior: 'game.player.teleport(-10.5, -10.5);',
  cabana: `game.buildings.buildings[0].resetDoor(true);
    game.player.teleport(-16, -12);`,
  exploracao: 'game.player.teleport(0, 0); window.__walking = true;',
  pausa: 'game.player.teleport(0, 0);',
  leitura: 'game.player.teleport(0, 0);',
  caderno: 'game.player.teleport(0, 0);',
  entidades: `game.player.teleport(0, 2);
    game.entities.reset();
    [[-3, 12], [3.5, 15], [0.3, 9]].forEach(([x, z], i) => game.entities.members[i].haunting.summon(x, z, { pinned: true }));
    window.__holding = true;
    game.input.isPrimaryHeld = true;`,
  exorcismo: `game.player.teleport(0.5, 6);
    // A entidade fica presente e parada no mesmo lugar em todas as versões.
    game.haunting?.summon(1.3, 11, { pinned: true });
    window.__holding = true;
    game.input.isPrimaryHeld = true;`,
};

const server = await startServer(root);
const page = await launchChrome();
const results = [];
try {
  for (const scenario of scenarios) {
    await page.open(server.url);
    await page.waitFor('window.forestExorcist?.status === "ready"', 120000);
    await page.send('Page.bringToFront');
    await page.evaluate(`(async () => {
      const { game, menu } = window.forestExorcist;
      ${quality ? `game.setQuality?.(${JSON.stringify(quality)});` : ''}
      await game.scene.whenReadyAsync();
      // Entra no jogo sem depender da captura do mouse.
      game.input.enable('drag');
      game.mode = 'playing';
      menu.show('hud');
      document.getElementById('drag-help').hidden = true;
      game.view.reset(game.player.position);
      ${SETUP[scenario]}
      const f = game.forest;
      ${args.setup ?? ''}
      game.view.reset(game.player.position);
      const yaw = { vegetacao: (300 * Math.PI) / 180, exterior: Math.atan2(-6.5, -1.5) }[${JSON.stringify(scenario)}];
      if (yaw !== undefined) game.view.look(yaw / 0.0022, 0);
      if (${JSON.stringify(scenario)} === 'exorcismo') {
        const c = game.entity.center;
        game.view.look(Math.atan2(c.x - 0.5, c.z - 6) / 0.0022, 0);
      }
    })()`);
    await delay(1500); // compilação de shaders e aquecimento
    const opened = await page.evaluate(`(() => {
      const { game } = window.forestExorcist;
      const scenario = ${JSON.stringify(scenario)};
      if (scenario === 'pausa') game.pause();
      if (scenario !== 'leitura' && scenario !== 'caderno') return true;
      if (!game.openDocument) return false;
      if (scenario === 'leitura') game.openDocument('cruz');
      else {
        for (const { id } of game.config.investigation.documents) game.investigation.discover(id, 1);
        game.openJournal();
      }
      return true;
    })()`);
    if (!opened) {
      console.log(`${scenario}: não existe nesta versão, pulado.`);
      continue;
    }
    await delay(500);

    const result = await page.evaluate(`(async () => {
      const { game } = window.forestExorcist;
      const B = window.BABYLON;
      const counter = new B.SceneInstrumentation(game.scene);
      counter.captureRenderTime = true;
      counter.captureActiveMeshesEvaluationTime = true;
      // Tempo de JavaScript por quadro (simulação + envio dos comandos de desenho).
      let js = 0;
      const original = game.renderFrame.bind(game);
      game.renderFrame = () => { const t = performance.now(); original(); js += performance.now() - t; };
      const still = ['exorcismo', 'entidades', 'vegetacao', 'exterior', 'exploracao', 'pausa', 'leitura', 'caderno'];
      const turn = still.includes(${JSON.stringify(scenario)}) ? 0 : (2 * Math.PI) / ${seconds};
      let renders = 0;
      const observer = game.scene.onAfterRenderObservable.add(() => { renders += 1; });
      const intervals = [];
      let draws = 0, active = 0, last = performance.now();
      const start = last;
      while (last - start < ${seconds * 1000}) {
        game.view.look((turn / 60) / 0.0022, 0);
        // Reinicia antes de concluir, para o exorcismo continuar durante a medição.
        for (const { entity, haunting } of game.entities?.members ?? [{ entity: game.entity, haunting: game.haunting }]) {
          if (entity.progress <= 0.5) continue;
          const { x, z } = entity.center;
          entity.reset();
          haunting?.summon(x, z, { pinned: true });
        }
        if (window.__holding) game.input.isPrimaryHeld = true;
        if (window.__walking) game.input.pressed.add('KeyW');
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        intervals.push(now - last);
        last = now;
        draws = Math.max(draws, counter.drawCallsCounter.current);
        active = Math.max(active, game.scene.getActiveMeshes().length);
      }
      game.renderFrame = original;
      game.scene.onAfterRenderObservable.remove(observer);
      const frames = intervals.length;
      const sorted = [...intervals].sort((a, b) => b - a);
      const worst = sorted.slice(0, Math.max(1, Math.round(frames / 100)));
      const avgWorst = worst.reduce((a, b) => a + b, 0) / worst.length;
      const out = {
        fps: frames / ((last - start) / 1000),
        low1: 1000 / avgWorst,
        min: 1000 / sorted[0],
        frameMs: (last - start) / frames,
        p95Ms: sorted[Math.floor(frames * 0.05)],
        jsMs: js / frames,
        renderMs: counter.renderTimeCounter.average,
        cullMs: counter.activeMeshesEvaluationTimeCounter.average,
        below30: intervals.filter((t) => t > 1000 / 30).length / frames,
        // Sem desenho, o contador do motor não é zerado e não vale.
        draws: renders ? draws : 0, active,
        renders: renders / ((last - start) / 1000),
        meshes: game.scene.meshes.length,
        materials: game.scene.materials.length,
        textures: game.scene.textures.length,
        lights: game.scene.lights.filter((l) => l.isEnabled()).length,
        size: game.engine.getRenderWidth() + 'x' + game.engine.getRenderHeight(),
        renderer: (() => { const gl = game.engine._gl; const i = gl.getExtension('WEBGL_debug_renderer_info');
          return i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : '?'; })(),
        cross: game.cross.amount, entity: game.entity.state,
      };
      counter.dispose();
      return out;
    })()`);
    results.push({ scenario, ...result });
  }
  const errors = page.log.errors.filter((e) => !/pointer ?lock/i.test(e));
  const external = page.log.requests.filter((url) => !url.startsWith(server.url) && !/^(data|blob):/.test(url));

  const round = (n, d = 1) => Number(n.toFixed(d));
  console.log(`\nModo: ${mode} | qualidade: ${quality ?? 'padrão'} | ${seconds} s por cenário`);
  console.log(`Renderizador: ${results[0]?.renderer}`);
  console.table(Object.fromEntries(results.map((r) => [r.scenario, {
    FPS: round(r.fps), '1% low': round(r.low1), 'mín.': round(r.min), 'ms/quadro': round(r.frameMs), '3D/s': round(r.renders),
    'p95 ms': round(r.p95Ms), 'JS ms': round(r.jsMs, 2), '<30 FPS': `${round(r.below30 * 100)}%`,
    draws: r.draws, ativas: r.active, malhas: r.meshes, materiais: r.materials, luzes: r.lights, res: r.size,
  }])));
  console.log(`Erros no console: ${errors.length} | requisições externas: ${external.length}`);

  const folder = join(root, 'benchmarks', 'results');
  mkdirSync(folder, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.env.FE_GPU ? 'gpu' : 'sw'}${process.env.FE_VISIBLE ? '-janela' : ''}-${quality ?? 'padrao'}.json`;
  writeFileSync(join(folder, name), JSON.stringify({ mode, quality, seconds, results, errors, external }, null, 2));
} finally {
  await page.close();
  await server.close();
}
