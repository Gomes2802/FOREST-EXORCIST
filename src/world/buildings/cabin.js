/**
 * Planta da cabana abandonada (função pura, sem dependência de 3D).
 *
 * Tudo é descrito por caixas alinhadas aos eixos, em coordenadas do mundo:
 *  - pieces: o que se desenha (cada caixa tem um material e um tom);
 *  - solids: o que bloqueia o jogador (paredes e móveis);
 *  - occluders: o que bloqueia a visão (as janelas ficam abertas);
 *  - interactables: o que responde à tecla E;
 *  - exclusions / anchors: onde a vegetação não nasce e onde uma entidade pode
 *    aparecer perto da construção.
 *
 * A porta fica na parede leste (+x), voltada para a trilha.
 */

/** Caixa a partir do centro no plano e das alturas. */
export function box(x, z, sizeX, sizeZ, bottom, top) {
  return {
    minX: x - sizeX / 2,
    maxX: x + sizeX / 2,
    minY: bottom,
    maxY: top,
    minZ: z - sizeZ / 2,
    maxZ: z + sizeZ / 2,
  };
}

/** Parede com aberturas, em pedaços: lados, baixo e cima de cada abertura. */
function wallWithOpenings(axis, fixed, from, to, thickness, height, openings) {
  const piece = (a, b, bottom, top) => (axis === 'x'
    ? box((a + b) / 2, fixed, b - a, thickness, bottom, top)
    : box(fixed, (a + b) / 2, thickness, b - a, bottom, top));
  const pieces = [];
  let cursor = from;
  for (const opening of [...openings].sort((a, b) => a.center - b.center)) {
    const left = opening.center - opening.width / 2;
    const right = opening.center + opening.width / 2;
    if (left > cursor) pieces.push(piece(cursor, left, 0, height));
    if (opening.bottom > 0) pieces.push(piece(left, right, 0, opening.bottom));
    if (opening.top < height) pieces.push(piece(left, right, opening.top, height));
    cursor = right;
  }
  if (to > cursor) pieces.push(piece(cursor, to, 0, height));
  return pieces;
}

/**
 * @param {object} settings um item de CONFIG.buildings
 */
export function planCabin(settings) {
  const { id, center: [cx, cz], size: [width, depth], wallHeight, wallThickness, door, windows } = settings;
  const west = cx - width / 2;
  const east = cx + width / 2;
  const south = cz - depth / 2;
  const north = cz + depth / 2;
  const half = wallThickness / 2;

  const openingsFor = (wall) => windows.filter((w) => w.wall === wall).map((w) => ({
    center: (wall === 'north' || wall === 'south' ? cx : cz) + w.offset,
    width: w.width,
    bottom: w.bottom,
    top: w.top,
  }));
  const doorOpening = { center: cz, width: door.width, bottom: 0, top: door.height };

  const walls = [
    ...wallWithOpenings('x', north - half, west, east, wallThickness, wallHeight, openingsFor('north')),
    ...wallWithOpenings('x', south + half, west, east, wallThickness, wallHeight, openingsFor('south')),
    ...wallWithOpenings('z', west + half, south + wallThickness, north - wallThickness, wallThickness, wallHeight, openingsFor('west')),
    ...wallWithOpenings('z', east - half, south + wallThickness, north - wallThickness, wallThickness, wallHeight,
      [doorOpening, ...openingsFor('east')]),
  ];

  // Colisão: paredes inteiras (janelas não são passagens), menos o vão da porta.
  const doorLeft = cz - door.width / 2;
  const doorRight = cz + door.width / 2;
  const solids = [
    box(cx, north - half, width, wallThickness, 0, wallHeight),
    box(cx, south + half, width, wallThickness, 0, wallHeight),
    box(west + half, cz, wallThickness, depth - wallThickness * 2, 0, wallHeight),
    box(east - half, (south + wallThickness + doorLeft) / 2, wallThickness, doorLeft - south - wallThickness, 0, wallHeight),
    box(east - half, (doorRight + north - wallThickness) / 2, wallThickness, north - wallThickness - doorRight, 0, wallHeight),
  ];

  const furniture = settings.furniture.map((item) => ({
    ...item,
    boxes: furnitureBoxes(item, cx, cz),
  }));
  for (const item of furniture) {
    if (item.solid) solids.push(box(cx + item.at[0], cz + item.at[1], item.size[0], item.size[1], 0, item.height));
  }

  const interactables = [
    {
      id: `${id}:door`,
      type: 'door',
      point: { x: east - half, y: 1.2, z: cz },
      range: door.reach,
    },
    ...settings.examinables.map((item) => ({
      id: `${id}:${item.id}`,
      type: 'examine',
      name: item.name,
      message: item.message,
      point: { x: cx + item.at[0], y: item.at[1], z: cz + item.at[2] },
      range: item.reach ?? 2.2,
    })),
  ];

  // Pontos onde uma entidade pode aparecer: fora de cada janela e diante da porta.
  const anchors = windows.map((w) => {
    const along = (w.wall === 'north' || w.wall === 'south' ? cx : cz) + w.offset;
    const out = settings.anchorDistance;
    const spot = {
      north: { x: along, z: north + out },
      south: { x: along, z: south - out },
      west: { x: west - out, z: along },
      east: { x: east + out, z: along },
    }[w.wall];
    return { ...spot, kind: 'window', building: id };
  });
  anchors.push({ x: east + settings.entranceDistance, z: cz + door.width, kind: 'entrance', building: id });

  const footprint = { minX: west, maxX: east, minZ: south, maxZ: north };
  return {
    id,
    center: { x: cx, z: cz },
    footprint,
    bounds: {
      minX: west + wallThickness, maxX: east - wallThickness, minZ: south + wallThickness, maxZ: north - wallThickness,
    },
    wallHeight,
    walls,
    solids,
    furniture,
    interactables,
    anchors,
    door: {
      id: `${id}:door`,
      width: door.width,
      height: door.height,
      thickness: 0.1,
      /** Dobradiça no lado sul do vão; abre para dentro (-x). */
      hinge: { x: east - half, z: doorLeft },
      closed: box(east - half, cz, wallThickness, door.width, 0, door.height),
      openAngle: door.openAngle,
      speed: door.speed,
    },
    /** Áreas sem vegetação: a construção, a entrada e os pontos das janelas. */
    exclusions: [
      { ...footprint, margin: settings.clearing },
      ...anchors.map((a) => ({ minX: a.x, maxX: a.x, minZ: a.z, maxZ: a.z, margin: settings.anchorClearing })),
    ],
    lamp: {
      x: cx + settings.lamp.at[0],
      y: settings.lamp.at[1],
      z: cz + settings.lamp.at[2],
    },
  };
}

/** Caixas que desenham cada móvel, relativas ao centro da cabana. */
function furnitureBoxes({ type, at: [ox, oz], size: [sx, sz], height }, cx, cz) {
  const x = cx + ox;
  const z = cz + oz;
  const part = (dx, dz, w, d, bottom, top, material = 'wood', shade = 1) => ({
    ...box(x + dx, z + dz, w, d, bottom, top), material, shade,
  });
  const legs = (w, d, top, thick) => [-1, 1].flatMap((i) => [-1, 1].map(
    (j) => part(i * (w / 2 - thick / 2), j * (d / 2 - thick / 2), thick, thick, 0, top, 'wood', 0.8),
  ));
  switch (type) {
    case 'table':
      return [part(0, 0, sx, sz, height - 0.1, height), ...legs(sx, sz, height - 0.1, 0.12)];
    case 'chair':
      return [
        part(0, 0, sx, sz, 0.42, 0.5),
        part(0, -sz / 2 + 0.05, sx, 0.1, 0.5, height),
        ...legs(sx, sz, 0.42, 0.08),
      ];
    case 'shelf': {
      const boards = [0.05, 0.65, 1.25, 1.85].filter((y) => y < height).map((y) => part(0, 0, sx, sz, y, y + 0.08));
      const sides = [-1, 1].map((i) => part(i * (sx / 2 - 0.04), 0, 0.08, sz, 0, height, 'wood', 0.75));
      const books = [0.13, 0.73, 1.33].filter((y) => y + 0.42 < height)
        .map((y, i) => part((i - 1) * 0.1, sz * 0.06, sx - 0.35 - i * 0.12, sz * 0.7, y, y + 0.4, 'books', 0.9));
      return [...boards, ...sides, ...books];
    }
    case 'wardrobe':
      return [
        part(0, 0, sx, sz, 0.12, height),
        part(0, 0, sx + 0.08, sz + 0.08, height, height + 0.08, 'wood', 0.7),
        // Porta entreaberta: uma fresta escura.
        part(sx * 0.08, -sz / 2 - 0.012, 0.07, 0.02, 0.25, height - 0.12, 'wood', 0.15),
        ...legs(sx, sz, 0.12, 0.12),
      ];
    case 'crate':
      return [part(0, 0, sx, sz, 0, height, 'wood', 0.85), part(0, 0, sx + 0.04, sz + 0.04, height - 0.1, height - 0.02, 'wood', 0.6)];
    case 'papers':
      return [
        part(-0.14, 0.04, 0.32, 0.24, height, height + 0.015, 'paper', 1),
        part(0.18, -0.1, 0.26, 0.32, height + 0.002, height + 0.012, 'paper', 0.8),
      ];
    case 'books':
      return [
        part(0, 0, 0.34, 0.24, height, height + 0.09, 'books', 0.85),
        part(0.03, 0.02, 0.28, 0.2, height + 0.09, height + 0.16, 'books', 0.65),
      ];
    case 'portrait':
      return [
        part(0, 0, sx, sz, height - 0.35, height + 0.35, 'wood', 0.5),
        part(sx / 2 + 0.006, 0, 0.012, sz - 0.1, height - 0.29, height + 0.29, 'portrait', 1),
      ];
    default:
      return [];
  }
}
