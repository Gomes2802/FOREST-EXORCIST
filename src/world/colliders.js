/**
 * Obstáculos sólidos: prismas invisíveis na base dos sprites, usados pelo sistema
 * de colisões do Babylon.js. Não geram chamadas de desenho.
 *
 * O raio vem de "collisionRadius" no manifesto de sprites e acompanha a escala
 * de cada objeto. Sprites sem esse campo são atravessáveis. Troncos caídos usam
 * uma fileira de prismas ao longo do corpo.
 */
const TESSELLATION = 8;

/**
 * Círculos sólidos no plano do chão (função pura).
 * @param {object[]} placements
 * @param {(id: string) => { worldWidth: number, worldHeight: number,
 *   definition: { collisionRadius: number } }} describe
 * @returns {{ x: number, y: number, z: number, radius: number, placement: object }[]}
 */
export function solidCircles(placements, describe) {
  return placements.flatMap((placement) => {
    if (placement.solid === false || placement.kind === 'grass') return [];
    const record = describe(placement.sprite);
    const radius = record.definition.collisionRadius * placement.scale;
    if (!(radius > 0)) return [];
    const [x, y, z] = placement.position;
    if (placement.kind !== 'log') return [{ x, y, z, radius, placement }];

    const length = (record.worldWidth - record.worldHeight) * placement.scale;
    const span = Math.max(0, length - radius * 2);
    // Vizinhos separados por no máximo um raio: a lateral fica quase lisa.
    const count = Math.ceil(span / radius) + 1;
    return Array.from({ length: count }, (_, i) => {
      const along = count > 1 ? (i / (count - 1) - 0.5) * span : 0;
      return {
        x: x + Math.cos(placement.yaw) * along,
        y,
        z: z - Math.sin(placement.yaw) * along,
        radius,
        placement,
      };
    });
  });
}

export function createColliders(BABYLON, scene, placements, { spriteManager, height, parent }) {
  const solid = solidCircles(placements, (id) => spriteManager.get(id));
  if (solid.length === 0) return [];

  // Uma geometria compartilhada; começa abaixo do chão para não haver frestas.
  const source = BABYLON.MeshBuilder.CreateCylinder(
    'collider:base',
    { diameter: 2, height, tessellation: TESSELLATION },
    scene,
  );
  source.parent = parent;
  source.isVisible = false;
  source.isPickable = false;

  return solid.map(({ x, y, z, radius, placement }, index) => {
    const collider = source.clone(`collider:${placement.sprite}#${index}`, parent);
    collider.position.set(x, y + height / 2 - 1, z);
    collider.scaling.set(radius, 1, radius);
    collider.isVisible = false;
    collider.isPickable = false;
    collider.checkCollisions = true;
    // Raio garantido (apótema do octógono), conferido também por player.js.
    collider.metadata = { solidRadius: radius * Math.cos(Math.PI / TESSELLATION) };
    collider.computeWorldMatrix(true);
    collider.freezeWorldMatrix();
    return collider;
  });
}
