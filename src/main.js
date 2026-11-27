/** Ponto de entrada: monta os sistemas e liga o menu ao jogo. */
import { CONFIG } from './config.js';
import { Game } from './core/game.js';
import { PixelRenderer } from './graphics/pixelRenderer.js';
import { SpriteManager } from './graphics/spriteManager.js';
import { Menu } from './ui/menu.js';
import { Hud } from './ui/hud.js';
import { Notebook } from './ui/notebook.js';

const pixelRenderer = new PixelRenderer(CONFIG.pixel);
const spriteManager = new SpriteManager({ pixelRenderer, basePath: CONFIG.assets.spriteBasePath });
let game = null;

const menu = new Menu(document, {
  onPlay: () => game.play(),
  onResume: () => game.resume(),
  onResumeWithoutLock: () => game.resumeWithoutLock(),
  onPause: () => game.pause(),
  onCloseNotebook: () => game.closeNotebook(),
  onMenu: () => game.quitToMenu(),
  onSetting: async (name, value) => {
    if (name === 'renderScale') game.setRenderScale(value);
    else if (name === 'quality') game.setQuality(value);
    else if (name === 'fogDensity') game.setFogDensity(value);
    else if (name === 'resolutionScale') {
      menu.setReady(false);
      try {
        await game.setSpriteResolution(value);
      } finally {
        menu.setReady(true);
      }
    }
  },
  closeWindow: () => window.close(),
});

/** Estado exposto para testes automatizados e depuração no console. */
const app = { status: 'loading', error: null, game: null, menu, spriteManager, pixelRenderer };
window.forestExorcist = app;

async function boot() {
  menu.setReady(false);
  menu.setStatus('Carregando a floresta...');

  const failedImages = await pixelRenderer.pixelateAll(document);
  if (failedImages > 0) {
    console.warn(`[ui] ${failedImages} imagem(ns) de interface não puderam ser pixeladas.`);
  }

  game = new Game({
    BABYLON: window.BABYLON,
    canvas: document.getElementById('game-canvas'),
    config: CONFIG,
    spriteManager,
    pixelRenderer,
  });
  app.game = game;
  game.onModeChange = (state) => menu.showGameState(state);
  // A qualidade também muda a resolução: o menu acompanha.
  game.onQualityChange = ({ quality, renderScale }) => menu.setValues({ quality, renderScale });
  const hud = new Hud(document, { flash: CONFIG.exorcism.flash });
  game.onHud = (state) => hud.render(state);
  const notebook = new Notebook(document, {
    investigation: game.investigation,
    onClose: () => game.closeNotebook(),
  });
  game.onNotebook = (view) => notebook.open(view);
  await game.init();
  // Atalho para laboratórios: ?qualidade=muito-baixo (ver start.sh --qualidade).
  const requested = new URLSearchParams(window.location.search).get('qualidade');
  if (requested && !game.setQuality(requested)) console.warn(`[graficos] qualidade desconhecida: ${requested}`);
  game.start();
  window.addEventListener('resize', () => game.resize());

  menu.setValues({
    quality: game.quality,
    renderScale: pixelRenderer.settings.renderScale,
    resolutionScale: pixelRenderer.settings.resolutionScale,
    fogDensity: CONFIG.environment.fog.density,
  });
  menu.setReady(true);

  const problems = spriteManager.getProblems().length;
  if (problems > 0) {
    menu.setStatus(`Atenção: ${problems} problema(s) com sprites. Veja o console (F12).`, 'warning');
  } else {
    menu.setStatus(`Versão ${CONFIG.version} — exploração`);
  }
  app.status = 'ready';
}

boot().catch((error) => {
  app.status = 'error';
  app.error = String(error?.message ?? error);
  console.error('[forest-exorcist] falha na inicialização', error);
  menu.setStatus(`Não foi possível iniciar o jogo: ${app.error}`, 'error');
});

// A imagem do título é opcional: sem ela, o texto alternativo vira o título.
const title = document.querySelector('.title-image');
const showTextTitle = () => title.closest('.title').classList.add('title--text');
title.addEventListener('error', showTextTitle);
if (title.complete && title.naturalWidth === 0) showTextTitle();
