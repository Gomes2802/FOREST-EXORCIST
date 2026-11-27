/** Montagem do jogo com o NullEngine do Babylon e um DOM falso. */
import { Game } from '../../src/core/game.js';
import { InputController } from '../../src/core/input.js';
import { CONFIG } from '../../src/config.js';
import { PixelRenderer } from '../../src/graphics/pixelRenderer.js';
import { SpriteManager } from '../../src/graphics/spriteManager.js';
import { createPlayer } from '../../src/player/player.js';
import { createRandom } from '../../src/world/forest.js';
import {
  createCanvas, createLogger, fetchJsonFromDisk, loadBabylon, loadImageFromDisk,
} from './fakes.js';
import { createFakeDom, emit } from './dom.js';

export const BABYLON = loadBabylon();
BABYLON.Logger.LogLevels = BABYLON.Logger.ErrorLogLevel;

const createNullEngine = () => new BABYLON.NullEngine({ renderWidth: 640, renderHeight: 360 });

/** Passos de mentira para os testes: grava o que o jogo pediu, sem som. */
export function createFootstepRecorder() {
  const calls = [];
  return {
    calls,
    loaded: true,
    active: false,
    played: 0,
    lastRate: 0,
    async load() {
      return true;
    },
    async unlock() {
      calls.push('unlock');
      this.active = true;
    },
    suspend() {
      calls.push('suspend');
      this.active = false;
    },
    update() {
      return 0;
    },
  };
}

export function createGame({
  loadImage = loadImageFromDisk, createEngine = createNullEngine, lock, footsteps = createFootstepRecorder(),
  random = createRandom(7),
} = {}) {
  const pixelRenderer = new PixelRenderer(CONFIG.pixel, { createCanvas });
  const logger = createLogger();
  const spriteManager = new SpriteManager({ pixelRenderer, loadImage, fetchJson: fetchJsonFromDisk, logger });
  const dom = createFakeDom({ lock });
  const input = new InputController(dom);
  const game = new Game({
    BABYLON, canvas: null, config: CONFIG, spriteManager, pixelRenderer, createEngine, input, footsteps,
    random,
  });
  const changes = [];
  game.onModeChange = (change) => changes.push(change);
  const press = (...codes) => codes.forEach((code) => emit(dom.window, 'keydown', { code }));
  const release = (...codes) => codes.forEach((code) => emit(dom.window, 'keyup', { code }));
  return { game, spriteManager, logger, dom, input, changes, press, release, footsteps };
}

/** Cena vazia só com o jogador, para testar o movimento isoladamente. */
export function createEmptyWorld(overrides = {}) {
  const engine = createNullEngine();
  const scene = new BABYLON.Scene(engine);
  const settings = { ...CONFIG.player, ...overrides };
  const player = createPlayer(BABYLON, scene, settings);
  return { engine, scene, player, settings, dispose: () => { scene.dispose(); engine.dispose(); } };
}

export const intent = (forward = 0, right = 0, run = false) => ({ forward, right, run });

/** Simula `seconds` de jogo com quadros a uma taxa fixa. */
export function simulate(player, move, { seconds = 1, fps = 60, yaw = 0 } = {}) {
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) player.update(1 / fps, move, yaw);
}
