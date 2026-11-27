/**
 * Onde a entidade pode surgir (funções puras, sem dependência de 3D).
 *
 * Um lugar serve quando: está entre a distância mínima e a máxima (e onde a
 * neblina ainda deixa ver), dentro da área explorável, ao lado do centro do olhar
 * mas ainda na tela, fora de objetos e com corpo e cabeça visíveis, para a
 * entidade poder ser identificada.
 */
import { isBlocked } from './interaction.js';
import { distanceToPaths } from '../world/environment.js';

const DEGREES = Math.PI / 180;

/** Distância em que a neblina (EXP2) ainda deixa passar a fração `minVisibility`. */
export function fogVisibleDistance(density, minVisibility) {
  return density > 0 ? Math.sqrt(-Math.log(minVisibility)) / density : Infinity;
}

/** Ângulo (radianos, 0..π) entre a direção do olhar e um ponto no plano do chão. */
export function viewAngle(viewer, point) {
  const dx = point.x - viewer.x;
  const dz = point.z - viewer.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return 0;
  const cos = (dx * Math.sin(viewer.yaw) + dz * Math.cos(viewer.yaw)) / length;
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/**
 * @param {{ x: number, z: number }} spot
 * @param {{ viewer: { x: number, z: number, yaw: number, eyeHeight: number },
 *   world: { boundaryRadius: number, fogDensity: number, occluders: object[],
 *   blockers: object[] }, settings: object, previous?: { x: number, z: number } }} context
 *   occluders: sólidos; blockers: folhagem alta que esconde a visão.
 */
export function isValidSpawn(spot, { viewer, world, settings, previous = null }) {
  const distance = Math.hypot(spot.x - viewer.x, spot.z - viewer.z);
  const farthest = Math.min(settings.maxDistance, fogVisibleDistance(world.fogDensity, settings.minVisibility));
  if (distance < settings.minDistance || distance > farthest) return false;
  if (Math.hypot(spot.x, spot.z) > world.boundaryRadius - 1) return false;

  const angle = viewAngle(viewer, spot) / DEGREES;
  if (angle < settings.minViewAngle - 1e-9 || angle > settings.maxViewAngle + 1e-9) return false;
  if (previous && Math.hypot(spot.x - previous.x, spot.z - previous.z) < settings.minRespawnGap) return false;

  const inside = (items, scale = 1) => items.some(
    (o) => Math.hypot(spot.x - o.x, spot.z - o.z) < o.radius * scale + settings.clearance,
  );
  // Colada à folhagem pode; dentro do miolo dela, não.
  if (inside(world.occluders) || inside(world.blockers, 0.6)) return false;

  // Linhas de visão dos olhos até o corpo (centro e lados) e a cabeça.
  const eye = { x: viewer.x, y: viewer.eyeHeight, z: viewer.z };
  // Direção perpendicular à linha de visão, para os pontos laterais.
  const sideX = -(spot.z - viewer.z) / distance;
  const sideZ = (spot.x - viewer.x) / distance;
  return settings.sightPoints.every(([lateral, height]) => {
    const point = { x: spot.x + sideX * lateral, y: height, z: spot.z + sideZ * lateral };
    return !isBlocked(eye, point, world.occluders)
      && !isBlocked(eye, point, world.blockers, settings.foliageScale);
  });
}

/**
 * Sorteia um lugar válido, com preferência pelos perto das trilhas. Tenta as
 * regras normais e depois, se preciso, as de `settings.fallbacks`.
 * @returns {{ x: number, z: number } | null} null se não achar nenhum agora.
 */
export function chooseSpawn(context) {
  const { settings } = context;
  for (const relaxed of [null, ...(settings.fallbacks ?? [])]) {
    const spot = sample({ ...context, settings: relaxed ? { ...settings, ...relaxed } : settings });
    if (spot) return spot;
  }
  return null;
}

function sample({ random, viewer, world, settings, previous = null }) {
  const farthest = Math.min(settings.maxDistance, fogVisibleDistance(world.fogDensity, settings.minVisibility));
  if (farthest < settings.minDistance) return null;

  const found = [];
  for (let attempt = 0; attempt < settings.attempts && found.length < settings.candidates; attempt += 1) {
    const distance = settings.minDistance + random() * (farthest - settings.minDistance);
    const side = random() < 0.5 ? -1 : 1;
    const angle = viewer.yaw + side * DEGREES
      * (settings.minViewAngle + random() * (settings.maxViewAngle - settings.minViewAngle));
    const spot = { x: viewer.x + Math.sin(angle) * distance, z: viewer.z + Math.cos(angle) * distance };
    if (!isValidSpawn(spot, { viewer, world, settings, previous })) continue;
    const nearPath = world.paths && distanceToPaths(spot.x, spot.z, world.paths) <= settings.pathDistance;
    found.push({ spot, weight: nearPath ? settings.pathWeight : 1 });
  }
  if (found.length === 0) return null;

  let pick = random() * found.reduce((sum, item) => sum + item.weight, 0);
  for (const item of found) {
    pick -= item.weight;
    if (pick <= 0) return item.spot;
  }
  return found.at(-1).spot;
}
