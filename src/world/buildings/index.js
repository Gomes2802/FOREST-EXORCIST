/**
 * Construções da floresta: planta (pura) e montagem na cena.
 *
 * Para adicionar outro tipo, escreva uma função de planta como planCabin e
 * registre-a em PLANNERS; o resto (malhas, colisões, porta, visão, interação e
 * aparições) funciona com a mesma estrutura.
 *
 * Desempenho: a geometria parada é reunida em uma malha por material (poucas
 * chamadas de desenho), nada é recalculado por quadro além da porta e da chama, e
 * o que está longe não é desenhado.
 */
import { planCabin } from './cabin.js';
import {
  documentItem, documentParts, documentPoint, outdoorPaint,
} from './clues.js';
import { createGeometry } from './geometry.js';
import { createBuildingMaterial, createGlowMaterial } from '../../graphics/materials.js';
import { createRandom } from '../environment.js';
import { touchesBox } from '../../systems/interact.js';

const PLANNERS = { cabin: planCabin };

/** Materiais cujas faces ficam dentro da construção. */
const INTERIOR = new Set(['inside', 'floor', 'wood', 'books', 'paper', 'portrait']);
/** Materiais de objetos pequenos: cada face mostra a imagem inteira. */
const WHOLE_IMAGE = new Set(['paper', 'portrait']);
/** Quanto a porta precisa estar aberta para deixar passar e deixar ver. */
const PASSABLE = 0.6;
const SEE_THROUGH = 0.35;

export function planBuildings(config) {
  return (config.buildings ?? []).map((settings) => {
    const planner = PLANNERS[settings.type];
    if (!planner) throw new Error(`Tipo de construção desconhecido: "${settings.type}".`);
    const plan = { ...planner(settings), settings };
    // Os documentos desta construção respondem à tecla E como os demais objetos.
    plan.documents = (config.investigation?.documents ?? [])
      .filter((doc) => doc.place.building === plan.id)
      .map((doc) => ({ ...doc, point: documentPoint(doc, plan.center) }));
    plan.interactables.push(...plan.documents.map((doc) => documentItem(doc, doc.point, config.investigation.reach)));
    return plan;
  });
}

/** O ponto (x, z) está dentro de alguma construção (com folga)? */
export function insideBuilding(plans, x, z, margin = 0) {
  return plans.some(({ footprint }) => x >= footprint.minX - margin && x <= footprint.maxX + margin
    && z >= footprint.minZ - margin && z <= footprint.maxZ + margin);
}

/** Telhado de duas águas, com beirais, e os triângulos de madeira nas pontas. */
function addRoof(plan, geometry) {
  const { footprint: f, wallHeight, settings } = plan;
  const { overhang, rise } = settings.roof;
  const ridge = wallHeight + rise;
  const middle = (f.minZ + f.maxZ) / 2;
  const x0 = f.minX - overhang;
  const x1 = f.maxX + overhang;
  const eave = wallHeight - 0.15;
  for (const [edge, side] of [[f.minZ - overhang, -1], [f.maxZ + overhang, 1]]) {
    const length = Math.hypot(edge - middle, ridge - eave);
    const normal = [0, Math.abs(edge - middle) / length, (side * (ridge - eave)) / length];
    geometry.roof.quad(
      [[x0, eave, edge], [x1, eave, edge], [x1, ridge, middle], [x0, ridge, middle]],
      normal,
      [[x0, 0], [x1, 0], [x1, length], [x0, length]],
      side < 0 ? 0.95 : 0.8,
    );
  }
  for (const [x, direction] of [[f.minX, -1], [f.maxX, 1]]) {
    geometry.outside.quad(
      [[x, wallHeight, f.minZ], [x, wallHeight, f.maxZ], [x, ridge, middle], [x, ridge, middle]],
      [direction, 0, 0],
      [[f.minZ, wallHeight], [f.maxZ, wallHeight], [middle, ridge], [middle, ridge]],
      0.85,
    );
  }
}

/** Geometria parada de uma construção, separada por material. */
function buildGeometry(plan) {
  const names = ['outside', 'inside', 'floor', 'roof', 'wood', 'books', 'paper', 'portrait'];
  const geometry = Object.fromEntries(names.map((name) => [name, createGeometry()]));
  const random = createRandom(plan.settings.seed);
  const { footprint: f, bounds, wallHeight } = plan;

  // Paredes: a face voltada para o centro é a de dentro; as demais, de fora.
  for (const wall of plan.walls) {
    const shade = 0.78 + random() * 0.3;
    const alongX = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
    let inward;
    if (alongX) inward = (wall.minZ + wall.maxZ) / 2 > plan.center.z ? '-z' : '+z';
    else inward = (wall.minX + wall.maxX) / 2 > plan.center.x ? '-x' : '+x';
    geometry.inside.box(wall, shade, (face) => face === inward);
    geometry.outside.box(wall, shade, (face) => face !== inward && face !== '-y');
  }
  // Moldura e travessas das janelas.
  for (const window of plan.settings.windows) {
    const horizontal = window.wall === 'north' || window.wall === 'south';
    const along = (horizontal ? plan.center.x : plan.center.z) + window.offset;
    const fixed = { north: f.maxZ - 0.1, south: f.minZ + 0.1, west: f.minX + 0.1, east: f.maxX - 0.1 }[window.wall];
    const bar = (a, length, bottom, top) => (horizontal
      ? { minX: a - length / 2, maxX: a + length / 2, minZ: fixed - 0.13, maxZ: fixed + 0.13, minY: bottom, maxY: top }
      : { minX: fixed - 0.13, maxX: fixed + 0.13, minZ: a - length / 2, maxZ: a + length / 2, minY: bottom, maxY: top });
    for (const piece of [
      bar(along, window.width + 0.2, window.bottom - 0.08, window.bottom),
      bar(along, window.width + 0.2, window.top, window.top + 0.08),
      bar(along - window.width / 2, 0.09, window.bottom, window.top),
      bar(along + window.width / 2, 0.09, window.bottom, window.top),
      bar(along + window.width * 0.12, 0.05, window.bottom, window.top),
    ]) geometry.outside.box(piece, 0.55);
  }

  const floor = { ...bounds, minY: 0, maxY: 0.03 };
  geometry.floor.box(floor, 0.9, (face) => face === '+y');
  // Soleira no vão da porta.
  geometry.floor.box({
    minX: bounds.maxX, maxX: f.maxX + 0.15, minZ: plan.door.closed.minZ, maxZ: plan.door.closed.maxZ, minY: 0, maxY: 0.032,
  }, 0.7, (face) => face === '+y');
  // Forro.
  geometry.floor.box({ ...bounds, minY: wallHeight - 0.06, maxY: wallHeight }, 0.55, (face) => face === '-y');

  for (const item of plan.furniture) {
    for (const part of item.boxes) {
      geometry[part.material].box(part, part.shade, undefined, WHOLE_IMAGE.has(part.material));
    }
  }
  // Documentos da construção (dentro ou fora): somam-se às malhas que já
  // existem, sem nenhuma chamada de desenho a mais.
  for (const doc of plan.documents) {
    for (const part of documentParts(doc, doc.point)) {
      geometry[part.material].box(part.box, part.shade, undefined, WHOLE_IMAGE.has(part.material));
    }
  }
  addRoof(plan, geometry);
  return geometry;
}

/**
 * Monta as construções na cena.
 * @param {{ config: object, spriteManager: object, pixelRenderer: object,
 *   lights: object, openDoors?: Set<string> }} options
 */
export async function createBuildings(BABYLON, scene, {
  config, spriteManager, pixelRenderer, lights, openDoors = new Set(),
}) {
  const plans = planBuildings(config);
  const root = new BABYLON.TransformNode('buildings', scene);
  const disposables = [];
  const files = config.assets.buildingTextures;
  const images = Object.fromEntries(await Promise.all(Object.entries(files).map(
    async ([name, path]) => [name, (await spriteManager.loadTexture(path)).image],
  )));

  const materials = new Map();
  const materialFor = (name) => {
    if (!materials.has(name)) {
      const image = images[config.buildingMaterials[name]];
      const canvas = pixelRenderer.pixelate(image, { powerOfTwo: true });
      const interior = INTERIOR.has(name);
      let ambient = interior ? config.lighting.interiorColor : null;
      if (name === 'clue') ambient = config.lighting.clueGlow;
      const material = createBuildingMaterial(BABYLON, scene, `building:${name}`, canvas, { pixelRenderer, ambient });
      materials.set(name, material);
      disposables.push(material);
    }
    return materials.get(name);
  };

  const buildings = plans.map((plan) => {
    const meshes = [];
    const interiorMeshes = [];
    const adopt = (mesh, interior) => {
      mesh.parent = root;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      meshes.push(mesh);
      if (interior) {
        interiorMeshes.push(mesh);
        // Dentro de casa não há luar: só a lamparina, a lanterna e a penumbra.
        lights.excludeFromNight(mesh);
      }
    };

    for (const [name, geometry] of Object.entries(buildGeometry(plan))) {
      const mesh = geometry.toMesh(BABYLON, scene, `${plan.id}:${name}`);
      if (!mesh) continue;
      mesh.material = materialFor(name);
      adopt(mesh, INTERIOR.has(name));
      mesh.freezeWorldMatrix();
    }

    // Porta: malha própria, presa à dobradiça para poder girar.
    const { door } = plan;
    const leaf = createGeometry();
    leaf.box({ minX: -door.thickness / 2, maxX: door.thickness / 2, minY: 0.03, maxY: door.height - 0.02, minZ: 0.02, maxZ: door.width - 0.02 }, 0.8);
    for (const y of [0.35, 1.1, 1.85]) {
      leaf.box({ minX: -door.thickness / 2 - 0.02, maxX: door.thickness / 2 + 0.02, minY: y, maxY: y + 0.09, minZ: 0.02, maxZ: door.width - 0.02 }, 0.4);
    }
    leaf.box({ minX: -0.12, maxX: 0.12, minY: 1.0, maxY: 1.1, minZ: door.width - 0.2, maxZ: door.width - 0.12 }, 0.25);
    const doorMesh = leaf.toMesh(BABYLON, scene, `${plan.id}:door-leaf`);
    doorMesh.material = materialFor('door');
    adopt(doorMesh, false);
    doorMesh.position.set(door.hinge.x, 0, door.hinge.z);

    // Lamparina: uma chama pequena e uma luz que só alcança o interior.
    const flame = BABYLON.MeshBuilder.CreateBox(`${plan.id}:flame`, { width: 0.1, height: 0.18, depth: 0.1 }, scene);
    flame.position.set(plan.lamp.x, plan.lamp.y, plan.lamp.z);
    flame.material = createGlowMaterial(BABYLON, scene, `${plan.id}:flame`, plan.settings.lamp.glow);
    disposables.push(flame.material);
    adopt(flame, false);
    const lamp = new BABYLON.PointLight(
      `${plan.id}:lamp`,
      new BABYLON.Vector3(plan.lamp.x, plan.lamp.y + 0.15, plan.lamp.z),
      scene,
    );
    lamp.diffuse = BABYLON.Color3.FromHexString(plan.settings.lamp.color);
    lamp.specular = BABYLON.Color3.Black();
    lamp.intensity = plan.settings.lamp.intensity;
    lamp.range = plan.settings.lamp.range;
    // includedOnlyMeshes vazio significaria "todas": a luz sai junto com as malhas.
    lamp.includedOnlyMeshes.push(...interiorMeshes, doorMesh);

    // Obstáculos invisíveis: caixas alinhadas, conferidas também por player.js.
    const colliderFor = (solid, name) => {
      const collider = BABYLON.MeshBuilder.CreateBox(name, {
        width: solid.maxX - solid.minX, height: config.forest.colliderHeight, depth: solid.maxZ - solid.minZ,
      }, scene);
      collider.position.set((solid.minX + solid.maxX) / 2, config.forest.colliderHeight / 2 - 1, (solid.minZ + solid.maxZ) / 2);
      collider.parent = root;
      collider.isVisible = false;
      collider.isPickable = false;
      collider.checkCollisions = true;
      collider.metadata = { solidBox: solid };
      collider.computeWorldMatrix(true);
      collider.freezeWorldMatrix();
      return collider;
    };
    const colliders = plan.solids.map((solid, i) => colliderFor(solid, `${plan.id}:solid#${i}`));
    const doorCollider = colliderFor(door.closed, `${plan.id}:door-solid`);
    colliders.push(doorCollider);

    let open = openDoors.has(door.id);
    let amount = open ? 1 : 0;
    let time = 0;

    function applyDoor() {
      // Abre para dentro: a folha, que aponta para +z, gira em direção a -x.
      doorMesh.rotation.y = -amount * door.openAngle;
      doorCollider.checkCollisions = amount < PASSABLE;
    }
    applyDoor();

    const closedView = [...plan.walls, door.closed];

    return {
      plan,
      meshes,
      interiorMeshes,
      colliders,
      doorMesh,
      doorCollider,
      lamp,
      flame,
      get doorOpen() {
        return open;
      },
      /** 0 = fechada, 1 = totalmente aberta. */
      get doorAmount() {
        return amount;
      },
      setDoor(value) {
        open = Boolean(value);
        if (open) openDoors.add(door.id);
        else openDoors.delete(door.id);
      },
      /** Abre ou fecha sem animação (nova exploração e recriação da cena). */
      resetDoor(value = false) {
        this.setDoor(value);
        amount = value ? 1 : 0;
        applyDoor();
      },
      /** Obstáculos à visão, incluindo a porta quando fechada. */
      get occluders() {
        return amount < SEE_THROUGH ? closedView : plan.walls;
      },
      /**
       * @param {number} dt
       * @param {{ x: number, z: number, radius: number }} [player] enquanto ele
       *   estiver no vão, a porta não termina de fechar (para não prendê-lo).
       */
      animate(dt, player) {
        time += dt;
        const target = open ? 1 : 0;
        const inTheWay = !open && player && touchesBox(player, player.radius + 0.05, door.closed);
        if (amount !== target && !inTheWay) {
          const step = dt / door.speed;
          amount = target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step);
          applyDoor();
        }
        const flicker = Math.sin(time * 11) * 0.5 + Math.sin(time * 23.7) * 0.5;
        lamp.intensity = plan.settings.lamp.intensity * (1 + flicker * plan.settings.lamp.flicker);
        flame.scaling.y = 1 + flicker * 0.18;
      },
    };
  });

  // Pistas na floresta (as das construções já estão nas malhas delas).
  const { documents = [], reach, drawDistance } = config.investigation ?? {};
  const outdoor = documents.filter((doc) => !doc.place.building)
    .map((doc) => ({ doc, point: documentPoint(doc) }));
  const propMeshes = outdoor.map(({ doc, point }) => {
    const geometry = createGeometry();
    for (const part of documentParts(doc, point)) {
      const { color, image } = outdoorPaint(part);
      geometry.box(part.box, color, undefined, image);
    }
    const mesh = geometry.toMesh(BABYLON, scene, `clue:${doc.id}`);
    mesh.material = materialFor('clue');
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    mesh.freezeWorldMatrix();
    mesh.metadata = { center: point };
    return mesh;
  });
  const props = outdoor.map(({ doc, point }) => documentItem(doc, point, reach));

  const culled = { x: Infinity, z: Infinity, far: 0 };
  let disposed = false;

  return {
    root,
    plans,
    buildings,
    /** Documentos na floresta que respondem à tecla E. */
    props,
    /** Uma malha pequena por pista na floresta. */
    propMeshes,
    /** Todas as malhas visíveis (para preparar os shaders no carregamento). */
    get meshes() {
      return [...buildings.flatMap((b) => b.meshes), ...propMeshes];
    },
    animate(dt, player) {
      for (const building of buildings) building.animate(dt, player);
    },
    /** Desliga o desenho do que está longe; colisões continuam. */
    follow(position, far) {
      if (disposed) return;
      if (far === culled.far && Math.hypot(position.x - culled.x, position.z - culled.z) < 1) return;
      Object.assign(culled, { x: position.x, z: position.z, far });
      for (const building of buildings) {
        const { center } = building.plan;
        const distance = Math.hypot(center.x - position.x, center.z - position.z);
        const outside = distance <= far;
        const inside = distance <= Math.min(far, config.environment.culling.interiorDistance);
        for (const mesh of building.meshes) {
          const visible = building.interiorMeshes.includes(mesh) || mesh === building.flame ? inside : outside;
          if (mesh.isEnabled(false) !== visible) mesh.setEnabled(visible);
        }
      }
      for (const mesh of propMeshes) {
        const { x, z } = mesh.metadata.center;
        const visible = Math.hypot(x - position.x, z - position.z) <= Math.min(far, drawDistance);
        if (mesh.isEnabled(false) !== visible) mesh.setEnabled(visible);
      }
    },
    dispose() {
      disposed = true;
      for (const building of buildings) building.lamp.dispose();
      root.dispose();
      for (const material of disposables) material.dispose(false, true);
    },
  };
}
