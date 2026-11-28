/** Substitutos de canvas/imagem para testar no Node, e carga do Babylon local. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
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

/** Canal alfa de um PNG RGBA de 8 bits, sem entrelaçamento. */
export function readPngAlpha(path) {
  const bytes = readFileSync(path);
  const { width, height } = readPngSize(path);
  const data = [];
  for (let offset = 8; offset < bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
    if (bytes.toString('ascii', offset + 4, offset + 8) !== 'IDAT') continue;
    data.push(bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32BE(offset)));
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const guess = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + guess) & 255;
    }
  }
  return { width, height, alpha: (x, y) => pixels[y * stride + x * 4 + 3] };
}

function paeth(a, b, c) {
  const [pa, pb, pc] = [a, b, c].map((value) => Math.abs(a + b - c - value));
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
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
