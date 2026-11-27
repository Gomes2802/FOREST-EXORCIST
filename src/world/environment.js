/**
 * Cenário que envolve a floresta: terreno, trilhas de terra, neblina, céu, lua e
 * silhuetas de árvores no horizonte. Também reúne as funções puras de ruído e de
 * geometria das trilhas, usadas pelo planejamento da vegetação.
 */
import {
  createBackdropMaterial, createSkyDomeMaterial, createSkyMaterial, createSurfaceMaterial,
} from '../graphics/materials.js';

/** Espaçamento (unidades) dos pontos usados para medir distâncias até as trilhas. */
const MEASURE_STEP = 0.5;
const measured = new WeakMap();

/** Gerador pseudoaleatório determinístico (mulberry32). */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruído suave 2D em [0, 1] (valores em uma grade, interpolados). */
export function createValueNoise(seed) {
  const corner = (x, z) => createRandom((Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed) >>> 0)();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = smooth(x - x0);
    const tz = smooth(z - z0);
    const top = corner(x0, z0) + (corner(x0 + 1, z0) - corner(x0, z0)) * tx;
    const bottom = corner(x0, z0 + 1) + (corner(x0 + 1, z0 + 1) - corner(x0, z0 + 1)) * tx;
    return top + (bottom - top) * tz;
  };
}

/**
 * Curva suave (Catmull-Rom) que passa pelos pontos de controle [x, z],
 * amostrada a cada `step` unidades, aproximadamente.
 * @returns {{ x: number, z: number }[]}
 */
export function samplePath(points, step) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  const samples = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const count = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let s = 0; s < count; s += 1) {
      const t = s / count;
      const [x, z] = [0, 1].map((a) => 0.5 * (
        2 * p1[a]
        + (p2[a] - p0[a]) * t
        + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t
        + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t * t * t
      ));
      samples.push({ x, z });
    }
  }
  const [x, z] = points.at(-1);
  samples.push({ x, z });
  return samples;
}

/** Distância do ponto (x, z) até o centro da trilha mais próxima. */
export function distanceToPaths(x, z, paths) {
  if (!measured.has(paths)) {
    measured.set(paths, paths.map((path) => samplePath(path.points, MEASURE_STEP)));
  }
  let best = Infinity;
  for (const samples of measured.get(paths)) {
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1];
      const dx = samples[i].x - a.x;
      const dz = samples[i].z - a.z;
      const length2 = dx * dx + dz * dz;
      const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
      const ex = x - a.x - dx * t;
      const ez = z - a.z - dz * t;
      best = Math.min(best, ex * ex + ez * ez);
    }
  }
  return Math.sqrt(best);
}

/** Neblina progressiva e cor do fundo. */
export function applyAtmosphere(BABYLON, scene, settings) {
  const sky = BABYLON.Color3.FromHexString(settings.sky.zenithColor);
  scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
  // EXP2: quase nada perto do jogador e cada vez mais densa com a distância.
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor = BABYLON.Color3.FromHexString(settings.fog.color);
  scene.fogDensity = settings.fog.density;
}

/**
 * Cria o terreno, as trilhas e o horizonte.
 * @param {{ config: object, pixelRenderer: object, images: { ground: any, path: any },
 *   backdrop: object, trees: number[][], parent: object }} options
 *   backdrop é o registro do sprite de silhuetas; trees são as posições que
 *   escurecem o chão; lights (opcional) recebe a luz da noite já calculada.
 */
export function createEnvironment(BABYLON, scene, {
  config, pixelRenderer, images, backdrop, trees, parent, lights,
}) {
  const { forest, environment } = config;
  const tone = createGroundTone(forest.seed, trees);
  const disposables = [];
  const adopt = (mesh) => {
    mesh.parent = parent;
    mesh.isPickable = false;
    disposables.push(mesh.material);
    return mesh;
  };
  // Texturas repetidas precisam ter lados em potência de 2 no WebGL 1.
  const tiled = (image) => pixelRenderer.pixelate(image, { powerOfTwo: true });

  // Chão em regiões: as que ficam fora da vista não são desenhadas.
  const ground = new BABYLON.TransformNode('ground', scene);
  ground.parent = parent;
  const groundMaterial = createSurfaceMaterial(BABYLON, scene, 'ground', tiled(images.ground), {
    pixelRenderer,
    repeat: 1, // As UVs já estão em coordenadas do mundo.
  });
  disposables.push(groundMaterial);
  const groundTiles = createGroundTiles(BABYLON, scene, forest, tone).map((tile) => {
    tile.parent = ground;
    tile.isPickable = false;
    tile.material = groundMaterial;
    return tile;
  });

  const pathCanvas = tiled(images.path);
  const trails = forest.paths.map((path, index) => {
    const mesh = adopt(createTrail(BABYLON, scene, path, index, forest, tone));
    mesh.material = createSurfaceMaterial(BABYLON, scene, mesh.name, pathCanvas, {
      pixelRenderer,
      repeat: 1, // As UVs já estão em coordenadas do mundo.
      // Evita disputa de profundidade com o chão; a trilha principal fica por cima.
      zOffset: index === 0 ? -3 : -2,
    });
    disposables.push(mesh.material);
    return mesh;
  });

  // Céu, lua e silhuetas ficam no grupo 0, desenhado antes (atrás) de tudo.
  const sky = adopt(createSkyDome(BABYLON, scene, environment));
  const moon = adopt(createMoon(BABYLON, scene, environment.moon));
  const backdropCanvas = pixelRenderer.pixelate(backdrop.canvas, {
    powerOfTwo: true, pixelHeight: backdrop.textureHeight, maxTextureSize: 2048,
  });
  const backdrops = environment.backdrop.layers.map((layer, index) => adopt(
    createBackdrop(BABYLON, scene, layer, index, backdrop, backdropCanvas, pixelRenderer),
  ));

  for (const mesh of [...groundTiles, ...trails]) {
    mesh.renderingGroupId = 1;
    mesh.freezeWorldMatrix();
    // Superfícies planas: luar e luz ambiente entram como cor fixa (mesmo resultado).
    lights?.bakeNight(mesh);
  }

  return {
    /** Nó com as regiões do chão (setEnabled liga e desliga todas). */
    ground,
    groundTiles,
    trails,
    sky,
    moon,
    backdrops,
    disposables,
    /** O horizonte acompanha o observador, como se estivesse infinitamente longe. */
    follow(position) {
      for (const mesh of [sky, ...backdrops]) {
        mesh.position.x = position.x;
        mesh.position.z = position.z;
      }
      const [x, y, z] = environment.moon.offset;
      moon.position.set(position.x + x, y, position.z + z);
    },
  };
}

/**
 * Cor (multiplicador) de um ponto do chão: manchas suaves, variação entre
 * esverdeado e acastanhado e sombra ao redor das árvores.
 */
function createGroundTone(seed, trees) {
  const broad = createValueNoise(seed + 1);
  const fine = createValueNoise(seed + 2);
  const hue = createValueNoise(seed + 3);
  const CELL = 3;
  const grid = new Map();
  for (const [x, z] of trees) {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([x, z]);
  }
  const shadow = (x, z) => {
    let strength = 0;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        for (const [tx, tz] of grid.get(`${cx + i},${cz + j}`) ?? []) {
          strength = Math.max(strength, 1 - Math.hypot(x - tx, z - tz) / CELL);
        }
      }
    }
    return strength;
  };
  return (x, z, base = 1) => {
    const value = base * (0.62 + broad(x * 0.13, z * 0.13) * 0.55 + fine(x * 0.55, z * 0.55) * 0.25)
      * (1 - shadow(x, z) * 0.35);
    const warm = (hue(x * 0.08, z * 0.08) - 0.5) * 0.3;
    return [value * (1 + warm), value, value * (1 - warm * 0.6), 1];
  };
}

/**
 * Chão em groundTiles x groundTiles regiões. Malha subdividida de propósito: com
 * triângulos gigantes, a renderização por software do Chrome desenha o chão
 * chapado e por cima dos sprites. Os vértices também guardam a variação de tom,
 * e as UVs seguem as coordenadas do mundo (sem emendas entre regiões).
 */
function createGroundTiles(BABYLON, scene, settings, tone) {
  const tiles = settings.groundTiles;
  const size = settings.groundSize / tiles;
  const subdivisions = Math.max(1, Math.round(settings.groundSubdivisions / tiles));
  const meshes = [];
  for (let i = 0; i < tiles; i += 1) {
    for (let j = 0; j < tiles; j += 1) {
      const mesh = BABYLON.MeshBuilder.CreateGround(`ground:${i},${j}`, { width: size, height: size, subdivisions }, scene);
      const cx = -settings.groundSize / 2 + (i + 0.5) * size;
      const cz = -settings.groundSize / 2 + (j + 0.5) * size;
      mesh.bakeTransformIntoVertices(BABYLON.Matrix.Translation(cx, 0, cz));
      const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const colors = [];
      const uvs = [];
      for (let k = 0; k < positions.length; k += 3) {
        colors.push(...tone(positions[k], positions[k + 2]));
        uvs.push(positions[k] / settings.groundTileSize, positions[k + 2] / settings.groundTileSize);
      }
      mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
      mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs);
      meshes.push(mesh);
    }
  }
  return meshes;
}

/** Faixa de terra com bordas irregulares, acompanhando a curva da trilha. */
function createTrail(BABYLON, scene, path, index, settings, tone) {
  const noise = createValueNoise(settings.seed + 10 + index);
  const random = createRandom(settings.seed + 20 + index);
  const samples = samplePath(path.points, 0.6);
  /** Posições laterais, em fração da meia largura. */
  const columns = [-1, -0.65, 0, 0.65, 1];
  // O brilho depende da distância ao centro de qualquer trilha (bordas escuras e
  // gastas): onde duas se sobrepõem, as cores coincidem e não há emenda.
  const brightness = (x, z) => {
    const edge = Math.min(1, distanceToPaths(x, z, settings.paths) / path.halfWidth);
    return 1.18 - edge * edge * 0.55;
  };
  const positions = [];
  const colors = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  const height = index === 0 ? 0.014 : 0.01;

  samples.forEach((point, i) => {
    const before = samples[Math.max(0, i - 1)];
    const after = samples[Math.min(samples.length - 1, i + 1)];
    const length = Math.hypot(after.x - before.x, after.z - before.z) || 1;
    const nx = -(after.z - before.z) / length;
    const nz = (after.x - before.x) / length;
    const widths = [0, 1].map((side) => path.halfWidth
      * (0.75 + noise(i * 0.19, side * 7) * 0.5) + (random() - 0.5) * 0.3);
    for (const offset of columns) {
      const width = widths[offset < 0 ? 0 : 1];
      const x = point.x + nx * offset * width;
      const z = point.z + nz * offset * width;
      positions.push(x, height, z);
      normals.push(0, 1, 0);
      uvs.push(x / settings.pathTileSize, z / settings.pathTileSize);
      colors.push(...tone(x, z, brightness(x, z)));
    }
    if (i === 0) return;
    const row = i * columns.length;
    for (let c = 0; c < columns.length - 1; c += 1) {
      const a = row - columns.length + c;
      const b = row + c;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });

  const mesh = new BABYLON.Mesh(`trail:${index}`, scene);
  const data = new BABYLON.VertexData();
  Object.assign(data, { positions, indices, normals, uvs, colors });
  data.applyToMesh(mesh);
  return mesh;
}

/** Esfera com degradê: cor da neblina no horizonte, escura no alto. */
function createSkyDome(BABYLON, scene, settings) {
  const { sky, fog } = settings;
  // Só a parte de cima (e uma faixa abaixo do horizonte): o resto fica sempre
  // atrás do chão e só custaria pixels.
  const mesh = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: sky.radius * 2, segments: 24, slice: sky.slice }, scene);
  const horizon = BABYLON.Color3.FromHexString(fog.color);
  const zenith = BABYLON.Color3.FromHexString(sky.zenithColor);
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const colors = [];
  for (let i = 0; i < positions.length; i += 3) {
    const t = Math.max(0, Math.min(1, (positions[i + 1] / sky.radius - sky.horizon) / sky.fade));
    const color = BABYLON.Color3.Lerp(horizon, zenith, t * t * (3 - 2 * t));
    colors.push(color.r, color.g, color.b, 1);
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
  mesh.material = createSkyDomeMaterial(BABYLON, scene, 'sky');
  return mesh;
}

/** Cilindro em volta do observador com silhuetas de árvores. */
function createBackdrop(BABYLON, scene, layer, index, record, canvas, pixelRenderer) {
  const mesh = BABYLON.MeshBuilder.CreateCylinder(`backdrop:${index}`, {
    diameter: layer.radius * 2,
    height: layer.height,
    tessellation: 48,
    cap: BABYLON.Mesh.NO_CAP,
  }, scene);
  // A base fica um pouco abaixo do chão, para não deixar fresta no horizonte.
  mesh.position.y = layer.height / 2 - 1;
  const repeat = Math.max(1, Math.round((Math.PI * 2 * layer.radius) / (layer.height * record.aspect)));
  mesh.material = createBackdropMaterial(BABYLON, scene, mesh.name, canvas, {
    pixelRenderer, color: layer.color, repeat, offset: layer.offset,
  });
  return mesh;
}

function createMoon(BABYLON, scene, settings) {
  const moon = BABYLON.MeshBuilder.CreateDisc('moon', { radius: settings.radius, tessellation: 20 }, scene);
  moon.position.fromArray(settings.offset);
  moon.billboardMode = BABYLON.TransformNode.BILLBOARDMODE_ALL;
  moon.material = createSkyMaterial(BABYLON, scene, 'moon', settings.color);
  return moon;
}
