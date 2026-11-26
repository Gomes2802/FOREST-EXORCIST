/**
 * Registro e carregamento de sprites substituíveis.
 *
 * Um sprite é identificado por um ID. A definição (arquivo, grupo, tamanho no
 * mundo...) vem de assets/sprites/manifest.json. IDs não registrados que
 * contenham "/" são resolvidos por convenção: "environment/oak" carrega
 * assets/sprites/environment/oak.png.
 *
 * Um sprite ausente ou corrompido nunca interrompe o jogo: é substituído por um
 * xadrez magenta e o problema é registrado em getProblems().
 */

const DEFINITION_DEFAULTS = Object.freeze({
  group: 'misc',
  worldHeight: 1,
  /** "cutout": bordas duras (barato). "blend": respeita transparência parcial. */
  alphaMode: 'cutout',
  /** "scene": escurecido pela noite. "glow": brilha por conta própria. */
  shading: 'scene',
  /** Raio sólido na base, em unidades do mundo. 0 = atravessável. */
  collisionRadius: 0,
});

/** Opções por sprite repassadas ao PixelRenderer. */
const PIXEL_KEYS = ['pixelHeight', 'pixelsPerUnit', 'alphaCutoff', 'colorLevels', 'maxTextureSize'];

const FALLBACK_SIZE = 16;

export class SpriteManager {
  constructor({
    pixelRenderer,
    basePath = 'assets/sprites/',
    loadImage = loadDomImage,
    fetchJson = fetchLocalJson,
    logger = console,
  }) {
    if (!pixelRenderer) throw new Error('SpriteManager requer um pixelRenderer.');
    this.pixelRenderer = pixelRenderer;
    this.basePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
    this.loadImage = loadImage;
    this.fetchJson = fetchJson;
    this.logger = logger;
    this.definitions = new Map();
    this.records = new Map();
    this.pending = new Map();
    this.problems = [];
  }

  /** Lê o manifesto e registra os sprites. Retorna false se não puder ser lido. */
  async loadManifest(url) {
    try {
      const manifest = await this.fetchJson(url);
      if (!manifest?.sprites || typeof manifest.sprites !== 'object') {
        throw new Error('o manifesto precisa de um objeto "sprites"');
      }
      for (const [id, definition] of Object.entries(manifest.sprites)) {
        try {
          this.register(id, definition);
        } catch (error) {
          this.#report(id, error.message);
        }
      }
      return true;
    } catch (error) {
      this.#report(url, `manifesto inválido ou inacessível: ${error.message}`);
      return false;
    }
  }

  /** Associa um ID a um arquivo. Registrar de novo substitui o anterior. */
  register(id, definition = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('ID de sprite vazio.');
    const file = definition.file ?? `${id}.png`;
    assertLocalPath(file);

    const merged = { ...DEFINITION_DEFAULTS, ...definition, id, file };
    if (!(merged.worldHeight > 0)) merged.worldHeight = DEFINITION_DEFAULTS.worldHeight;
    if (!(merged.collisionRadius > 0)) merged.collisionRadius = 0;

    this.definitions.set(id, Object.freeze(merged));
    this.records.delete(id);
    this.pending.delete(id);
    return merged;
  }

  has(id) {
    return this.definitions.has(id);
  }

  ids() {
    return [...this.definitions.keys()];
  }

  idsByGroup(group) {
    return this.ids().filter((id) => this.definitions.get(id).group === group);
  }

  /** Carrega um sprite (com cache). Sempre resolve para um registro utilizável. */
  load(id) {
    if (this.records.has(id)) return Promise.resolve(this.records.get(id));
    if (!this.pending.has(id)) {
      const task = this.#loadNow(id).finally(() => this.pending.delete(id));
      this.pending.set(id, task);
    }
    return this.pending.get(id);
  }

  loadAll(ids = this.ids()) {
    return Promise.all(ids.map((id) => this.load(id)));
  }

  /** Acesso síncrono. Se o sprite não foi carregado, devolve a alternativa visual. */
  get(id) {
    const record = this.records.get(id);
    if (record) return record;
    this.#report(id, 'solicitado sem estar carregado');
    return this.#createRecord(this.#resolveDefinition(id), null);
  }

  /**
   * Carrega uma imagem de superfície (fora da pasta de sprites), como o chão.
   * Se falhar, devolve o mesmo xadrez magenta usado pelos sprites.
   */
  async loadTexture(path) {
    assertLocalPath(path);
    try {
      const image = await this.loadImage(path);
      if (!(image?.width > 0) || !(image?.height > 0)) throw new Error('imagem vazia');
      return { status: 'loaded', image };
    } catch (error) {
      this.#report(path, `não foi possível carregar a textura (${error.message})`);
      return { status: 'fallback', image: this.#createFallbackImage() };
    }
  }

  /** Reprocessa os sprites carregados após mudança nas configurações de pixel art. */
  repixelate() {
    for (const [id, record] of this.records) {
      this.records.set(id, this.#createRecord(record.definition, record.image));
    }
  }

  getProblems() {
    return [...this.problems];
  }

  async #loadNow(id) {
    const definition = this.#resolveDefinition(id);
    let image = null;
    if (definition.file) {
      const url = this.basePath + definition.file;
      try {
        image = await this.loadImage(url);
        if (!(image?.width > 0) || !(image?.height > 0)) throw new Error('imagem vazia');
      } catch (error) {
        image = null;
        this.#report(id, `não foi possível carregar "${url}" (${error.message})`);
      }
    } else {
      this.#report(id, 'ID não registrado no manifesto');
    }
    const record = this.#createRecord(definition, image);
    this.records.set(id, record);
    return record;
  }

  #resolveDefinition(id) {
    if (this.definitions.has(id)) return this.definitions.get(id);
    let file = null;
    if (id.includes('/')) {
      file = id.endsWith('.png') ? id : `${id}.png`;
      try {
        assertLocalPath(file);
      } catch {
        file = null;
      }
    }
    return { ...DEFINITION_DEFAULTS, id, file };
  }

  #createRecord(definition, image) {
    const source = image ?? this.#createFallbackImage();
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;

    const options = { worldHeight: definition.worldHeight };
    for (const key of PIXEL_KEYS) options[key] = definition[key];
    // A alternativa visual é minúscula e não deve ser reduzida.
    const canvas = image ? this.pixelRenderer.pixelate(source, options) : source;

    const aspect = sourceWidth / sourceHeight;
    return Object.freeze({
      id: definition.id,
      definition,
      status: image ? 'loaded' : 'fallback',
      image,
      canvas,
      sourceWidth,
      sourceHeight,
      textureWidth: canvas.width,
      textureHeight: canvas.height,
      aspect,
      worldHeight: definition.worldHeight,
      worldWidth: definition.worldHeight * aspect,
    });
  }

  #createFallbackImage() {
    const canvas = this.pixelRenderer.createCanvas(FALLBACK_SIZE, FALLBACK_SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const cell = FALLBACK_SIZE / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        context.fillStyle = (x + y) % 2 === 0 ? '#ff00ff' : '#14001a';
        context.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    return canvas;
  }

  #report(id, message) {
    if (this.problems.some((p) => p.id === id && p.message === message)) return;
    this.problems.push({ id, message });
    this.logger.warn(`[sprites] ${id}: ${message}`);
  }
}

/** Impede caminhos remotos ou fora da pasta de sprites (o jogo é offline). */
function assertLocalPath(file) {
  if (typeof file !== 'string' || !file) throw new Error('Arquivo de sprite inválido.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith('/') || file.split(/[\\/]/).includes('..')) {
    throw new Error(`Caminho não permitido: "${file}". Use um caminho relativo à pasta de sprites.`);
  }
}

function loadDomImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('arquivo ausente ou formato inválido'));
    image.src = url;
  });
}

async function fetchLocalJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
