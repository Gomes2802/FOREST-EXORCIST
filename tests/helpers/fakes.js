/** Substitutos de canvas/imagem para testar no Node, e carga do Babylon local. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const projectPath = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
export const readProjectFile = (path) => readFileSync(projectPath(path), 'utf8');

/** Canvas mínimo: drawImage por vizinho mais próximo, fillRect e ImageData. */
export class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.context = createContext(this);
  }

  getContext() {
    return this.context;
  }

  pixel(x, y) {
    return [...this.data.subarray((y * this.width + x) * 4, (y * this.width + x) * 4 + 4)];
  }
}

function createContext(canvas) {
  return {
    imageSmoothingEnabled: true,
    fillStyle: '#000000',
    clearRect() {
      canvas.data.fill(0);
    },
    fillRect(x, y, w, h) {
      const value = parseInt(this.fillStyle.slice(1), 16);
      for (let j = y; j < y + h; j += 1) {
        for (let i = x; i < x + w; i += 1) {
          canvas.data.set([value >> 16, (value >> 8) & 255, value & 255, 255], (j * canvas.width + i) * 4);
        }
      }
    },
    drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const px = sx + Math.floor(((x + 0.5) * sw) / dw);
          const py = sy + Math.floor(((y + 0.5) * sh) / dh);
          const from = (py * source.width + px) * 4;
          canvas.data.set(source.data.subarray(from, from + 4), ((dy + y) * canvas.width + dx + x) * 4);
        }
      }
    },
    getImageData() {
      return { data: new Uint8ClampedArray(canvas.data), width: canvas.width, height: canvas.height };
    },
    putImageData(image) {
      canvas.data.set(image.data);
    },
  };
}

export const createCanvas = (width, height) => new FakeCanvas(width, height);

/** Lê largura/altura do cabeçalho de um PNG real. */
export function readPngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('não é um PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

/** loadImage para o Node: confere o arquivo real e devolve uma imagem do mesmo tamanho. */
export async function loadImageFromDisk(url) {
  const { width, height } = readPngSize(projectPath(url));
  return new FakeCanvas(width, height);
}

export const fetchJsonFromDisk = async (url) => JSON.parse(readProjectFile(url));

export function createLogger() {
  const warnings = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

/** Carrega exatamente o arquivo lib/babylon.js distribuído com o jogo. */
export function loadBabylon() {
  const module = { exports: {} };
  const factory = new Function('module', 'exports', 'require', readProjectFile('lib/babylon.js'));
  factory(module, module.exports, createRequire(import.meta.url));
  return module.exports;
}
