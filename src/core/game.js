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
import { createHaunting } from '../systems/haunting.js';
import { createEntitySounds } from '../audio/entitySounds.js';
import { createTargeting } from '../systems/interaction.js';
import { createExorcism } from '../systems/exorcism.js';
import { viewDirection } from '../world/lighting.js';
import { createCameraController } from './camera.js';
import { InputController } from './input.js';
import { createFootsteps } from '../audio/footsteps.js';

export class Game {
  constructor({
    BABYLON, canvas, config, spriteManager, pixelRenderer, createEngine, input, footsteps,
    sounds, random = Math.random,
  }) {
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
    this.haunting = null;
    this.random = random;
    this.sounds = sounds ?? createEntitySounds(config.audio.entity);
    this.cross = null;
    this.targeting = null;
    this.exorcism = null;
    /** Entidade sob a mira, ou null. */
    this.target = null;
    /** Segundos restantes da mensagem de conclusão. */
    this.messageTime = 0;
    /** Chamado a cada atualização com o estado da interface (ver ui/hud.js). */
    this.onHud = () => {};
    /** Qualidade escolhida ('auto' ou um nível) e nível em uso. */
    this.quality = config.graphics.quality;
    this.level = this.quality === 'auto' ? config.graphics.auto.start : this.quality;
    /** Chamado quando o nível muda, com { quality, level, renderScale }. */
    this.onQualityChange = () => {};
    /** Aviso temporário ao jogador: { text, time }. */
    this.notice = null;
    this.autoSamples = { warm: 0, time: 0, frames: 0 };
    this.input = input ?? new InputController({ element: canvas });
    this.footsteps = footsteps ?? createFootsteps(config.audio.footsteps);
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
      this.pixelRenderer.configure({ renderScale: this.detail.renderScale });
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
      await this.footsteps.load();
      await this.sounds.load();
      await this.#warmUp();
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
      this.footsteps.update(this.player);
      this.view.update(delta, this.player);
      this.#updateExorcism(delta);
      this.haunting.update(delta, this.#viewer());
      this.#updateAutoQuality(delta);
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
    this.#unlockAudio();
    this.resetPlayer();
    return this.#capture();
  }

  /** Volta ao jogo depois da pausa. Chamar dentro de um clique. */
  resume() {
    if (this.mode !== 'paused') return Promise.resolve(this.mode);
    this.#unlockAudio();
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
    this.footsteps.suspend();
    this.sounds.suspend();
    this.#setMode('paused', { notice });
  }

  quitToMenu() {
    this.#cancelCapture();
    this.input.disable();
    this.footsteps.suspend();
    this.sounds.suspend();
    this.resetPlayer();
    this.#setMode('menu');
  }

  resetPlayer() {
    this.lights.flashlight.reset();
    this.player.reset();
    this.view.reset(this.player.position);
    this.entity.reset();
    this.haunting.reset();
    this.sounds.event('reset');
    this.cross.reset();
    this.exorcism.reset();
    this.target = null;
    this.messageTime = 0;
    this.notice = null;
    this.#followPlayer();
    this.onHud(this.#hudState());
  }

  /** Nível de qualidade em uso (CONFIG.graphics.presets). */
  get detail() {
    return this.config.graphics.presets[this.level];
  }

  /**
   * Escolhe a qualidade gráfica: 'auto' ou um dos níveis. Muda a resolução e as
   * distâncias de desenho na hora, sem recriar a floresta.
   * @returns {boolean} false se o nome for desconhecido
   */
  setQuality(quality) {
    const { graphics } = this.config;
    if (quality !== 'auto' && !Object.hasOwn(graphics.presets, quality)) return false;
    this.quality = quality;
    this.autoSamples = { warm: 0, time: 0, frames: 0 };
    this.#applyLevel(quality === 'auto' ? graphics.auto.start : quality);
    return true;
  }

  #applyLevel(level) {
    this.level = level;
    const { renderScale } = this.detail;
    if (this.engine) this.setRenderScale(renderScale);
    this.forest?.setDetail(this.detail);
    if (this.view) this.#followPlayer();
    this.onQualityChange({ quality: this.quality, level, renderScale });
  }

  /** Modo automático: desce um nível se o jogo ficar lento, e avisa o jogador. */
  #updateAutoQuality(delta) {
    if (this.notice) {
      this.notice.time -= delta;
      if (this.notice.time <= 0) this.notice = null;
    }
    const { auto, levels, labels } = this.config.graphics;
    if (this.quality !== 'auto') return;
    const samples = this.autoSamples;
    samples.warm += delta;
    if (samples.warm < auto.warmup) return;
    samples.time += delta;
    samples.frames += 1;
    if (samples.time < auto.window) return;
    const fps = samples.frames / samples.time;
    samples.time = 0;
    samples.frames = 0;
    const index = levels.indexOf(this.level);
    if (fps >= auto.minFps || index <= 0) return;
    const next = levels[index - 1];
    this.#applyLevel(next);
    samples.warm = 0;
    this.notice = {
      text: `Qualidade gráfica reduzida para ${labels[next]} (${Math.round(fps)} FPS). Ajuste em Configurações.`,
      time: auto.noticeDuration,
    };
  }

  /** Ligar o áudio precisa do gesto do jogador: é chamado em play() e resume(). */
  #unlockAudio() {
    for (const audio of [this.footsteps, this.sounds]) {
      audio.unlock().catch((error) => console.warn(`[audio] ${error.message}`));
    }
  }

  /** O que a entidade percebe do jogador. */
  #viewer() {
    const { camera } = this.view;
    return {
      x: camera.position.x,
      z: camera.position.z,
      yaw: camera.rotation.y,
      eyeHeight: this.config.player.eyeHeight,
    };
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
    // Os primeiros quadros depois de entrar ou voltar não contam para o automático.
    this.autoSamples.warm = 0;
    this.#setMode('playing', { control });
  }

  #setMode(mode, { control = null, notice = null } = {}) {
    this.mode = mode;
    this.onModeChange({ mode, control, notice });
  }

  /** Cria a entidade e o seu comportamento, a cruz e as regras do exorcismo. */
  async #buildEncounter() {
    const { BABYLON, scene, config, spriteManager, pixelRenderer } = this;
    const { entity, exorcism } = config;
    await spriteManager.loadAll([entity.sprite, exorcism.cross.sprite]);
    const assets = { spriteManager, pixelRenderer };
    this.entity = createEntity(BABYLON, scene, { settings: entity, timing: config.haunting, ...assets });
    this.haunting = createHaunting({
      entity: this.entity,
      settings: config.haunting,
      random: this.random,
      onEvent: (name) => this.sounds.event(name),
      world: () => ({
        boundaryRadius: config.player.boundaryRadius,
        paths: config.forest.paths,
        fogDensity: this.scene.fogDensity,
        occluders: this.forest.occluders,
        blockers: this.forest.blockers,
      }),
    });
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
      this.sounds.event('exorcised');
      this.target = null;
      this.messageTime = this.config.exorcism.messageDuration;
    }
    this.cross.setExorcising(this.entity.state === 'exorcizing');
    this.sounds.setExorcising(this.entity.state === 'exorcizing');
  }

  #hudState() {
    const { entity, target, config } = this;
    const aimed = Boolean(target?.isTargetable);
    const exorcising = entity.state === 'exorcizing';
    let aim = 'idle';
    if (aimed) aim = exorcising ? 'exorcising' : 'target';
    const showProgress = entity.isTargetable && entity.progress > 0 && (aimed || exorcising);
    return {
      raised: this.cross.amount >= config.exorcism.requiredRaise,
      aim,
      progress: showProgress ? entity.progress : null,
      message: this.messageTime > 0 ? config.exorcism.message : null,
      notice: this.notice?.text ?? null,
    };
  }

  /**
   * Desenha a entidade e a cruz uma vez, fora de hora. Elas começam escondidas e,
   * sem isto, o navegador só prepararia os shaders na primeira aparição e na
   * primeira vez que a cruz sobe, travando o jogo nesses instantes.
   */
  async #warmUp() {
    const { camera } = this.view;
    const forward = viewDirection(camera.rotation.y, 0);
    this.entity.mesh.position.set(camera.position.x + forward.x * 6, 0, camera.position.z + forward.z * 6);
    this.entity.mesh.setEnabled(true);
    this.cross.root.setEnabled(true);
    // A entidade é desenhada com escala igual e diferente por eixo (a postura de
    // cada aparição): o Babylon.js usa um shader para cada caso.
    for (const [sx, sy] of [[1, 1], [1.05, 1.1]]) {
      this.entity.mesh.scaling.set(sx, sy, 1);
      await this.#waitForShaders([this.entity.mesh, this.cross.mesh]);
      this.scene.render();
    }
    // Devolve o que o estado atual manda desenhar.
    this.entity.redraw();
    this.cross.redraw();
  }

  /**
   * Espera limitada (no máximo ~2 s): o aquecimento nunca pode travar o jogo.
   * Sem canvas (motor de testes) não há shaders para compilar.
   */
  async #waitForShaders(meshes) {
    const attempts = this.engine.getRenderingCanvas() ? 100 : 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (meshes.every((mesh) => mesh.material.isReady(mesh))) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** Mantém a lanterna e o horizonte junto do observador. */
  #followPlayer() {
    const { camera } = this.view;
    this.lights.flashlight.follow(camera);
    this.forest?.follow(camera.position, camera.rotation);
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
      // A nova floresta fica pronta antes de a antiga sair: nenhum quadro é
      // desenhado (nem atualizado) com uma floresta já descartada.
      const previous = this.forest;
      this.forest = await this.#buildForest();
      previous.dispose();
      this.entity.refresh();
      this.cross.refresh();
      this.#followPlayer();
      await this.#warmUp();
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
      detail: this.detail,
    });
  }

  #createWebGLEngine() {
    const { antialias, options } = this.pixelRenderer.getEngineOptions();
    // adaptToDeviceRatio = false: a resolução é controlada só por renderScale.
    return new this.BABYLON.Engine(this.canvas, antialias, options, false);
  }
}
