/**
 * Controle central da pixelização: redução de resolução com nearest-neighbor,
 * filtros de textura, resolução de renderização 3D e imagens de interface.
 */

export const PIXEL_DEFAULTS = Object.freeze({
  pixelsPerUnit: 16,
  resolutionScale: 1,
  maxTextureSize: 256,
  renderScale: 2,
  alphaCutoff: 0,
  colorLevels: 0,
});

const LIMITS = Object.freeze({
  pixelsPerUnit: [1, 256],
  resolutionScale: [0.1, 8],
  maxTextureSize: [8, 2048],
  renderScale: [1, 6],
  alphaCutoff: [0, 255],
  colorLevels: [0, 64],
});

export class PixelRenderer {
  /**
   * @param {Partial<typeof PIXEL_DEFAULTS>} settings
   * @param {{ createCanvas?: (width: number, height: number) => any }} [deps]
   */
  constructor(settings = {}, { createCanvas = createDomCanvas } = {}) {
    this.createCanvas = createCanvas;
    this.settings = { ...PIXEL_DEFAULTS };
    this.configure(settings);
  }

  /** Atualiza configurações; valores inválidos são ignorados e os demais, limitados. */
  configure(changes = {}) {
    for (const [key, value] of Object.entries(changes)) {
      if (!(key in LIMITS) || !Number.isFinite(value)) continue;
      const [min, max] = LIMITS[key];
      this.settings[key] = Math.min(max, Math.max(min, value));
    }
    return this.settings;
  }

  /**
   * Resolução final de uma textura. A proporção é preservada (a menos de
   * arredondamento para pixels inteiros) e a imagem nunca é ampliada.
   *
   * Prioridade da altura desejada: pixelHeight > worldHeight * pixelsPerUnit > original.
   */
  computeSize(sourceWidth, sourceHeight, options = {}) {
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      throw new RangeError(`Dimensões inválidas: ${sourceWidth}x${sourceHeight}`);
    }
    const opts = { ...this.settings, ...stripUndefined(options) };

    let targetHeight = sourceHeight;
    if (opts.pixelHeight > 0) targetHeight = opts.pixelHeight;
    else if (opts.worldHeight > 0) targetHeight = opts.worldHeight * opts.pixelsPerUnit;

    let scale = Math.min(1, (targetHeight * opts.resolutionScale) / sourceHeight);
    scale = Math.min(scale, opts.maxTextureSize / Math.max(sourceWidth, sourceHeight));

    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }

  /**
   * Gera um canvas pixelado a partir de uma imagem/canvas, sem suavização.
   * A transparência é preservada, salvo se alphaCutoff for maior que zero.
   * Com `powerOfTwo`, ajusta para potências de 2 (texturas repetidas em WebGL 1).
   */
  pixelate(source, options = {}) {
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;
    let { width, height } = this.computeSize(sourceWidth, sourceHeight, options);
    if (options.powerOfTwo) {
      width = nearestPowerOfTwo(width);
      height = nearestPowerOfTwo(height);
    }

    const canvas = this.createCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);

    const alphaCutoff = options.alphaCutoff ?? this.settings.alphaCutoff;
    const colorLevels = options.colorLevels ?? this.settings.colorLevels;
    if (alphaCutoff > 0 || colorLevels >= 2) {
      const image = context.getImageData(0, 0, width, height);
      processPixels(image.data, { alphaCutoff, colorLevels });
      context.putImageData(image, 0, 0);
    }
    return canvas;
  }

  /**
   * Constantes de amostragem do Babylon.js.
   * - sprite: nearest puro, sem mipmaps.
   * - surface: nearest na ampliação; mipmaps na redução para o chão não cintilar.
   */
  getSampling(BABYLON, kind = 'sprite') {
    if (kind === 'surface') {
      return {
        samplingMode: BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR,
        generateMipMaps: true,
        wrap: BABYLON.Texture.WRAP_ADDRESSMODE,
      };
    }
    return {
      samplingMode: BABYLON.Texture.NEAREST_SAMPLINGMODE,
      generateMipMaps: false,
      wrap: BABYLON.Texture.CLAMP_ADDRESSMODE,
    };
  }

  /** Opções de criação do motor 3D coerentes com a estética pixelada. */
  getEngineOptions() {
    return {
      antialias: false,
      options: {
        preserveDrawingBuffer: false,
        stencil: false,
        powerPreference: 'high-performance',
      },
    };
  }

  /** Reduz a resolução interna da renderização e amplia sem suavizar. */
  applyToEngine(engine) {
    engine.setHardwareScalingLevel(this.settings.renderScale);
    this.applyToDisplayElement(engine.getRenderingCanvas?.());
  }

  /** Faz o navegador ampliar um <canvas>/<img> com nearest-neighbor. */
  applyToDisplayElement(element) {
    if (!element?.style) return;
    element.style.imageRendering = 'pixelated';
  }

  /**
   * Pixeliza uma imagem de interface (<img>). O tamanho na tela continua sendo
   * definido pelo CSS; só a resolução interna muda. O original é guardado em
   * data-source para permitir reprocessar.
   */
  async pixelateElement(img, options = {}) {
    const originalSrc = img.dataset.source || img.getAttribute('src');
    img.dataset.source = originalSrc;
    this.applyToDisplayElement(img);

    const source = new img.ownerDocument.defaultView.Image();
    source.src = originalSrc;
    await source.decode();

    const pixelHeight = options.pixelHeight ?? (Number(img.dataset.pixelHeight) || undefined);
    const canvas = this.pixelate(source, { maxTextureSize: 2048, ...options, pixelHeight });
    img.src = canvas.toDataURL('image/png');
    return img;
  }

  /** Aplica a pixelização a todos os <img data-pixelate> de um contêiner. */
  async pixelateAll(root) {
    const images = [...root.querySelectorAll('img[data-pixelate]')];
    const results = await Promise.allSettled(images.map((img) => this.pixelateElement(img)));
    return results.filter((result) => result.status === 'rejected').length;
  }
}

/** Alfa binário e posterização, aplicados diretamente sobre dados RGBA. */
export function processPixels(data, { alphaCutoff = 0, colorLevels = 0 } = {}) {
  const step = colorLevels >= 2 ? 255 / (colorLevels - 1) : 0;
  for (let i = 0; i < data.length; i += 4) {
    if (alphaCutoff > 0) data[i + 3] = data[i + 3] >= alphaCutoff ? 255 : 0;
    if (step) {
      for (let c = 0; c < 3; c += 1) {
        data[i + c] = Math.round(Math.round(data[i + c] / step) * step);
      }
    }
  }
  return data;
}

export function nearestPowerOfTwo(value) {
  return 2 ** Math.max(0, Math.round(Math.log2(value)));
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function createDomCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
