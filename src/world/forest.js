/**
 * Floresta: planejamento da vegetação e montagem dos objetos na cena.
 *
 * - Árvores, arbustos, plantas e pedras: sprites em "billboard", com uma
 *   malha-base e instâncias (um draw call por sprite).
 * - Grama e sombras no chão: instâncias finas, sem custo por quadro.
 * - Troncos caídos: malha simples de baixa resolução, texturizada por um sprite.
 *
 * O terreno e o horizonte ficam em environment.js.
 */
import { createColliders, solidCircles } from './colliders.js';
import { createEnvironment, createRandom, createValueNoise, distanceToPaths } from './environment.js';
import { createLogMaterial, createShadowMaterial, createSpriteMaterial } from '../graphics/materials.js';

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
  const { paths, pathHalfWidth, spawnClearing } = settings;
  const [x, , z] = placement.position;
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

/** Carrega os recursos e monta a floresta na cena. */
export async function createForest(BABYLON, scene, {
  config, spriteManager, pixelRenderer, lights,
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
  const placements = planForest(settings, (group) => spriteManager.idsByGroup(group), describe);
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
  });
  const disposables = [...environment.disposables];
  const adopt = (mesh) => {
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    disposables.push(mesh.material);
    return mesh;
  };
  const materialOptions = { pixelRenderer, tint: config.lighting.spriteTint, lit: true };

  // Sprites que acompanham a câmera.
  const bases = new Map();
  const smallObjects = new Set();
  const objects = ofKind('billboard').map((placement, index) => {
    let base = bases.get(placement.sprite);
    if (!base) {
      const record = describe(placement.sprite);
      base = adopt(createSpriteMesh(BABYLON, scene, record, materialOptions));
      base.registerInstancedBuffer(BABYLON.VertexBuffer.ColorKind, 4);
      base.instancedBuffers.color = new BABYLON.Color4(1, 1, 1, 1);
      lights.excludeFromNight(base);
      bases.set(placement.sprite, base);
    }
    const instance = base.createInstance(`${placement.sprite}#${index}`);
    instance.position.fromArray(placement.position);
    instance.scaling.set(placement.scale * placement.stretch, placement.scale, placement.scale);
    instance.instancedBuffers.color = new BABYLON.Color4(placement.shade, placement.shade, placement.shade, 1);
    instance.billboardMode = BABYLON.TransformNode.BILLBOARDMODE_Y;
    instance.isPickable = false;
    instance.parent = root;
    if (base.getBoundingInfo().boundingBox.maximum.y * placement.scale < config.environment.culling.smallHeight) {
      smallObjects.add(instance);
    }
    return instance;
  });

  const grassFilters = [];
  const grass = [...groupBySprite(ofKind('grass'))].map(([id, items]) => {
    const mesh = adopt(createGrassMesh(BABYLON, scene, describe(id), materialOptions));
    lights.excludeFromNight(mesh);
    const nearby = setThinInstances(BABYLON, mesh, items, (p) => ({
      scale: [p.scale * p.stretch, p.scale, p.scale * p.stretch],
      position: p.position,
      color: [p.shade, p.shade, p.shade, 1],
    }));
    grassFilters.push(nearby);
    return mesh;
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

  const shadows = adopt(createShadowMesh(BABYLON, scene, describe(shadow.sprite), pixelRenderer));
  const casters = placements.filter((p) => p.kind === 'billboard' && p.position[1] === 0
    && Math.hypot(p.position[0], p.position[2]) <= settings.solidLimit
    && describe(p.sprite).definition.collisionRadius > 0);
  setThinInstances(BABYLON, shadows, casters, (p) => {
    const size = Math.max(1, describe(p.sprite).worldWidth * p.scale * shadow.size);
    return { scale: [size, 1, size], position: [p.position[0], 0.025, p.position[2]] };
  });

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

  const culled = { x: Infinity, z: Infinity, distance: 0 };
  /** Desliga o desenho do que está escondido pela neblina (colisões continuam). */
  function cull(position) {
    const distance = visibleDistance(config.environment, scene.fogDensity);
    const moved = Math.hypot(position.x - culled.x, position.z - culled.z);
    if (moved < config.environment.culling.step && distance === culled.distance) return;
    Object.assign(culled, { x: position.x, z: position.z, distance });
    for (const object of [...objects, ...logs]) {
      const limit = smallObjects.has(object)
        ? Math.min(distance, config.environment.culling.smallDistance) : distance;
      const visible = Math.hypot(object.position.x - position.x, object.position.z - position.z) <= limit;
      if (object.isEnabled(false) !== visible) object.setEnabled(visible);
    }
    // A grama é pequena e numerosa: some bem antes das árvores.
    for (const filter of grassFilters) filter(position, Math.min(distance, config.environment.culling.grassDistance));
  }

  return {
    root,
    ground: environment.ground,
    trails: environment.trails,
    sky: environment.sky,
    backdrops: environment.backdrops,
    bases,
    objects,
    grass,
    logs,
    shadows,
    colliders,
    occluders,
    placements,
    follow(position) {
      environment.follow(position);
      cull(position);
    },
    dispose() {
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
 * Grava posição, escala, giro (e cor opcional) de todas as instâncias finas.
 * @returns {(center: { x: number, z: number }, distance: number) => void} função
 *   que passa a desenhar somente as instâncias próximas de um ponto.
 */
function setThinInstances(BABYLON, mesh, placements, transform) {
  const matrices = new Float32Array(placements.length * 16);
  const colors = [];
  placements.forEach((placement, index) => {
    const { scale, position, color } = transform(placement);
    BABYLON.Matrix.Compose(
      new BABYLON.Vector3(...scale),
      BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, placement.yaw),
      new BABYLON.Vector3(...position),
    ).copyToArray(matrices, index * 16);
    if (color) colors.push(...color);
  });
  if (placements.length === 0) {
    mesh.isVisible = false;
    return () => {};
  }
  // Os buffers "vivos" recebem o subconjunto visível; os completos ficam à parte.
  const liveMatrices = matrices.slice();
  const liveColors = Float32Array.from(colors);
  mesh.thinInstanceSetBuffer('matrix', liveMatrices, 16, false);
  if (colors.length > 0) mesh.thinInstanceSetBuffer('color', liveColors, 4, false);
  // As instâncias cercam o jogador: não vale testar a caixa do conjunto.
  mesh.alwaysSelectAsActiveMesh = true;

  return (center, distance) => {
    let count = 0;
    placements.forEach(({ position }, index) => {
      if (Math.hypot(position[0] - center.x, position[2] - center.z) > distance) return;
      liveMatrices.set(matrices.subarray(index * 16, index * 16 + 16), count * 16);
      if (colors.length > 0) {
        for (let c = 0; c < 4; c += 1) liveColors[count * 4 + c] = colors[index * 4 + c];
      }
      count += 1;
    });
    mesh.thinInstanceCount = count;
    mesh.thinInstanceBufferUpdated('matrix');
    if (colors.length > 0) mesh.thinInstanceBufferUpdated('color');
    mesh.setEnabled(count > 0);
  };
}

/** Plano vertical com o pivô na base, no tamanho proporcional à imagem. */
function createSpriteMesh(BABYLON, scene, record, materialOptions) {
  const mesh = BABYLON.MeshBuilder.CreatePlane(
    `base:${record.id}`,
    { width: record.worldWidth, height: record.worldHeight },
    scene,
  );
  mesh.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, record.worldHeight / 2, 0));
  mesh.material = createSpriteMaterial(BABYLON, scene, record, materialOptions);
  mesh.isVisible = false; // Só as instâncias aparecem.
  return mesh;
}

/**
 * Dois planos cruzados, vistos dos dois lados. As normais apontam para cima, para
 * a lanterna iluminar a grama como ilumina o chão.
 */
function createGrassMesh(BABYLON, scene, record, materialOptions) {
  const half = record.worldWidth / 2;
  const top = record.worldHeight;
  const data = new BABYLON.VertexData();
  Object.assign(data, {
    positions: [
      -half, 0, 0, half, 0, 0, half, top, 0, -half, top, 0,
      0, 0, -half, 0, 0, half, 0, top, half, 0, top, -half,
    ],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    normals: Array.from({ length: 8 }, () => [0, 1, 0]).flat(),
    uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1],
  });
  const mesh = new BABYLON.Mesh(`grass:${record.id}`, scene);
  data.applyToMesh(mesh);
  mesh.material = createSpriteMaterial(BABYLON, scene, record, { ...materialOptions, doubleSided: true });
  return mesh;
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

/** Mancha escura deitada no chão, sob árvores e pedras (sombra sem custo de luz). */
function createShadowMesh(BABYLON, scene, record, pixelRenderer) {
  const mesh = BABYLON.MeshBuilder.CreateGround('shadows', { width: 1, height: 1 }, scene);
  mesh.material = createShadowMaterial(BABYLON, scene, record, { pixelRenderer });
  return mesh;
}
