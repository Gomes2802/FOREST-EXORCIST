/**
 * Orquestra o motor 3D, a cena, o ciclo de renderização e os modos de jogo:
 *  - "menu": câmera balançando atrás do menu;
 *  - "playing": o jogador explora a floresta;
 *  - "paused": a cena fica congelada;
 *  - "reading" e "journal": documento ou caderno abertos, com a cena congelada.
 * Com a cena congelada o 3D não é redesenhado: a imagem anterior permanece.
 */
import { createLighting } from '../world/lighting.js';
import { createForest } from '../world/forest.js';
import { applyAtmosphere } from '../world/environment.js';
import { createPlayer } from '../player/player.js';
import { createCross, createSpriteCrossVisual } from '../player/cross.js';
import { createEntityManager } from '../systems/entityManager.js';
import { createBuildings, insideBuilding } from '../world/buildings/index.js';
import { createInteractions } from '../systems/interact.js';
import { createEntitySounds } from '../audio/entitySounds.js';
import { createTargeting } from '../systems/interaction.js';
import { createExorcism } from '../systems/exorcism.js';
import { viewDirection } from '../world/lighting.js';
import { createCameraController } from './camera.js';
import { InputController } from './input.js';
import { createFootsteps } from '../audio/footsteps.js';
import { createInvestigation } from '../systems/investigation.js';

/** Modos em que nada se move. */
const FROZEN = new Set(['paused', 'reading', 'journal']);
/** Modos com o caderno ou um documento abertos. */
const NOTEBOOK = new Set(['reading', 'journal']);

export class Game {
  constructor({
    BABYLON, canvas, config, spriteManager, pixelRenderer, createEngine, input, footsteps,
    sounds, random = Math.random, entityTypes,
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
    /** Gerenciador das entidades (systems/entityManager.js). */
    this.entities = null;
    /** Limita os tipos criados (testes); undefined = todos de CONFIG.entityTypes. */
    this.entityTypes = entityTypes;
    this.buildings = null;
    /** Portas abertas: sobrevive à recriação da cena. */
    this.openDoors = new Set();
    this.interactions = null;
    this.random = random;
    this.sounds = sounds ?? createEntitySounds(config.audio.entity);
    this.cross = null;
    this.targeting = null;
    this.exorcism = null;
    /** Entidade sob a mira, ou null. */
    this.target = null;
    /** Mensagem de conclusão e quantos segundos ainda fica na tela. */
    this.message = null;
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
    /** Chamado ao abrir o caderno ou um documento: { mode, document }. */
    this.onNotebook = () => {};
    /** Documentos encontrados, objetivos e descobertas da exploração atual. */
    this.investigation = createInvestigation(config.investigation);
    /** Segundos de exploração (não conta pausa, leitura nem menu). */
    this.playTime = 0;
    /** Aviso da investigação na tela: { text, time }. */
    this.toast = null;
    this.indoors = false;
    this.lastTarget = null;
    /** Controle ('lock' | 'drag') a retomar ao fechar o caderno. */
    this.returnControl = null;
    /** Quadros que ainda precisam ser desenhados com a cena congelada. */
    this.redraw = 0;
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
      this.buildings = await this.#buildStructures();
      await this.#buildEncounter();
      await this.footsteps.load();
      await this.sounds.load();
      await this.#warmUp();
      this.input.onPauseRequest = () => this.pause();
      this.input.onAction = (action) => {
        if (this.mode !== 'playing') return;
        if (action === 'lantern') this.lights.flashlight.toggle();
        else if (action === 'interact') this.#interact();
        else if (action === 'journal') this.openJournal();
      };
      this.input.attach();
      // Contexto WebGL recuperado com a cena congelada: é preciso redesenhar.
      this.engine.onContextRestoredObservable?.add(() => this.invalidate());
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
    if (this.frozen) {
      if (this.redraw <= 0) return;
      this.redraw -= 1;
      this.#followPlayer();
    }
    this.scene.render();
  }

  /** Pausa, leitura ou caderno: a cena não se move. */
  get frozen() {
    return FROZEN.has(this.mode);
  }

  /** A imagem congelada precisa ser desenhada de novo (tamanho ou opções). */
  invalidate() {
    this.redraw = Math.max(this.redraw, 1);
  }

  /** Avança a simulação conforme o modo atual (sem desenhar). */
  update(delta) {
    if (this.mode === 'playing') {
      this.playTime += delta;
      const { dx, dy } = this.input.consumeLook();
      this.view.look(dx, dy);
      this.player.update(delta, this.input.getIntent(), this.view.yaw);
      this.footsteps.update(this.player);
      this.view.update(delta, this.player);
      this.#updateExorcism(delta);
      this.#updateInteraction(delta);
      this.entities.update(delta, this.#viewer());
      this.#updateAutoQuality(delta);
      this.#updateToast(delta);
    } else if (this.mode === 'menu') {
      this.view.updateIdle(delta, this.player.position);
    }
    // Congelado, entidades, porta e chama também ficam imóveis.
    if (!this.frozen) {
      this.entities.animate(delta);
      const { x, z } = this.player.body.position;
      this.buildings.animate(delta, { x, z, radius: this.config.player.radius });
      this.#followPlayer();
    }
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
    this.#freeze();
    this.#setMode('paused', { notice });
  }

  /** Abre o caderno de investigação (só durante a exploração). */
  openJournal() {
    this.#openNotebook('journal');
  }

  /** Abre um documento para leitura e o registra no caderno. */
  openDocument(id) {
    if (this.mode !== 'playing') return;
    this.investigation.discover(id, this.playTime);
    if (this.investigation.has(id)) this.#openNotebook('reading', id);
  }

  /** Volta à exploração. Chamar em um clique ou tecla (captura do ponteiro). */
  closeNotebook() {
    if (!NOTEBOOK.has(this.mode)) return Promise.resolve(this.mode);
    this.#unlockAudio();
    if (this.returnControl === 'drag') {
      this.#enterPlaying('drag');
      return Promise.resolve(this.mode);
    }
    return this.capturing ?? this.#capture();
  }

  #openNotebook(mode, document = null) {
    if (this.mode !== 'playing') return;
    this.returnControl = this.input.mode;
    this.#freeze();
    this.#setMode(mode);
    this.onNotebook({ mode, document });
  }

  /** Solta os controles e silencia: comum à pausa, à leitura e ao caderno. */
  #freeze() {
    this.input.disable();
    this.player.stop();
    this.footsteps.suspend();
    this.sounds.suspend();
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
    this.entities.reset();
    for (const building of this.buildings.buildings) building.resetDoor(false);
    this.interactions.reset();
    this.sounds.event('reset');
    this.cross.reset();
    this.exorcism.reset();
    this.target = null;
    this.messageTime = 0;
    this.notice = null;
    this.investigation.reset();
    this.playTime = 0;
    this.toast = null;
    this.indoors = false;
    this.lastTarget = null;
    this.#followPlayer();
    this.onHud(this.#hudState());
  }

  /** A entidade original e o seu comportamento. */
  get entity() {
    return this.entities?.get('ghost')?.entity ?? null;
  }

  get haunting() {
    return this.entities?.get('ghost')?.haunting ?? null;
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
    // Ao congelar, dois quadros garantem a imagem atual na tela.
    if (FROZEN.has(mode) && !this.frozen) this.redraw = 2;
    this.mode = mode;
    this.onModeChange({ mode, control, notice });
  }

  /** Cria as entidades e o comportamento, a cruz e as regras do exorcismo. */
  async #buildEncounter() {
    const { BABYLON, scene, config, spriteManager, pixelRenderer } = this;
    const { exorcism } = config;
    const sprites = config.entityTypes.map((type) => type.visual?.sprite ?? config.entity.sprite);
    await spriteManager.loadAll([...new Set([...sprites, exorcism.cross.sprite])]);
    const assets = { spriteManager, pixelRenderer };
    this.entities = createEntityManager(BABYLON, scene, {
      config,
      random: this.random,
      types: this.entityTypes,
      onEvent: (name) => this.sounds.event(name),
      world: () => this.#entityWorld(),
      ...assets,
    });
    this.cross = createCross(BABYLON, scene, this.view.camera, {
      settings: exorcism.cross,
      requiredRaise: exorcism.requiredRaise,
      createVisual: () => createSpriteCrossVisual(BABYLON, scene, { settings: exorcism.cross, ...assets }),
    });
    this.targeting = createTargeting(BABYLON, exorcism);
    this.exorcism = createExorcism(exorcism);
    this.interactions = createInteractions({
      settings: config.interaction,
      playerRadius: config.player.radius,
      buildings: () => this.buildings,
    });
  }

  /**
   * Tudo o que esconde uma entidade: troncos, pedras e paredes. A lista é
   * reaproveitada enquanto a floresta e as portas não mudam.
   */
  #occluders() {
    const { forest } = this;
    const { buildings } = this.buildings;
    const cache = this.occluderCache;
    // Cada construção devolve a mesma lista enquanto a porta não muda de lado.
    if (cache && cache.forest === forest && cache.walls.length === buildings.length
      && buildings.every((building, i) => building.occluders === cache.walls[i])) return cache.all;
    const walls = buildings.map((building) => building.occluders);
    const all = [...forest.occluders, ...walls.flat()];
    this.occluderCache = { forest, walls, all };
    return all;
  }

  /** A floresta vista pelas entidades. */
  #entityWorld() {
    const { config, buildings } = this;
    if (this.structureAreas?.buildings !== buildings) {
      this.structureAreas = {
        buildings,
        forbidden: buildings.plans.map((plan) => plan.footprint),
        anchors: buildings.plans.flatMap((plan) => plan.anchors),
      };
    }
    return {
      boundaryRadius: config.player.boundaryRadius,
      paths: config.forest.paths,
      fogDensity: this.scene.fogDensity,
      occluders: this.#occluders(),
      blockers: this.forest.blockers,
      forbidden: this.structureAreas.forbidden,
      anchors: this.structureAreas.anchors,
    };
  }

  /** O que está ao alcance da tecla E. */
  #updateInteraction(delta) {
    const { camera } = this.view;
    this.interactions.update(delta, camera.position, viewDirection(camera.rotation.y, camera.rotation.x));
  }

  /** Tecla E: documento abre a leitura; objeto examinado vira descoberta. */
  #interact() {
    const item = this.interactions.focus;
    if (!this.interactions.use(this.player.position)) return;
    if (item.type === 'document') this.openDocument(item.documentId);
    else if (item.type === 'examine') this.investigation.note(`examined:${item.id}`);
  }

  /** Mostra os avisos da investigação, um de cada vez. */
  #updateToast(delta) {
    if (this.toast) {
      this.toast.time -= delta;
      if (this.toast.time <= 0) this.toast = null;
    }
    if (this.toast) return;
    const text = this.investigation.takeNotice();
    if (text) this.toast = { text, time: this.config.investigation.noticeDuration };
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
      this.entities.entities,
      this.#occluders(),
    );
    if (this.target !== this.lastTarget) {
      this.lastTarget = this.target;
      if (this.target) this.investigation.note(`sighted:${this.target.id}`);
    }
    const expelled = this.exorcism.update(delta, { holding, readyTime, target: this.target });
    if (expelled) {
      this.investigation.note(`exorcised:${expelled.id}`);
      this.sounds.event('exorcised');
      this.target = null;
      this.message = expelled.expelledMessage ?? this.config.exorcism.message;
      this.messageTime = this.config.exorcism.messageDuration;
    }
    const exorcising = Boolean(this.entities.exorcizing);
    this.cross.setExorcising(exorcising);
    this.sounds.setExorcising(exorcising);
  }

  #hudState() {
    const { target, config } = this;
    const aimed = target?.isTargetable ? target : null;
    // A barra mostra a que está sendo exorcizada; sem isso, a que está na mira.
    const exorcizing = this.entities?.exorcizing ?? null;
    const focus = exorcizing ?? aimed;
    let aim = 'idle';
    if (aimed) aim = exorcizing === aimed ? 'exorcising' : 'target';
    return {
      raised: this.cross.amount >= config.exorcism.requiredRaise,
      aim,
      progress: focus?.isTargetable && focus.progress > 0 ? focus.progress : null,
      message: this.messageTime > 0 ? this.message : null,
      notice: this.notice?.text ?? null,
      prompt: this.interactions.prompt,
      note: this.interactions.message,
      toast: this.toast?.text ?? null,
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
    const entities = this.entities.entities;
    for (const { mesh } of entities) {
      mesh.position.set(camera.position.x + forward.x * 6, 0, camera.position.z + forward.z * 6);
      mesh.setEnabled(true);
    }
    this.cross.root.setEnabled(true);
    // As construções são desenhadas uma vez mesmo fora da vista.
    const structures = this.buildings.meshes;
    for (const mesh of structures) {
      mesh.setEnabled(true);
      mesh.alwaysSelectAsActiveMesh = true;
    }
    // A entidade é desenhada com escala igual e diferente por eixo (a postura de
    // cada aparição): o Babylon.js usa um shader para cada caso.
    for (const [sx, sy] of [[1, 1], [1.05, 1.1]]) {
      for (const { mesh } of entities) mesh.scaling.set(sx, sy, 1);
      await this.#waitForShaders([...entities.map((e) => e.mesh), this.cross.mesh, ...structures]);
      this.scene.render();
    }
    // Devolve o que o estado atual manda desenhar.
    for (const mesh of structures) mesh.alwaysSelectAsActiveMesh = false;
    for (const entity of entities) entity.redraw();
    this.cross.redraw();
    this.buildings.follow({ x: Infinity, z: Infinity }, 0);
    this.#followPlayer();
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
    if (!this.forest) return;
    const { x, z } = camera.position;
    const indoors = Boolean(this.buildings) && insideBuilding(this.buildings.plans, x, z);
    // Só na mudança: entrar numa construção é um acontecimento da investigação.
    if (this.mode === 'playing' && indoors !== this.indoors) {
      this.indoors = indoors;
      for (const plan of indoors ? this.buildings.plans : []) {
        if (insideBuilding([plan], x, z)) this.investigation.note(`entered:${plan.id}`);
      }
    }
    this.forest.follow(camera.position, camera.rotation, indoors);
    this.buildings?.follow(camera.position, this.forest.distances.far);
  }

  resize() {
    this.engine?.resize();
    this.invalidate();
  }

  /** Resolução interna da imagem 3D (1 = nativa; maior = mais pixelado). */
  setRenderScale(value) {
    this.pixelRenderer.configure({ renderScale: value });
    this.pixelRenderer.applyToEngine(this.engine);
    this.resize();
  }

  setFogDensity(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.scene.fogDensity = value;
    this.invalidate();
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
      const structures = this.buildings;
      this.buildings = await this.#buildStructures();
      structures.dispose();
      this.entities.refresh();
      this.cross.refresh();
      this.#followPlayer();
      await this.#warmUp();
      this.invalidate();
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

  #buildStructures() {
    return createBuildings(this.BABYLON, this.scene, {
      config: this.config,
      spriteManager: this.spriteManager,
      pixelRenderer: this.pixelRenderer,
      lights: this.lights,
      openDoors: this.openDoors,
    });
  }

  #createWebGLEngine() {
    const { antialias, options } = this.pixelRenderer.getEngineOptions();
    // adaptToDeviceRatio = false: a resolução é controlada só por renderScale.
    return new this.BABYLON.Engine(this.canvas, antialias, options, false);
  }
}
