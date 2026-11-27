/**
 * Geometria agrupada, pensada para a renderização por software (SwiftShader),
 * usada pelo Chrome quando não há placa de vídeo.
 *
 * Medições (v0.4.0): no SwiftShader cada instância custa quase o mesmo que uma
 * chamada de desenho separada. Por isso a vegetação não usa instâncias:
 *  - atlas: os sprites de um mesmo material dividem uma única textura;
 *  - billboards: todos os sprites de um atlas em uma malha, voltados para a
 *    câmera pelo JavaScript (só quando ela gira ou anda);
 *  - regiões: objetos fixos (grama, sombras) em malhas por região do mapa,
 *    descartadas fora da vista ou longe, e com menos itens à distância.
 */

/**
 * Junta imagens já pixeladas em uma textura (empacotamento em prateleiras).
 * @param {{ id: string, canvas: any }[]} records
 * @param {(width: number, height: number) => any} createCanvas
 * @returns {{ canvas: any, rects: Map<string, { u0: number, u1: number, v0: number,
 *   v1: number, width: number, height: number }> }} v0 = base, v1 = topo da imagem
 */
export function buildAtlas(records, createCanvas, { padding = 2 } = {}) {
  const items = [...new Map(records.map((r) => [r.id, r])).values()]
    .sort((a, b) => b.canvas.height - a.canvas.height || a.id.localeCompare(b.id));
  const widest = Math.max(1, ...items.map((r) => r.canvas.width + padding * 2));

  let layout;
  for (let width = 64; ; width *= 2) {
    if (width < widest) continue;
    layout = pack(items, width, padding);
    if (layout.height <= width || width >= 4096) break;
  }

  const canvas = createCanvas(layout.width, layout.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, layout.width, layout.height);
  const rects = new Map();
  for (const { record, x, y } of layout.places) {
    const { width, height } = record.canvas;
    context.drawImage(record.canvas, 0, 0, width, height, x, y, width, height);
    // A textura é criada com invertY: o topo do canvas corresponde a v = 1.
    rects.set(record.id, {
      u0: x / layout.width,
      u1: (x + width) / layout.width,
      v0: 1 - (y + height) / layout.height,
      v1: 1 - y / layout.height,
      width,
      height,
    });
  }
  return { canvas, rects };
}

function pack(items, width, padding) {
  const places = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const record of items) {
    const w = record.canvas.width + padding * 2;
    const h = record.canvas.height + padding * 2;
    if (x + w > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    places.push({ record, x: x + padding, y: y + padding });
    x += w;
    shelf = Math.max(shelf, h);
  }
  return { width, height: Math.max(1, y + shelf), places };
}

/**
 * Sprites em pé, sempre de frente para a câmera, desenhados em uma única malha.
 *
 * Cada sprite: { x, y, z, width, height, shade, rect, small }. Fora da distância
 * permitida ou fora do campo de visão, o sprite vira um ponto (não é desenhado).
 */
export function createBillboardBatch(BABYLON, scene, { name, sprites, material, fov = 1.05, aspect = 16 / 9 }) {
  const count = sprites.length;
  const positions = new Float32Array(count * 12);
  const normals = new Float32Array(count * 12);
  const colors = new Float32Array(count * 16);
  const uvs = new Float32Array(count * 8);
  const indices = new Uint32Array(count * 6);
  const visible = new Uint8Array(count);
  let tallest = 0;
  let widest = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  sprites.forEach((sprite, i) => {
    const { u0, u1, v0, v1 } = sprite.rect;
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    for (let k = 0; k < 4; k += 1) colors.set([sprite.shade, sprite.shade, sprite.shade, 1], i * 16 + k * 4);
    indices.set([0, 1, 2, 0, 2, 3].map((v) => v + i * 4), i * 6);
    tallest = Math.max(tallest, sprite.y + sprite.height);
    widest = Math.max(widest, sprite.width);
    minX = Math.min(minX, sprite.x);
    maxX = Math.max(maxX, sprite.x);
    minZ = Math.min(minZ, sprite.z);
    maxZ = Math.max(maxZ, sprite.z);
    collapse(i);
  });

  const mesh = new BABYLON.Mesh(name, scene);
  mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions, true);
  mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals, true);
  mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs, false);
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors, false);
  mesh.setIndices(indices);
  mesh.material = material;
  // Os sprites cercam o jogador; o descarte é feito aqui, sprite a sprite.
  mesh.alwaysSelectAsActiveMesh = true;
  if (count > 0) {
    const margin = widest;
    mesh.setBoundingInfo(new BABYLON.BoundingInfo(
      new BABYLON.Vector3(minX - margin, 0, minZ - margin),
      new BABYLON.Vector3(maxX + margin, tallest, maxZ + margin),
    ));
  }
  mesh.isVisible = count > 0;

  /** Metade do campo de visão horizontal, com folga. */
  const tanHalf = Math.tan(fov / 2) * aspect * 1.15;
  const last = { x: NaN, z: NaN, yaw: NaN, pitch: NaN, near: NaN, far: NaN };

  function collapse(i) {
    const { x, y, z } = sprites[i];
    for (let k = 0; k < 4; k += 1) positions.set([x, y, z], i * 12 + k * 3);
    visible[i] = 0;
  }

  return {
    mesh,
    sprites,
    /** 1 = desenhado na última atualização. */
    visible,
    get visibleCount() {
      return visible.reduce((sum, v) => sum + v, 0);
    },
    /**
     * @param {{ x: number, z: number, yaw: number, pitch: number }} view câmera
     * @param {{ near: number, far: number }} limits distância para sprites pequenos / grandes
     * @returns {boolean} se a geometria mudou
     */
    update(view, limits) {
      const turned = Math.abs(view.yaw - last.yaw) > 1e-4 || Math.abs(view.pitch - last.pitch) > 1e-3;
      const moved = Math.abs(view.x - last.x) > 1e-3 || Math.abs(view.z - last.z) > 1e-3;
      if (!turned && !moved && limits.near === last.near && limits.far === last.far) return false;
      Object.assign(last, { x: view.x, z: view.z, yaw: view.yaw, pitch: view.pitch }, limits);

      const fx = Math.sin(view.yaw);
      const fz = Math.cos(view.yaw);
      // Olhando muito para cima ou para baixo, o teste lateral deixa de valer.
      const lateral = Math.abs(view.pitch) < 0.6;
      for (let i = 0; i < count; i += 1) {
        const s = sprites[i];
        const dx = s.x - view.x;
        const dz = s.z - view.z;
        const radius = s.width / 2 + 1;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        const show = Math.hypot(dx, dz) <= (s.small ? limits.near : limits.far)
          && ahead > -radius
          && (!lateral || side <= Math.max(0, ahead) * tanHalf + radius);
        if (!show) {
          collapse(i);
          continue;
        }
        visible[i] = 1;
        // Lado direito da câmera: (cos yaw, 0, -sin yaw).
        const hx = fz * (s.width / 2);
        const hz = -fx * (s.width / 2);
        const top = s.y + s.height;
        positions.set([
          s.x - hx, s.y, s.z - hz,
          s.x + hx, s.y, s.z + hz,
          s.x + hx, top, s.z + hz,
          s.x - hx, top, s.z - hz,
        ], i * 12);
      }
      if (turned) {
        // Normal voltada para a câmera, para a lanterna iluminar a face visível.
        for (let v = 0; v < count * 4; v += 1) normals.set([-fx, 0, -fz], v * 3);
        mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals, false, false);
      }
      mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions, false, false);
      return true;
    },
    dispose() {
      mesh.dispose();
    },
  };
}

/**
 * Objetos fixos agrupados por região. Cada região é uma malha comum (com descarte
 * automático fora da vista). Os itens são ordenados por `rank` (0..1), então
 * desenhar menos itens é só desenhar um prefixo dos índices.
 *
 * @param {{ name: string, items: { x: number, z: number, rank: number }[],
 *   chunkSize: number, material: object, vertices: number, indices: number[],
 *   write: (item: object, out: { positions: number[], normals: number[],
 *     uvs: number[], colors: number[] }) => void }} options
 *   write grava os `vertices` de um item; `indices` é o padrão de um item.
 */
export function createChunkedBatch(BABYLON, scene, {
  name, items, chunkSize, material, vertices, indices: pattern, write,
}) {
  const groups = new Map();
  for (const item of items) {
    const key = `${Math.floor(item.x / chunkSize)},${Math.floor(item.z / chunkSize)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const chunks = [...groups].map(([key, group]) => {
    group.sort((a, b) => a.rank - b.rank);
    const out = { positions: [], normals: [], uvs: [], colors: [] };
    const indices = [];
    group.forEach((item, i) => {
      write(item, out);
      for (const index of pattern) indices.push(index + i * vertices);
    });
    const mesh = new BABYLON.Mesh(`${name}:${key}`, scene);
    const data = new BABYLON.VertexData();
    Object.assign(data, { positions: out.positions, normals: out.normals, uvs: out.uvs, indices });
    if (out.colors.length > 0) data.colors = out.colors;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.freezeWorldMatrix();
    const [cx, cz] = key.split(',').map((n) => (Number(n) + 0.5) * chunkSize);
    return { mesh, items: group, x: cx, z: cz, drawn: group.length };
  });

  const perItem = pattern.length;
  return {
    chunks,
    /** Itens desenhados agora, somando as regiões. */
    get drawnCount() {
      return chunks.reduce((sum, c) => sum + (c.mesh.isEnabled(false) ? c.drawn : 0), 0);
    },
    /**
     * @param {{ x: number, z: number }} center
     * @param {number} distance regiões mais longe que isto não são desenhadas
     * @param {(d: number) => number} density fração (0..1) dos itens a desenhar
     */
    update(center, distance, density = () => 1) {
      const half = chunkSize / 2;
      for (const chunk of chunks) {
        // Distância até o ponto mais próximo da região.
        const dx = Math.max(0, Math.abs(center.x - chunk.x) - half);
        const dz = Math.max(0, Math.abs(center.z - chunk.z) - half);
        const near = Math.hypot(dx, dz);
        const drawn = near > distance ? 0 : Math.ceil(chunk.items.length * Math.min(1, density(near)));
        chunk.drawn = drawn;
        if (drawn > 0) chunk.mesh.subMeshes[0].indexCount = drawn * perItem;
        if (chunk.mesh.isEnabled(false) !== drawn > 0) chunk.mesh.setEnabled(drawn > 0);
      }
    },
    dispose() {
      for (const chunk of chunks) chunk.mesh.dispose();
    },
  };
}
