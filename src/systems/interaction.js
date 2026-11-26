/**
 * Detecção da entidade sob a mira, por raycast a partir da câmera.
 *
 * Só a lista de entidades é testada, então árvores, pedras e arbustos nunca são
 * alvo. Eles apenas podem bloquear a visão (troncos, pedras altas e afins).
 */

/**
 * Há obstáculo entre os olhos e o ponto atingido? (função pura)
 * Cada obstáculo é um cilindro vertical { x, z, radius, height }.
 */
export function isBlocked(origin, point, occluders) {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const length2 = dx * dx + dz * dz;
  if (length2 === 0) return false;
  return occluders.some(({ x, z, radius, height }) => {
    const t = ((x - origin.x) * dx + (z - origin.z) * dz) / length2;
    if (t <= 0 || t >= 1) return false;
    if (Math.hypot(origin.x + dx * t - x, origin.z + dz * t - z) >= radius) return false;
    return origin.y + (point.y - origin.y) * t < height;
  });
}

/**
 * @param {{ range: number, blockedByObstacles: boolean }} settings CONFIG.exorcism
 */
export function createTargeting(BABYLON, settings) {
  // Reutilizados a cada quadro, para não gerar lixo de memória.
  const ray = new BABYLON.Ray(new BABYLON.Vector3(), new BABYLON.Vector3(0, 0, 1), settings.range);

  return {
    /**
     * @returns {object|null} a entidade válida mais próxima sob a mira.
     */
    find(origin, direction, entities, occluders = []) {
      let best = null;
      let nearest = Infinity;
      for (const entity of entities) {
        if (!entity.isTargetable) continue;
        // Descarte barato antes do raio: longe demais ou atrás do jogador.
        const { center, boundingRadius } = entity;
        const cx = center.x - origin.x;
        const cy = center.y - origin.y;
        const cz = center.z - origin.z;
        if (Math.hypot(cx, cy, cz) - boundingRadius > settings.range) continue;
        if (cx * direction.x + cy * direction.y + cz * direction.z < -boundingRadius) continue;

        ray.origin.set(origin.x, origin.y, origin.z);
        ray.direction.set(direction.x, direction.y, direction.z);
        const hit = ray.intersectsMesh(entity.hitbox, false);
        if (!hit.hit || hit.distance > settings.range || hit.distance >= nearest) continue;
        if (settings.blockedByObstacles && isBlocked(origin, hit.pickedPoint, occluders)) continue;
        best = entity;
        nearest = hit.distance;
      }
      return best;
    },
  };
}
