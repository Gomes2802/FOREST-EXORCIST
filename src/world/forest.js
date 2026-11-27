/**
 * Floresta: planejamento da vegetação e montagem dos objetos na cena.
 *
 * - Árvores, arbustos, plantas e pedras: sprites de frente para a câmera, todos
 *   em uma malha por material, com as imagens reunidas em um atlas.
 * - Grama e sombras no chão: malhas fixas por região, com menos grama ao longe.
 * - Troncos caídos: malha simples de baixa resolução, texturizada por um sprite.
 *
 * Nada disso usa instâncias: no Chrome sem placa de vídeo (SwiftShader), cada
 * instância custa quase uma chamada de desenho (ver graphics/batches.js).
 *
 * O terreno e o horizonte ficam em environment.js.
 */
import { createColliders, solidCircles } from './colliders.js';
import { planBuildings } from './buildings/index.js';
import { createEnvironment, createRandom, createValueNoise, distanceToPaths } from './environment.js';
import { createLogMaterial, createShadowMaterial, createSpriteMaterial } from '../graphics/materials.js';
import { buildAtlas, createBillboardBatch, createChunkedBatch } from '../graphics/batches.js';

export { createRandom };

const ATTEMPTS_PER_ITEM = 30;
const TREE_GROUPS = ['tree', 'tree_small', 'dead_tree'];
const UNKNOWN_SPRITE = Object.freeze({
  worldWidth: 1, worldHeight: 1, definition: Object.freeze({ collisionRadius: 0 }),
});

/**
 * Decide onde fica cada elemento (função pura, sem dependência de 3D).
 * @param {object} settings CONFIG.forest
 * @param {(group: string) => string[]} idsByGroup
 * @param {(id: string) => object} [describe] registro do sprite (tamanho e raio sólido)
 * @returns {{ sprite: string, kind: 'billboard'|'grass'|'log', position: number[],
 *   scale: number, stretch: number, shade: number, yaw: number, solid: boolean,
 *   fixed: boolean }[]}
 */
export function planForest(settings, idsByGroup, describe = () => UNKNOWN_SPRITE) {
  const random = createRandom(settings.seed);
  const clumps = createValueNoise(settings.seed + 100);
  const placements = settings.landmarks.map(({ sprite, position, scale = 1 }) => ({
    sprite, kind: 'billboard', position: [...position], scale,
    stretch: 1, shade: 1, yaw: 0, solid: true, fixed: true,
  }));
  /** Círculos sólidos alcançáveis já ocupados (para manter vãos entre eles). */
  const occupied = solidCircles(placements, describe);

  for (const layer of settings.layers) {
    const ids = idsByGroup(layer.group);
    if (ids.length === 0) continue;

    let placed = 0;
    for (let attempt = 0; placed < layer.count && attempt < layer.count * ATTEMPTS_PER_ITEM; attempt += 1) {
      const angle = random() * Math.PI * 2;
      // Raiz quadrada: densidade uniforme por área dentro do anel.
      const min2 = layer.minRadius ** 2;
      const radius = Math.sqrt(min2 + random() * (layer.maxRadius ** 2 - min2));
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      // Manchas de vegetação: áreas cheias e clareiras, sem padrão regular.
      if (layer.clumping && random() < layer.clumping * (1 - clumps(x * 0.16, z * 0.16) * 1.6)) continue;

      const [low, high] = layer.scale;
      const placement = {
        sprite: ids[Math.floor(random() * ids.length)],
        kind: layer.kind ?? 'billboard',
        position: [x, 0, z],
        scale: low + random() * (high - low),
        stretch: 0.85 + random() * 0.3,
        shade: 0.72 + random() * 0.38,
        yaw: random() * Math.PI,
        solid: radius <= settings.solidLimit,
        fixed: false,
      };
      const circles = solidCircles([{ ...placement, solid: true }], describe);
      if (!fits(placement, circles, layer, settings, describe)) continue;
      if (placement.solid && circles.length > 0) {
        if (circles.some((a) => occupied.some(
          (b) => Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius < settings.minSolidGap,
        ))) continue;
        occupied.push(...circles.map((circle) => ({ ...circle, placement })));
      }
      placements.push(placement);
      placed += 1;
    }
  }
  return placements;
}

/** Respeita as trilhas e o ponto inicial. */
function fits(placement, circles, layer, settings, describe) {
  const { paths, pathHalfWidth, spawnClearing, exclusions = [] } = settings;
  const [x, , z] = placement.position;
  // Nada nasce dentro das construções nem encostado nelas (a imagem atravessaria
  // a parede). A grama pode chegar mais perto.
  const reach = placement.kind === 'grass' ? 0.35
    : (describe(placement.sprite).worldWidth * placement.scale * placement.stretch) / 2;
  const tooClose = (px, pz, radius) => exclusions.some((area) => {
    const dx = Math.max(area.minX - px, 0, px - area.maxX);
    const dz = Math.max(area.minZ - pz, 0, pz - area.maxZ);
    const margin = placement.kind === 'grass' ? Math.min(area.margin, 0.35) : area.margin;
    return Math.hypot(dx, dz) < margin + radius;
  });
  if (tooClose(x, z, reach)) return false;
  if (circles.some((c) => tooClose(c.x, c.z, c.radius))) return false;
  for (const circle of circles) {
    if (distanceToPaths(circle.x, circle.z, paths) - circle.radius < pathHalfWidth) return false;
    if (Math.hypot(circle.x, circle.z) - circle.radius < spawnClearing) return false;
  }
  // Um tronco sólido já foi conferido ao longo de todo o corpo.
  if (placement.kind === 'log' && circles.length > 0) return true;
  // A imagem (copa, folhagem) também não pode cobrir o meio da trilha.
  const halfWidth = (describe(placement.sprite).worldWidth * placement.scale * placement.stretch) / 2;
  const needed = pathHalfWidth * (layer.pathFactor ?? 1) + halfWidth * (layer.canopy ?? 0);
  return distanceToPaths(x, z, paths) >= needed;
}

/** Até onde vale a pena desenhar: além disso a neblina esconde tudo. */
export function visibleDistance(environment, fogDensity) {
  const { fogReach, minDistance, maxDistance } = environment.culling;
  const distance = fogDensity > 0 ? fogReach / fogDensity : maxDistance;
  return Math.max(minDistance, Math.min(maxDistance, distance));
}

/**
 * Distâncias de desenho por categoria: o menor valor entre o que a neblina deixa
 * ver e o limite do nível de qualidade.
 * @param {object} detail nível de qualidade (CONFIG.graphics.presets)
 */
export function drawDistances(environment, fogDensity, detail, indoors = false) {
  const fog = visibleDistance(environment, fogDensity);
  // Dentro de uma construção, a floresta só aparece pelas janelas e pela porta.
  const limit = indoors ? environment.culling.indoor : null;
  const pick = (key) => Math.min(detail[key], limit?.[key] ?? Infinity);
  const far = Math.min(fog, pick('spriteDistance'));
  return {
    far,
    near: Math.min(far, pick('smallDistance')),
    grass: Math.min(far, pick('grassDistance')),
    shadows: Math.min(far, pick('shadowDistance')),
  };
}

/** Fração de grama desenhada a uma distância (cheia perto, rala ao longe). */
export function grassDensity(detail, distance) {
  const { grassNear, grassDistance, grassFarDensity } = detail;
  if (distance <= grassNear) return 1;
  const t = Math.min(1, (distance - grassNear) / Math.max(1e-6, grassDistance - grassNear));
  return 1 - t * (1 - grassFarDensity);
}

/** Número pseudoaleatório estável de uma posição (ordem da grama para o LOD). */
function rankOf(x, z) {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Carrega os recursos e monta a floresta na cena. */
export async function createForest(BABYLON, scene, {
  config, spriteManager, pixelRenderer, lights, detail,
}) {
  const settings = config.forest;
  const { backdrop, shadow } = config.environment;
  const ids = new Set([
    ...settings.landmarks.map((landmark) => landmark.sprite),
    ...settings.layers.flatMap((layer) => spriteManager.idsByGroup(layer.group)),
    backdrop.sprite,
    shadow.sprite,
  ]);

  const [, groundTexture, pathTexture] = await Promise.all([
    spriteManager.loadAll([...ids]),
    spriteManager.loadTexture(config.assets.groundTexture),
    spriteManager.loadTexture(config.assets.pathTexture),
  ]);

  const describe = (id) => spriteManager.get(id);
  const exclusions = planBuildings(config).flatMap((plan) => plan.exclusions);
  const placements = planForest({ ...settings, exclusions }, (group) => spriteManager.idsByGroup(group), describe);
  const ofKind = (kind) => placements.filter((p) => p.kind === kind);
  const trees = placements.filter((p) => TREE_GROUPS.includes(describe(p.sprite).definition.group));

  const root = new BABYLON.TransformNode('forest', scene);
  const environment = createEnvironment(BABYLON, scene, {
    config,
    pixelRenderer,
    images: { ground: groundTexture.image, path: pathTexture.image },
    backdrop: describe(backdrop.sprite),
    trees: trees.map((p) => [p.position[0], p.position[2]]),
    parent: root,
    lights,
  });
  const disposables = [...environment.disposables];
  const adopt = (mesh) => {
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    disposables.push(mesh.material);
    return mesh;
  };
  const { smallHeight } = config.environment.culling;

  // Sprites e grama: um atlas e um material para cada tipo de material.
  const groups = new Map();
  const groupOf = (id) => {
    const record = describe(id);
    const fullBright = record.status === 'fallback' || record.definition.shading === 'glow';
    const key = `${record.definition.alphaMode}:${fullBright ? 'glow' : 'scene'}`;
    if (!groups.has(key)) groups.set(key, { key, fullBright, alphaMode: record.definition.alphaMode, ids: new Set() });
    groups.get(key).ids.add(id);
    return groups.get(key);
  };
  const billboardPlacements = ofKind('billboard');
  const grassPlacements = ofKind('grass');
  for (const p of [...billboardPlacements, ...grassPlacements]) groupOf(p.sprite);

  for (const group of groups.values()) {
    const atlas = buildAtlas(
      [...group.ids].map((id) => ({ id, canvas: describe(id).canvas })),
      (width, height) => pixelRenderer.createCanvas(width, height),
    );
    group.rects = atlas.rects;
    group.material = createSpriteMaterial(BABYLON, scene, {
      id: `atlas:${group.key}`,
      canvas: atlas.canvas,
      status: 'loaded',
      definition: { alphaMode: group.alphaMode, shading: group.fullBright ? 'glow' : 'scene' },
    }, { pixelRenderer, tint: config.lighting.spriteTint, lit: true, doubleSided: true });
    group.atlas = atlas.canvas;
    disposables.push(group.material);
  }

  const billboards = [...groups.values()].map((group) => {
    const items = billboardPlacements.filter((p) => group.ids.has(p.sprite));
    const batch = createBillboardBatch(BABYLON, scene, {
      name: `sprites:${group.key}`,
      material: group.material,
      fov: config.camera.fov,
      sprites: items.map((p) => {
        const record = describe(p.sprite);
        const height = record.worldHeight * p.scale;
        return {
          placement: p,
          sprite: p.sprite,
          x: p.position[0],
          y: p.position[1],
          z: p.position[2],
          width: record.worldWidth * p.scale * p.stretch,
          height,
          shade: p.shade,
          rect: group.rects.get(p.sprite),
          small: height < smallHeight,
        };
      }),
    });
    adopt(batch.mesh);
    if (!group.fullBright) lights.excludeFromNight(batch.mesh);
    return batch;
  });

  // Grama: dois planos cruzados por tufo, agrupados por região.
  const grassGroups = [...groups.values()].filter((g) => grassPlacements.some((p) => g.ids.has(p.sprite)));
  const grass = grassGroups.map((group) => {
    const batch = createChunkedBatch(BABYLON, scene, {
      name: `grass:${group.key}`,
      material: group.material,
      chunkSize: config.environment.culling.grassChunk,
      vertices: 8,
      indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      items: grassPlacements.filter((p) => group.ids.has(p.sprite))
        .map((p) => ({ placement: p, x: p.position[0], z: p.position[2], rank: rankOf(p.position[0], p.position[2]) })),
      write({ placement: p }, out) {
        const record = describe(p.sprite);
        const { u0, u1, v0, v1 } = group.rects.get(p.sprite);
        const half = (record.worldWidth * p.scale * p.stretch) / 2;
        const top = record.worldHeight * p.scale;
        const [x, y, z] = p.position;
        const c = Math.cos(p.yaw);
        const sn = Math.sin(p.yaw);
        // Eixo local X e Z do tufo, girados pelo yaw.
        for (const [ax, az] of [[c, -sn], [sn, c]]) {
          for (const [side, up] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
            out.positions.push(x + ax * half * side, y + top * up, z + az * half * side);
            out.normals.push(0, 1, 0);
            out.uvs.push(side < 0 ? u0 : u1, up ? v1 : v0);
            out.colors.push(p.shade, p.shade, p.shade, 1);
          }
        }
      },
    });
    for (const chunk of batch.chunks) {
      adopt(chunk.mesh);
      lights.excludeFromNight(chunk.mesh);
    }
    return batch;
  });

  const logs = [];
  for (const [id, items] of groupBySprite(ofKind('log'))) {
    const record = describe(id);
    const base = adopt(createLogMesh(BABYLON, scene, record, { pixelRenderer }));
    base.isVisible = false;
    items.forEach((placement, index) => {
      const instance = base.createInstance(`${id}#${index}`);
      const radius = (record.worldHeight * placement.scale) / 2;
      instance.position.set(placement.position[0], radius * 0.85, placement.position[2]);
      instance.rotation.y = placement.yaw;
      instance.scaling.setAll(placement.scale);
      instance.parent = root;
      instance.isPickable = false;
      instance.freezeWorldMatrix();
      logs.push(instance);
    });
  }

  // Sombras: manchas no chão, agrupadas por região.
  const shadowRecord = describe(shadow.sprite);
  const shadowMaterial = createShadowMaterial(BABYLON, scene, shadowRecord, { pixelRenderer });
  disposables.push(shadowMaterial);
  const casters = placements.filter((p) => p.kind === 'billboard' && p.position[1] === 0
    && Math.hypot(p.position[0], p.position[2]) <= settings.solidLimit
    && describe(p.sprite).definition.collisionRadius > 0);
  const shadows = createChunkedBatch(BABYLON, scene, {
    name: 'shadows',
    material: shadowMaterial,
    chunkSize: config.environment.culling.shadowChunk,
    vertices: 4,
    indices: [0, 1, 2, 0, 2, 3],
    items: casters.map((p) => ({ placement: p, x: p.position[0], z: p.position[2], rank: 0 })),
    write({ placement: p }, out) {
      const half = Math.max(1, describe(p.sprite).worldWidth * p.scale * shadow.size) / 2;
      const c = Math.cos(p.yaw) * half;
      const sn = Math.sin(p.yaw) * half;
      for (const [a, b, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
        out.positions.push(p.position[0] + a * c + b * sn, 0.025, p.position[2] - a * sn + b * c);
        out.normals.push(0, 1, 0);
        out.uvs.push(u, v);
      }
    },
  });
  for (const chunk of shadows.chunks) adopt(chunk.mesh);

  const colliders = createColliders(BABYLON, scene, placements, {
    spriteManager,
    height: settings.colliderHeight,
    parent: root,
  });

  /** Obstáculos com a altura visível: podem esconder uma entidade da mira. */
  const occluders = solidCircles(placements, describe).map(({ x, z, radius, placement }) => ({
    x,
    z,
    radius,
    height: Math.min(settings.colliderHeight, describe(placement.sprite).worldHeight * placement.scale),
  }));

  /**
   * Folhagem e objetos altos que atrapalham a visão: a entidade evita surgir
   * atrás deles ou dentro deles.
   */
  const blockers = billboardPlacements
    .filter((p) => Math.hypot(p.position[0], p.position[2]) <= settings.solidLimit)
    .map((p) => {
      const record = describe(p.sprite);
      return {
        x: p.position[0],
        z: p.position[2],
        // Pouco menos que a meia largura: a borda do sprite é transparente.
        radius: record.worldWidth * p.scale * p.stretch * 0.4,
        height: record.worldHeight * p.scale,
      };
    })
    .filter((b) => b.height >= 1.2);

  let current = detail;
  let disposed = false;
  const culled = { x: Infinity, z: Infinity, key: '' };
  const view = { x: 0, z: 0, yaw: 0, pitch: 0 };
  let distances = drawDistances(config.environment, scene.fogDensity, current);

  /**
   * Desliga o desenho do que está escondido pela neblina, longe demais para o
   * nível de qualidade ou fora da vista. Colisões e mira não mudam.
   */
  function cull(position, rotation, indoors) {
    distances = drawDistances(config.environment, scene.fogDensity, current, indoors);
    Object.assign(view, { x: position.x, z: position.z, yaw: rotation?.y ?? 0, pitch: rotation?.x ?? 0 });
    for (const batch of billboards) batch.update(view, distances);

    const key = `${distances.far}|${distances.near}|${distances.grass}|${distances.shadows}`;
    const moved = Math.hypot(position.x - culled.x, position.z - culled.z);
    if (moved < config.environment.culling.step && key === culled.key) return;
    Object.assign(culled, { x: position.x, z: position.z, key });
    for (const log of logs) {
      const visible = Math.hypot(log.position.x - position.x, log.position.z - position.z) <= distances.far;
      if (log.isEnabled(false) !== visible) log.setEnabled(visible);
    }
    for (const batch of grass) batch.update(position, distances.grass, (d) => grassDensity(current, d));
    shadows.update(position, distances.shadows);
  }

  return {
    root,
    ground: environment.ground,
    groundTiles: environment.groundTiles,
    trails: environment.trails,
    sky: environment.sky,
    backdrops: environment.backdrops,
    /** Uma malha de sprites por material (ver graphics/batches.js). */
    billboards,
    /** Atlas de cada material: { key, ids, rects, material, atlas }. */
    atlases: [...groups.values()],
    grass,
    logs,
    shadows,
    colliders,
    occluders,
    blockers,
    placements,
    /** Distâncias de desenho em uso. */
    get distances() {
      return { ...distances };
    },
    get detail() {
      return current;
    },
    /** Troca o nível de qualidade sem recriar a floresta. */
    setDetail(next) {
      current = next;
      culled.key = '';
    },
    /**
     * @param {{ x: number, y: number, z: number }} position câmera
     * @param {{ x: number, y: number }} [rotation] pitch e yaw da câmera
     * @param {boolean} [indoors] jogador dentro de uma construção
     */
    follow(position, rotation, indoors = false) {
      if (disposed) return;
      environment.follow(position);
      cull(position, rotation, indoors);
    },
    dispose() {
      disposed = true;
      // O nó raiz elimina as malhas; materiais e texturas são liberados à parte.
      for (const material of new Set(disposables)) material?.dispose(false, true);
      root.dispose();
    },
  };
}

function groupBySprite(placements) {
  const groups = new Map();
  for (const placement of placements) {
    if (!groups.has(placement.sprite)) groups.set(placement.sprite, []);
    groups.get(placement.sprite).push(placement);
  }
  return groups;
}

/**
 * Cilindro deitado no eixo X. Na imagem, o quadrado da esquerda é o corte (usado
 * nas pontas) e o restante é a casca, no sentido do comprimento.
 */
function createLogMesh(BABYLON, scene, record, materialOptions) {
  const SIDES = 7;
  const radius = record.worldHeight / 2;
  const half = Math.max(radius, record.worldWidth - record.worldHeight) / 2;
  const cap = Math.min(0.5, record.worldHeight / record.worldWidth);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const add = (position, normal, uv) => {
    positions.push(...position);
    normals.push(...normal);
    uvs.push(...uv);
    return positions.length / 3 - 1;
  };
  const ring = (i) => {
    const angle = (i / SIDES) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  };

  for (let i = 0; i <= SIDES; i += 1) {
    const [c, s] = ring(i);
    for (const [x, u] of [[-half, cap], [half, 1]]) add([x, c * radius, s * radius], [0, c, s], [u, i / SIDES]);
    if (i === 0) continue;
    const a = (i - 1) * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  for (const side of [-1, 1]) {
    const center = add([side * half, 0, 0], [side, 0, 0], [cap / 2, 0.5]);
    for (let i = 0; i <= SIDES; i += 1) {
      const [c, s] = ring(i);
      const index = add([side * half, c * radius, s * radius], [side, 0, 0], [(cap / 2) * (1 + s), (1 + c) / 2]);
      if (i > 0) indices.push(center, index - 1, index);
    }
  }

  const data = new BABYLON.VertexData();
  Object.assign(data, { positions, normals, uvs, indices });
  const mesh = new BABYLON.Mesh(`log:${record.id}`, scene);
  data.applyToMesh(mesh);
  mesh.material = createLogMaterial(BABYLON, scene, record, materialOptions);
  return mesh;
}
