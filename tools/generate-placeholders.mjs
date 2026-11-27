/**
 * Gera a pixel art provisória (original, desenhada por código).
 * Arquivos existentes NÃO são sobrescritos, para não apagar suas imagens.
 * Use --force para recriar todos os provisórios.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { createRandom } from '../src/world/forest.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

class Bitmap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x, y, hex, alpha = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const value = parseInt(hex.slice(1), 16);
    this.data.set([value >> 16, (value >> 8) & 255, value & 255, alpha], (y * this.width + x) * 4);
  }

  filled(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.data[(y * this.width + x) * 4 + 3] > 0;
  }

  rect(x, y, w, h, hex) {
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.set(x + i, y + j, hex);
  }

  line(x0, y0, x1, y1, thickness, hex) {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const size = Math.max(1, Math.round(thickness * (1 - 0.5 * t)));
      this.rect(
        Math.round(x0 + (x1 - x0) * t - size / 2),
        Math.round(y0 + (y1 - y0) * t),
        size,
        1,
        hex,
      );
    }
  }

  /** Contorno de 1 pixel em volta do desenho, para destacar a silhueta. */
  outline(hex, alpha = 255) {
    const edge = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.filled(x, y)) continue;
        if (this.filled(x - 1, y) || this.filled(x + 1, y) || this.filled(x, y - 1) || this.filled(x, y + 1)) {
          edge.push([x, y]);
        }
      }
    }
    edge.forEach(([x, y]) => this.set(x, y, hex, alpha));
  }
}

const pick = (random, colors) => colors[Math.floor(random() * colors.length)];

function tree() {
  const img = new Bitmap(48, 88);
  const random = createRandom(11);
  img.rect(21, 66, 6, 22, '#3a2a22');
  img.rect(21, 66, 2, 22, '#52392b');
  img.rect(18, 86, 12, 2, '#2a1e19');
  // Camadas de copa, de baixo para cima.
  const tiers = [
    [74, 22, 22], [62, 20, 22], [50, 17, 21], [38, 14, 20], [27, 11, 18], [17, 7, 16],
  ];
  for (const [bottom, half, tall] of tiers) {
    for (let row = 0; row < tall; row += 1) {
      const y = bottom - tall + row + 1;
      const spread = Math.round((half * (row + 1)) / tall + (random() * 3 - 1.5));
      for (let x = 24 - spread; x < 24 + spread; x += 1) {
        const lit = x < 24 - spread * 0.35;
        const shade = row > tall - 4;
        const colors = shade ? ['#132b27', '#17332d'] : lit ? ['#2f5a48', '#376552', '#2a5042'] : ['#1d3d34', '#224539', '#1a372f'];
        img.set(x, y, pick(random, colors));
      }
      if (row === tall - 1) {
        for (let x = 24 - spread; x < 24 + spread; x += 3) img.set(x, y + 1, '#132b27');
      }
    }
  }
  img.outline('#07120f');
  return img;
}

function deadTree() {
  const img = new Bitmap(40, 72);
  const bark = '#5b5046';
  img.line(20, 71, 19, 40, 8, bark);
  img.line(19, 40, 22, 12, 5, bark);
  img.line(22, 12, 20, 2, 2, bark);
  img.line(19, 46, 6, 30, 4, bark);
  img.line(6, 30, 3, 18, 2, bark);
  img.line(10, 35, 2, 33, 2, bark);
  img.line(20, 36, 33, 22, 4, bark);
  img.line(33, 22, 37, 8, 2, bark);
  img.line(29, 26, 38, 26, 1, bark);
  img.line(21, 22, 13, 10, 3, bark);
  img.line(13, 10, 14, 4, 1, bark);
  img.line(21, 18, 29, 7, 2, bark);
  img.line(18, 66, 11, 71, 3, bark);
  img.line(22, 66, 29, 71, 3, bark);
  const random = createRandom(23);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (!img.filled(x, y)) continue;
      if (!img.filled(x - 1, y)) img.set(x, y, '#8a7c6c');
      else if (random() < 0.18) img.set(x, y, pick(random, ['#3f372f', '#6d6054']));
    }
  }
  img.rect(18, 52, 3, 5, '#16110e'); // oco do tronco
  img.outline('#15100d');
  return img;
}

function ghost() {
  const img = new Bitmap(28, 40);
  const random = createRandom(31);
  for (let y = 2; y < 39; y += 1) {
    let half;
    if (y < 14) half = Math.sqrt(Math.max(0, 1 - ((y - 10) / 8.5) ** 2)) * 7;
    else half = 6 + (y - 14) * 0.24 + Math.sin(y * 0.7) * 0.8;
    const alpha = y < 26 ? 225 : Math.max(60, 225 - (y - 25) * 13);
    for (let x = Math.round(14 - half); x < Math.round(14 + half); x += 1) {
      // Barra inferior esfarrapada.
      if (y > 32 && (x % 5 === 0 || (x % 5 === 1 && y > 35))) continue;
      const colors = x < 11 ? ['#c9e4e6', '#bddbe0'] : x > 17 ? ['#6f93a6', '#7a9fb0'] : ['#98bcc6', '#a2c5cd'];
      img.set(x, y, pick(random, colors), alpha);
    }
  }
  // Braços caídos.
  for (let i = 0; i < 12; i += 1) {
    img.rect(6 - Math.floor(i / 3), 17 + i, 2, 1, '#a2c5cd');
    img.rect(20 + Math.floor(i / 3), 17 + i, 2, 1, '#7a9fb0');
  }
  img.outline('#3d5a70', 170);
  // Olhos e boca vazios.
  img.rect(10, 8, 3, 4, '#060a12');
  img.rect(16, 8, 3, 4, '#060a12');
  img.set(11, 10, '#e04050');
  img.set(17, 10, '#e04050');
  img.rect(13, 14, 3, 5, '#0a101c');
  return img;
}

function cross() {
  const img = new Bitmap(16, 24);
  img.rect(6, 1, 4, 22, '#c89b45');
  img.rect(2, 6, 12, 4, '#c89b45');
  img.rect(6, 1, 1, 22, '#f3d98a');
  img.rect(2, 6, 12, 1, '#f3d98a');
  img.rect(9, 10, 1, 13, '#8a6428');
  img.rect(2, 9, 12, 1, '#8a6428');
  img.rect(7, 7, 2, 2, '#a3262f');
  img.outline('#2b1c0a');
  return img;
}

function bush() {
  const img = new Bitmap(20, 14);
  const random = createRandom(41);
  const blades = [[1, 6], [3, 3], [5, 7], [7, 1], [9, 5], [10, 2], [12, 6], [14, 2], [16, 5], [18, 7]];
  for (const [tip, top] of blades) {
    img.line(tip, top, 8 + (tip % 5), 13, 2, pick(random, ['#2f5a3c', '#3d6e48', '#254a34']));
  }
  img.rect(5, 11, 10, 3, '#1e3a2b');
  for (const [tip, top] of blades) img.set(tip, top, '#6f9a68');
  return img;
}

function rock() {
  const img = new Bitmap(20, 12);
  const random = createRandom(53);
  const rows = [[7, 12], [5, 14], [4, 16], [3, 17], [2, 17], [2, 18], [1, 18], [1, 19], [1, 19], [2, 18]];
  rows.forEach(([from, to], index) => {
    const y = index + 2;
    for (let x = from; x < to; x += 1) {
      const light = x + y * 1.6 < 17;
      const dark = y > 8 || x + y > 22;
      const colors = light ? ['#8b93a0', '#7f8794'] : dark ? ['#3a404c', '#424955'] : ['#5b6370', '#646c79'];
      img.set(x, y, pick(random, colors));
    }
  });
  img.line(11, 3, 9, 8, 1, '#2c313b');
  img.rect(3, 7, 3, 1, '#3f6246');
  img.outline('#12151c');
  return img;
}

function ground() {
  const img = new Bitmap(64, 64);
  const random = createRandom(67);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      img.set(x, y, pick(random, ['#27342a', '#2b392d', '#233026', '#2b392d', '#313b2c']));
    }
  }
  // Folhas, gravetos e pedrinhas; as coordenadas "dão a volta" para repetir sem emendas.
  for (let i = 0; i < 150; i += 1) {
    const x = Math.floor(random() * 64);
    const y = Math.floor(random() * 64);
    const color = pick(random, ['#4a3a2a', '#3d5236', '#5a4a31', '#1a241d', '#565c52']);
    const length = 1 + Math.floor(random() * 3);
    for (let k = 0; k < length; k += 1) img.set((x + k) % 64, (y + (k >> 1)) % 64, color);
  }
  return img;
}

/** Letras 5x7 do título. */
const GLYPHS = {
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
};

function title() {
  const lines = ['FOREST', 'EXORCIST'];
  const advance = 6;
  const width = lines[1].length * advance + 3;
  const img = new Bitmap(width, 22);
  lines.forEach((text, line) => {
    const left = Math.floor((width - (text.length * advance - 1)) / 2);
    [...text].forEach((letter, index) => {
      GLYPHS[letter].forEach((row, y) => {
        [...row].forEach((bit, x) => {
          if (bit !== '1') return;
          const color = line === 0 ? (y < 4 ? '#e8e4cf' : '#b9b8a8') : y < 4 ? '#d8454f' : '#8e1f2b';
          img.set(left + index * advance + x, 2 + line * 10 + y, color);
        });
      });
    });
  });
  img.outline('#05060a');
  return img;
}

/** Pinheiro alto e estreito, com galhos em camadas. */
function tallTree() {
  const img = new Bitmap(48, 120);
  const random = createRandom(71);
  img.rect(22, 84, 5, 36, '#33261f');
  img.rect(22, 84, 2, 36, '#4a362a');
  img.rect(19, 118, 11, 2, '#241a16');
  for (let tier = 0; tier < 10; tier += 1) {
    const bottom = 96 - tier * 9;
    const half = 19 - tier * 1.6;
    for (let row = 0; row < 14; row += 1) {
      const y = bottom - 13 + row;
      const spread = Math.max(0, Math.round((half * (row + 1)) / 14 + (random() * 4 - 2)));
      for (let x = 24 - spread; x < 24 + spread; x += 1) {
        if (row > 10 && random() < 0.35) continue; // pontas irregulares
        const lit = x < 24 - spread * 0.3 ? ['#29503f', '#315a47', '#244638'] : ['#18342d', '#1d3b32', '#15302a'];
        img.set(x, y, pick(random, row > 10 ? ['#0f231f', '#132b27'] : lit));
      }
    }
  }
  img.outline('#06100d');
  return img;
}

/** Árvore jovem, de copa redonda e falhada. */
function smallTree() {
  const img = new Bitmap(32, 48);
  const random = createRandom(73);
  img.line(16, 47, 15, 24, 4, '#3d2d23');
  img.line(15, 34, 9, 26, 2, '#3d2d23');
  for (const [cx, cy, r] of [[16, 12, 10], [9, 21, 7], [23, 20, 8], [16, 27, 6]]) {
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) {
        if (x * x + y * y > r * r * (0.75 + random() * 0.35)) continue;
        let colors = ['#22462f', '#274d34', '#1e3f2b'];
        if (x + y < -r * 0.3) colors = ['#35603f', '#3d6a47'];
        else if (y > r * 0.4) colors = ['#142c22', '#183327'];
        img.set(cx + x, cy + y, pick(random, colors));
      }
    }
  }
  img.outline('#08130e');
  return img;
}

/** Árvore seca alta, com galhos retorcidos. */
function tallDeadTree() {
  const img = new Bitmap(44, 96);
  const bark = '#4d453f';
  img.line(22, 95, 24, 62, 7, bark);
  img.line(24, 62, 19, 34, 6, bark);
  img.line(19, 34, 23, 4, 4, bark);
  // img.line desenha de cima para baixo ou de baixo para cima, uma linha por passo.
  const branches = [
    [23, 58, 38, 44, 3], [38, 44, 41, 30, 2], [33, 48, 43, 50, 1], [21, 44, 7, 32, 3],
    [7, 32, 2, 16, 2], [11, 35, 3, 40, 1], [20, 30, 33, 14, 2], [33, 14, 32, 4, 1],
    [21, 18, 10, 6, 2], [20, 90, 13, 95, 3], [24, 90, 31, 95, 3],
  ];
  for (const [x0, y0, x1, y1, width] of branches) img.line(x0, y0, x1, y1, width, bark);
  const random = createRandom(79);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (!img.filled(x, y)) continue;
      if (!img.filled(x - 1, y)) img.set(x, y, '#7d7268');
      else if (random() < 0.2) img.set(x, y, pick(random, ['#332d29', '#5e544c']));
    }
  }
  img.outline('#110d0c');
  return img;
}

/** Arbusto cheio e arredondado. */
function roundBush() {
  const img = new Bitmap(28, 20);
  const random = createRandom(83);
  for (const [cx, cy, r] of [[8, 13, 7], [19, 12, 8], [14, 9, 8]]) {
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) {
        if (x * x + y * y > r * r * (0.7 + random() * 0.4) || cy + y > 19) continue;
        let colors = ['#244832', '#294f37'];
        if (x + y < -r * 0.4) colors = ['#3a6244', '#436d4c'];
        else if (y > 2) colors = ['#152d22', '#1a3528'];
        img.set(cx + x, cy + y, pick(random, colors));
      }
    }
  }
  img.outline('#0a1610');
  return img;
}

/** Folhas finas saindo de um ponto na base (samambaia, grama). */
function blades(width, height, seed, count, thickness, colors, tipColor) {
  const img = new Bitmap(width, height);
  const random = createRandom(seed);
  for (let i = 0; i < count; i += 1) {
    const tipX = 1 + Math.floor(random() * (width - 2));
    const tipY = Math.floor(random() * height * 0.6);
    const baseX = width / 2 + (tipX - width / 2) * 0.35;
    img.line(tipX, tipY, baseX, height - 1, thickness, pick(random, colors));
    if (tipColor && random() < 0.4) img.set(tipX, tipY, tipColor);
  }
  return img;
}

const fern = () => blades(22, 15, 89, 11, 2, ['#2c5738', '#356642', '#234a30'], '#5f8f55');
const grassTall = () => blades(18, 10, 97, 13, 1, ['#3b5c3c', '#4a6d45', '#2d4a32'], '#7d9463');
const grassShort = () => blades(18, 7, 101, 14, 1, ['#46583a', '#576a42', '#34452f'], '#8a8f60');

/** Planta rasteira com pequenas flores pálidas. */
function plant() {
  const img = blades(13, 11, 103, 7, 1, ['#2f5237', '#3c6343'], null);
  for (const [x, y] of [[3, 2], [8, 1], [10, 5]]) {
    img.rect(x, y, 2, 1, '#b9b6d6');
    img.set(x, y + 1, '#6d6a92');
  }
  return img;
}

/** Pedra grande com musgo. */
function boulder() {
  const img = new Bitmap(30, 24);
  const random = createRandom(107);
  for (let y = 1; y < 24; y += 1) {
    const t = (y - 1) / 22;
    const half = Math.round(13 * Math.sqrt(Math.min(1, 0.18 + t * 1.3)) + (random() * 2 - 1));
    for (let x = 15 - half; x < 15 + half; x += 1) {
      let colors = ['#535c69', '#5c6572'];
      if (y < 9 + Math.sin(x * 0.9) * 3 && random() < 0.7) colors = ['#355240', '#3f6048'];
      else if (x + y * 1.4 < 24) colors = ['#7c8591', '#737c89'];
      else if (y > 18 || x + y > 35) colors = ['#333945', '#3b424f'];
      img.set(x, y, pick(random, colors));
    }
  }
  img.line(18, 6, 14, 16, 1, '#262b35');
  img.outline('#10131a');
  return img;
}

/** Tronco caído: corte com anéis no quadrado da esquerda, casca no restante. */
function log() {
  const img = new Bitmap(80, 16);
  const random = createRandom(109);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 80; x += 1) {
      if (x < 16) {
        const ring = Math.hypot(x - 7.5, y - 7.5);
        const wood = Math.floor(ring) % 2 ? '#5f4935' : '#8a6c4c';
        img.set(x, y, ring > 6.4 ? '#2b201a' : wood);
      } else {
        const groove = (y + Math.floor(x / 11)) % 4 === 0;
        // Musgo em manchas irregulares na parte de cima da casca.
        const moss = y < 6 && Math.sin(x * 0.23) + Math.sin(x * 0.61 + y) > 0.9 && random() < 0.45;
        const bark = groove ? ['#241a14', '#2c2119'] : ['#4a382a', '#554031', '#40302a'];
        img.set(x, y, moss ? '#3d5a3a' : pick(random, bark));
      }
    }
  }
  return img;
}

/** Silhuetas brancas de árvores (a cor é aplicada no jogo); repete sem emendas. */
function backdrop() {
  const img = new Bitmap(256, 64);
  const random = createRandom(113);
  const dot = (x, y) => img.set(((x % 256) + 256) % 256, y, '#ffffff');
  for (let x = 0; x < 256; x += 3 + Math.floor(random() * 6)) {
    const height = 24 + Math.floor(random() * 39);
    const half = 3 + Math.floor(random() * 6);
    const dead = random() < 0.12;
    for (let row = 0; row < height; row += 1) {
      const branch = row % 7 === 3 ? Math.floor(random() * half) : 0;
      const needles = Math.round(((half * row) / height) * (row % 6 < 3 ? 0.65 : 1.15));
      const spread = dead ? branch : needles;
      for (let dx = -spread; dx <= spread; dx += 1) dot(x + dx, 64 - height + row);
    }
  }
  // Base fechada: mato junto ao chão.
  for (let x = 0; x < 256; x += 1) {
    const top = 54 + Math.round(Math.sin(x * 0.19) * 3 + random() * 3);
    for (let y = top; y < 64; y += 1) dot(x, y);
  }
  return img;
}

/** Sombra redonda, com a borda pontilhada. */
function shadow() {
  const img = new Bitmap(32, 32);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const distance = Math.hypot(x - 15.5, y - 15.5) / 16;
      if (distance >= 1 || (distance > 0.65 && (x + y) % 2 === 0)) continue;
      img.set(x, y, '#000000', Math.round(190 * (1 - distance * distance * 0.6)));
    }
  }
  return img;
}

/** Terra batida da trilha, sem emendas. */
function pathTexture() {
  const img = new Bitmap(32, 32);
  const random = createRandom(127);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      img.set(x, y, pick(random, ['#6b5440', '#735b45', '#634e3c', '#6f5844', '#7a624a']));
    }
  }
  for (let i = 0; i < 34; i += 1) {
    const x = Math.floor(random() * 32);
    const y = Math.floor(random() * 32);
    const color = pick(random, ['#8d806c', '#4b3a2d', '#97897a', '#57462f']);
    img.set(x, y, color);
    if (random() < 0.5) img.set((x + 1) % 32, y, color);
  }
  return img;
}

/** Cruz latina de latão, empunhada pela mão direita (visão do jogador). */
function heldCross() {
  const img = new Bitmap(28, 48);
  // Haste e braços.
  img.rect(11, 1, 6, 38, '#b8893a');
  img.rect(3, 9, 22, 6, '#b8893a');
  img.rect(11, 1, 2, 38, '#e8c878');
  img.rect(3, 9, 22, 2, '#e8c878');
  img.rect(15, 15, 2, 24, '#7c5a24');
  img.rect(3, 13, 8, 2, '#7c5a24');
  img.rect(17, 13, 8, 2, '#7c5a24');
  img.rect(13, 11, 2, 2, '#a3262f');
  // Punho fechado em volta da base.
  img.rect(8, 29, 13, 11, '#b07a5c');
  img.rect(8, 29, 13, 2, '#c99273');
  for (const y of [32, 35, 38]) img.rect(8, y, 9, 1, '#7a4f3c');
  img.rect(17, 27, 4, 6, '#c08a6a');
  img.rect(20, 31, 2, 9, '#8d5f49');
  // Punho da manga escura.
  img.rect(9, 40, 15, 3, '#3a3350');
  img.rect(10, 43, 16, 5, '#241f33');
  img.rect(10, 40, 3, 3, '#4d4468');
  img.outline('#140d08');
  return img;
}

/** Tábuas verticais envelhecidas, com frestas, nós e manchas; sem emendas. */
function planks() {
  const img = new Bitmap(64, 64);
  const random = createRandom(131);
  const tones = [['#5a4331', '#634a37', '#52402f'], ['#4c3a2b', '#554131', '#463628'], ['#66503c', '#5c4735', '#6e5741']];
  for (let board = 0; board < 8; board += 1) {
    const colors = tones[Math.floor(random() * tones.length)];
    const joint = Math.floor(random() * 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = board * 8; x < board * 8 + 8; x += 1) {
        const edge = x === board * 8;
        img.set(x, y, edge ? '#1d140e' : pick(random, colors));
      }
      if (y === joint) for (let x = board * 8 + 1; x < board * 8 + 8; x += 1) img.set(x, y, '#261b12');
    }
    img.set(board * 8 + 2, (joint + 3) % 64, '#b08c5e');
    img.set(board * 8 + 5, (joint + 61) % 64, '#a58256');
  }
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(random() * 64);
    const y = Math.floor(random() * 64);
    const length = 3 + Math.floor(random() * 9);
    const color = pick(random, ['#2f231a', '#34402a', '#7a6650']);
    for (let k = 0; k < length; k += 1) img.set(x, (y + k) % 64, color);
  }
  return img;
}

/** Assoalho escuro, tábuas na horizontal. */
function floorBoards() {
  const img = new Bitmap(64, 64);
  const random = createRandom(137);
  for (let y = 0; y < 64; y += 1) {
    const board = Math.floor(y / 8);
    for (let x = 0; x < 64; x += 1) {
      const gap = y % 8 === 0 || (x + board * 23) % 48 === 0;
      img.set(x, y, gap ? '#17100b' : pick(random, ['#3f2f22', '#453425', '#38291d', '#41301f']));
    }
  }
  for (let i = 0; i < 90; i += 1) {
    img.set(Math.floor(random() * 64), Math.floor(random() * 64), pick(random, ['#6b5a45', '#241a12', '#4d5138']));
  }
  return img;
}

/** Telhas de madeira sobrepostas, com musgo. */
function shingles() {
  const img = new Bitmap(64, 64);
  const random = createRandom(139);
  for (let y = 0; y < 64; y += 1) {
    const row = Math.floor(y / 8);
    for (let x = 0; x < 64; x += 1) {
      const seam = (x + row * 4) % 8 === 0;
      let colors = ['#33313a', '#3a3640', '#2e2c33'];
      if (y % 8 >= 6 || seam) colors = ['#17161b', '#1c1a20'];
      else if (random() < 0.07) colors = ['#34492f', '#3c5335'];
      img.set(x, y, pick(random, colors));
    }
  }
  return img;
}

/** Lombadas de livros em fileira. */
function bookSpines() {
  const img = new Bitmap(64, 64);
  const random = createRandom(149);
  let x = 0;
  while (x < 64) {
    const width = 3 + Math.floor(random() * 4);
    const color = pick(random, ['#6e2f2a', '#2f4a45', '#7a6337', '#3a3556', '#5a4a3a', '#8a7a5c']);
    for (let i = x; i < Math.min(64, x + width); i += 1) {
      for (let y = 0; y < 64; y += 1) {
        const band = y % 16 === 3 || y % 16 === 12;
        img.set(i, y, i === x ? '#160f0c' : band ? '#b59a5e' : color);
      }
    }
    x += width;
  }
  return img;
}

/** Folha amarelada com linhas de texto ilegível. */
function paperSheet() {
  const img = new Bitmap(32, 32);
  const random = createRandom(151);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) img.set(x, y, pick(random, ['#c9bd98', '#c2b58f', '#d1c6a4']));
  }
  for (let y = 4; y < 30; y += 4) {
    for (let x = 3; x < 29; x += 1) if (random() < 0.72) img.set(x, y, '#4a3c2c');
  }
  img.rect(21, 22, 6, 5, '#8a3a30');
  return img;
}

/** Retrato desbotado de três pessoas com os rostos riscados. */
function portraitPicture() {
  const img = new Bitmap(32, 32);
  const random = createRandom(157);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) img.set(x, y, pick(random, ['#7c7058', '#857860', '#746950']));
  }
  for (const [x, top, height] of [[6, 10, 22], [14, 6, 26], [23, 14, 18]]) {
    img.rect(x - 1, top + 6, 6, height - 6, '#2c2519');
    img.rect(x, top, 4, 6, '#b7a584');
    img.line(x - 1, top, x + 5, top + 6, 1, '#120c08');
    img.line(x + 4, top, x - 1, top + 5, 1, '#120c08');
  }
  img.rect(0, 0, 32, 2, '#3b2c1a');
  img.rect(0, 30, 32, 2, '#3b2c1a');
  return img;
}

/** Observadora: figura alta, encapuzada, de olhos pálidos. */
function watcher() {
  const img = new Bitmap(30, 56);
  const random = createRandom(163);
  for (let y = 3; y < 55; y += 1) {
    let half;
    if (y < 16) half = Math.round(6 * Math.sqrt(Math.max(0, 1 - ((y - 12) / 9) ** 2)));
    else half = Math.round(5 + (y - 16) * 0.19 + Math.sin(y * 0.5));
    const alpha = y < 40 ? 238 : Math.max(70, 238 - (y - 39) * 11);
    for (let x = 15 - half; x < 15 + half; x += 1) {
      if (y > 47 && (x % 4 === 0 || (x % 4 === 1 && y > 51))) continue;
      const colors = x < 12 ? ['#4a5470', '#535e7c'] : x > 18 ? ['#232a40', '#293148'] : ['#343c58', '#3a4360'];
      img.set(x, y, pick(random, colors), alpha);
    }
  }
  // Mangas longas e mãos finas.
  for (let i = 0; i < 22; i += 1) {
    img.rect(8 - Math.floor(i / 6), 20 + i, 2, 1, '#535e7c');
    img.rect(20 + Math.floor(i / 6), 20 + i, 2, 1, '#293148');
  }
  for (const x of [4, 6, 23, 25]) img.rect(x, 42, 1, 5, '#b9c2d6');
  img.outline('#8d9ac0', 140);
  // Interior do capuz e olhos.
  img.rect(11, 7, 8, 10, '#05070e');
  img.rect(12, 10, 2, 2, '#e9f4ff');
  img.rect(16, 10, 2, 2, '#e9f4ff');
  return img;
}

/** Instável: mancha fragmentada, de núcleo claro e pedaços soltos. */
function wisp() {
  const img = new Bitmap(26, 34);
  const random = createRandom(167);
  for (let y = 2; y < 32; y += 1) {
    const wave = Math.round(Math.sin(y * 0.65) * 3);
    const half = Math.max(1, Math.round(8 * Math.sin((Math.PI * (y - 1)) / 33) + random() * 2 - 1));
    if (y % 7 === 5) continue; // cortes horizontais
    for (let x = 13 + wave - half; x < 13 + wave + half; x += 1) {
      const core = Math.abs(x - 13 - wave) < half * 0.45;
      const colors = core ? ['#d9c8ff', '#e6dbff', '#bfe8e0'] : ['#7a52c0', '#6a45ad', '#3f8f8a'];
      if (!core && random() < 0.18) continue;
      img.set(x, y, pick(random, colors), core ? 235 : 190);
    }
  }
  for (let i = 0; i < 22; i += 1) {
    img.set(Math.floor(random() * 26), Math.floor(random() * 34), pick(random, ['#9d7ae0', '#6fd0c4']), 200);
  }
  img.rect(9, 11, 3, 2, '#12071f');
  img.rect(15, 13, 2, 3, '#12071f');
  img.rect(11, 18, 5, 1, '#12071f');
  return img;
}

const ASSETS = {
  'assets/textures/cabin/planks.png': planks,
  'assets/textures/cabin/floor.png': floorBoards,
  'assets/textures/cabin/roof.png': shingles,
  'assets/textures/cabin/books.png': bookSpines,
  'assets/textures/cabin/paper.png': paperSheet,
  'assets/textures/cabin/portrait.png': portraitPicture,
  'assets/sprites/entities/watcher_01.png': watcher,
  'assets/sprites/entities/wisp_01.png': wisp,
  'assets/sprites/items/held_cross.png': heldCross,
  'assets/sprites/environment/tree_02.png': tallTree,
  'assets/sprites/environment/tree_small_01.png': smallTree,
  'assets/sprites/environment/dead_tree_02.png': tallDeadTree,
  'assets/sprites/environment/bush_02.png': roundBush,
  'assets/sprites/environment/fern_01.png': fern,
  'assets/sprites/environment/plant_01.png': plant,
  'assets/sprites/environment/grass_01.png': grassTall,
  'assets/sprites/environment/grass_02.png': grassShort,
  'assets/sprites/environment/rock_02.png': boulder,
  'assets/sprites/environment/log_01.png': log,
  'assets/sprites/environment/backdrop_01.png': backdrop,
  'assets/sprites/environment/shadow_01.png': shadow,
  'assets/textures/path.png': pathTexture,
  'assets/sprites/environment/tree_01.png': tree,
  'assets/sprites/environment/dead_tree_01.png': deadTree,
  'assets/sprites/environment/bush_01.png': bush,
  'assets/sprites/environment/rock_01.png': rock,
  'assets/sprites/entities/ghost_01.png': ghost,
  'assets/sprites/items/cross.png': cross,
  'assets/textures/ground.png': ground,
  'assets/textures/ui/title.png': title,
};

for (const [path, draw] of Object.entries(ASSETS)) {
  const target = join(root, path);
  if (existsSync(target) && !force) {
    console.log(`mantido   ${path}`);
    continue;
  }
  const image = draw();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, encodePng(image.width, image.height, image.data));
  console.log(`gerado    ${path} (${image.width}x${image.height})`);
}
