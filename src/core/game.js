/**
 * Orquestra o motor 3D, a cena, o ciclo de renderização e os modos de jogo:
 *  - "menu": câmera balançando atrás do menu;
 *  - "playing": o jogador explora a floresta;
 *  - "paused": a cena fica congelada.
 */
import { createLighting } from '../world/lighting.js';
import { createForest } from '../world/forest.js';
import { applyAtmosphere } from '../world/environment.js';
import { createPlayer } from '../player/player.js';
import { createCross, createSpriteCrossVisual } from '../player/cross.js';
import { createEntity } from '../entities/entity.js';
import { createTargeting } from '../systems/interaction.js';
import { createExorcism } from '../systems/exorcism.js';
import { viewDirection } from '../world/lighting.js';
import { createCameraController } from './camera.js';
import { InputController } from './input.js';

export class Game {
  constructor({ BABYLON, canvas, config, spriteManager, pixelRenderer, createEngine, input }) {
    if (!BABYLON) throw new Error('Babylon.js não foi carregado (lib/babylon.js).');
    this.BABYLON = BABYLON;
    this.canvas = canvas;
    this.config = config;
    this.spriteManager = spriteManager;
    this.pixelRenderer = pixelRenderer;
    this.createEngine = createEngine ?? (() => this.#createWebGLEngine());
    this.state = 'created';
    this.engine = null;
    this.scene = null;
    this.forest = null;
    this.player = null;
    this.view = null;
    this.lights = null;
    this.entity = null;
    this.cross = null;
    this.targeting = null;
    this.exorcism = null;
    /** Entidade sob a mira, ou null. */
    this.target = null;
    /** Segundos restantes da mensagem de conclusão. */
    this.messageTime = 0;
    /** Chamado a cada atualização com o estado da interface (ver ui/hud.js). */
    this.onHud = () => {};
    this.input = input ?? new InputController({ element: canvas });
    this.mode = 'menu';
    /** Chamado a cada mudança de modo com { mode, control, notice }. */
    this.onModeChange = () => {};
    this.session = 0;
    /** Captura em andamento (evita pedidos duplicados). */
    this.capturing = null;
    this.rebuildQueue = Promise.resolve();
  }

  async init() {
    if (this.state !== 'created') throw new Error(`init() chamado no estado "${this.state}".`);
    this.state = 'initializing';
    try {
      const { BABYLON, config } = this;
      this.engine = this.createEngine();
      this.pixelRenderer.applyToEngine(this.engine);

      this.scene = new BABYLON.Scene(this.engine);
      this.scene.skipPointerMovePicking = true;
      applyAtmosphere(BABYLON, this.scene, config.environment);
      this.lights = createLighting(BABYLON, this.scene, config.lighting);
      this.player = createPlayer(BABYLON, this.scene, config.player);
      this.view = createCameraController(
        BABYLON, this.scene, config.camera, config.player.eyeHeight, config.player.startPosition,
      );

      await this.spriteManager.loadManifest(config.assets.spriteManifest);
      this.forest = await this.#buildForest();
      await this.#buildEncounter();
      this.input.onPauseRequest = () => this.pause();
      this.input.onAction = (action) => {
        if (action === 'lantern' && this.mode === 'playing') this.lights.flashlight.toggle();
      };
      this.input.attach();
      this.state = 'ready';
    } catch (error) {
      this.state = 'failed';
      throw error;
    }
  }

  start() {
    if (this.state === 'running') return;
    if (this.state !== 'ready') throw new Error(`start() chamado no estado "${this.state}".`);
    this.state = 'running';
    this.engine.runRenderLoop(() => this.renderFrame());
  }

  stop() {
    if (this.state !== 'running') return;
    this.engine.stopRenderLoop();
    this.state = 'ready';
  }

  renderFrame() {
    // Limita o delta para a câmera não saltar depois de a aba ficar em segundo plano.
    const delta = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    this.update(delta);
    this.scene.render();
  }

  /** Avança a simulação conforme o modo atual (sem desenhar). */
  update(delta) {
    if (this.mode === 'playing') {
      const { dx, dy } = this.input.consumeLook();
      this.view.look(dx, dy);
      this.player.update(delta, this.input.getIntent(), this.view.yaw);
      this.view.update(delta, this.player);
      this.#updateExorcism(delta);
    } else if (this.mode === 'menu') {
      this.view.updateIdle(delta, this.player.position);
    }
    // Pausado, a entidade também fica imóvel.
    if (this.mode !== 'paused') this.entity.update(delta);
    this.#followPlayer();
    this.onHud(this.#hudState());
  }

  /** Começa uma exploração a partir do ponto inicial. Chamar dentro de um clique. */
  play() {
    if (this.mode !== 'menu') return Promise.resolve(this.mode);
    if (this.capturing) return this.capturing;
    this.resetPlayer();
    return this.#capture();
  }

  /** Volta ao jogo depois da pausa. Chamar dentro de um clique. */
  resume() {
    if (this.mode !== 'paused') return Promise.resolve(this.mode);
    return this.capturing ?? this.#capture();
  }

  /** Joga sem captura do ponteiro (arrastar para olhar). */
  resumeWithoutLock() {
    if (this.mode !== 'paused') return;
    this.#cancelCapture();
    this.#enterPlaying('drag');
  }

  pause(notice = null) {
    if (this.mode !== 'playing') return;
    this.input.disable();
    this.player.stop();
    this.#setMode('paused', { notice });
  }

  quitToMenu() {
    this.#cancelCapture();
    this.input.disable();
    this.resetPlayer();
    this.#setMode('menu');
  }

  resetPlayer() {
    this.lights.flashlight.reset();
    this.player.reset();
    this.view.reset(this.player.position);
    this.entity.reset();
    this.cross.reset();
    this.exorcism.reset();
    this.target = null;
    this.messageTime = 0;
    this.#followPlayer();
    this.onHud(this.#hudState());
  }

  #capture() {
    const task = this.#requestControl(++this.session).finally(() => {
      if (this.capturing === task) this.capturing = null;
    });
    this.capturing = task;
    return task;
  }

  #cancelCapture() {
    this.session += 1;
    this.capturing = null;
  }

  async #requestControl(session) {
    // requestLock precisa ser a primeira chamada, ainda dentro do gesto do usuário.
    const result = await this.input.requestLock();
    if (session !== this.session) {
      // Desistência: devolve o ponteiro, a não ser que um novo pedido o aguarde.
      if (!this.capturing && this.mode !== 'playing') this.input.releaseLock();
      return this.mode;
    }
    if (result === 'locked' && this.input.isLocked) this.#enterPlaying('lock');
    else if (result === 'unsupported') this.#enterPlaying('drag');
    else this.#setMode('paused', { notice: 'lock-denied' });
    return this.mode;
  }

  #enterPlaying(control) {
    this.input.enable(control);
    this.#setMode('playing', { control });
  }

  #setMode(mode, { control = null, notice = null } = {}) {
    this.mode = mode;
    this.onModeChange({ mode, control, notice });
  }

  /** Cria a entidade de teste, a cruz e as regras do exorcismo. */
  async #buildEncounter() {
    const { BABYLON, scene, config, spriteManager, pixelRenderer } = this;
    const { entity, exorcism } = config;
    await spriteManager.loadAll([entity.sprite, exorcism.cross.sprite]);
    const assets = { spriteManager, pixelRenderer };
    this.entity = createEntity(BABYLON, scene, { settings: entity, ...assets });
    this.cross = createCross(BABYLON, scene, this.view.camera, {
      settings: exorcism.cross,
      requiredRaise: exorcism.requiredRaise,
      createVisual: () => createSpriteCrossVisual(BABYLON, scene, { settings: exorcism.cross, ...assets }),
    });
    this.targeting = createTargeting(BABYLON, exorcism);
    this.exorcism = createExorcism(exorcism);
  }

  /** Mira, cruz e progresso; só durante o jogo. */
  #updateExorcism(delta) {
    const { camera } = this.view;
    const holding = this.input.isPrimaryHeld;
    this.messageTime = Math.max(0, this.messageTime - delta);
    const readyTime = this.cross.update(delta, holding);
    this.target = this.targeting.find(
      camera.position,
      viewDirection(camera.rotation.y, camera.rotation.x),
      [this.entity],
      this.forest.occluders,
    );
    const expelled = this.exorcism.update(delta, { holding, readyTime, target: this.target });
    if (expelled) {
      this.target = null;
      this.messageTime = this.config.exorcism.messageDuration;
    }
    this.cross.setExorcising(this.entity.state === 'exorcising');
  }

  #hudState() {
    const { entity, target, config } = this;
    const aimed = Boolean(target?.isTargetable);
    const exorcising = entity.state === 'exorcising';
    let aim = 'idle';
    if (aimed) aim = exorcising ? 'exorcising' : 'target';
    const showProgress = entity.isTargetable && entity.progress > 0 && (aimed || exorcising);
    return {
      raised: this.cross.amount >= config.exorcism.requiredRaise,
      aim,
      progress: showProgress ? entity.progress : null,
      message: this.messageTime > 0 ? config.exorcism.message : null,
    };
  }

  /** Mantém a lanterna e o horizonte junto do observador. */
  #followPlayer() {
    const { camera } = this.view;
    this.lights.flashlight.follow(camera);
    this.forest?.follow(camera.position);
  }

  resize() {
    this.engine?.resize();
  }

  /** Resolução interna da imagem 3D (1 = nativa; maior = mais pixelado). */
  setRenderScale(value) {
    this.pixelRenderer.configure({ renderScale: value });
    this.pixelRenderer.applyToEngine(this.engine);
    this.engine.resize();
  }

  setFogDensity(value) {
    if (Number.isFinite(value) && value >= 0) this.scene.fogDensity = value;
  }

  /** Muda a resolução dos sprites e recria a floresta. Chamadas são enfileiradas. */
  setSpriteResolution(value) {
    const task = this.rebuildQueue.then(async () => {
      this.pixelRenderer.configure({ resolutionScale: value });
      this.spriteManager.repixelate();
      this.forest.dispose();
      this.forest = await this.#buildForest();
      this.entity.refresh();
      this.cross.refresh();
      this.#followPlayer();
    });
    this.rebuildQueue = task.catch(() => {});
    return task;
  }

  dispose() {
    this.stop();
    this.input.detach();
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
    this.state = 'disposed';
  }

  #buildForest() {
    return createForest(this.BABYLON, this.scene, {
      config: this.config,
      spriteManager: this.spriteManager,
      pixelRenderer: this.pixelRenderer,
      lights: this.lights,
    });
  }

  #createWebGLEngine() {
    const { antialias, options } = this.pixelRenderer.getEngineOptions();
    // adaptToDeviceRatio = false: a resolução é controlada só por renderScale.
    return new this.BABYLON.Engine(this.canvas, antialias, options, false);
  }
}
