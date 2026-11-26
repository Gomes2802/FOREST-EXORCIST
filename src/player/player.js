/**
 * Estado e movimentação do jogador, com colisões do Babylon.js.
 *
 * A física avança em passos fixos (independe da taxa de quadros) e a posição
 * usada pela câmera é interpolada entre os dois últimos passos. O jogador anda
 * sempre no plano do chão: olhar para cima ou para baixo não afeta o movimento.
 */

/** Velocidade abaixo da qual o jogador é considerado parado (unidades/s). */
const MOVING_SPEED = 0.15;
/** Máximo de passos por quadro: evita travamento depois de uma pausa longa. */
const MAX_STEPS = 24;
const PUSH_ATTEMPTS = 3;

/**
 * Velocidade desejada no plano XZ para uma intenção de movimento e um ângulo de
 * visão. Diagonais são normalizadas.
 */
export function desiredVelocity({ forward = 0, right = 0, run = false }, yaw, { walkSpeed, runSpeed }) {
  const length = Math.hypot(forward, right);
  if (length === 0) return { x: 0, z: 0 };
  const scale = (run ? runSpeed : walkSpeed) / Math.max(1, length);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: (forward * sin + right * cos) * scale,
    z: (forward * cos - right * sin) * scale,
  };
}

/** Aproxima a velocidade atual da desejada, variando no máximo `maxChange`. */
export function approachVelocity(velocity, target, maxChange) {
  const dx = target.x - velocity.x;
  const dz = target.z - velocity.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxChange) return { x: target.x, z: target.z };
  const scale = maxChange / distance;
  return { x: velocity.x + dx * scale, z: velocity.z + dz * scale };
}

export function createPlayer(BABYLON, scene, settings) {
  const [startX, groundY, startZ] = settings.startPosition;
  const centerY = groundY + settings.height / 2;

  // O padrão (0,001) descarta passos curtos e faz o jogador "grudar" em obstáculos.
  BABYLON.AbstractEngine.CollisionsEpsilon = 0.0001;
  scene.collisionsEnabled = true;

  const body = new BABYLON.Mesh('player:body', scene);
  body.isPickable = false;
  body.ellipsoid = new BABYLON.Vector3(settings.radius, settings.height / 2, settings.radius);
  const displacement = new BABYLON.Vector3();

  const previous = { x: startX, z: startZ };
  /** Posição interpolada dos pés, usada pela câmera. */
  const position = { x: startX, y: groundY, z: startZ };
  let velocity = { x: 0, z: 0 };
  let accumulator = 0;
  let state = 'idle';
  let speed = 0;
  let travelled = 0;

  function step(intent, yaw) {
    const dt = settings.fixedStep;
    const target = desiredVelocity(intent, yaw, settings);
    const speedingUp = Math.hypot(target.x, target.z) >= Math.hypot(velocity.x, velocity.z);
    const rate = speedingUp ? settings.acceleration : settings.deceleration;
    velocity = approachVelocity(velocity, target, rate * dt);

    previous.x = body.position.x;
    previous.z = body.position.z;
    if (velocity.x !== 0 || velocity.z !== 0) {
      limitToBounds(velocity.x * dt, velocity.z * dt);
      // Obrigatório: há vários passos por quadro, e sem isto o Babylon calcularia
      // a colisão a partir da posição antiga guardada em cache.
      body.computeWorldMatrix(true);
      body.moveWithCollisions(displacement);
      // Se não sobrar uma posição válida (fora do terreno ou encurralado entre
      // obstáculos), o passo é desfeito: a posição anterior é sempre válida.
      const free = pushOutOfObstacles();
      if (!free || Math.hypot(body.position.x, body.position.z) > settings.boundaryRadius + 1e-6) {
        body.position.x = previous.x;
        body.position.z = previous.z;
      }
      body.position.y = centerY; // Sem voar nem afundar.
    }

    // Distância realmente percorrida: empurrar um obstáculo não conta como andar.
    const moved = Math.hypot(body.position.x - previous.x, body.position.z - previous.z);
    travelled += moved;
    speed = moved / dt;
    if (speed < MOVING_SPEED) state = 'idle';
    else state = intent.run && speed > settings.walkSpeed * 1.05 ? 'running' : 'walking';
  }

  /**
   * Limite circular do terreno: encurta o passo antes das colisões, para o
   * movimento deslizar pela borda sem empurrar o jogador para dentro de árvores.
   */
  function limitToBounds(dx, dz) {
    let x = body.position.x + dx;
    let z = body.position.z + dz;
    const distance = Math.hypot(x, z);
    if (distance > settings.boundaryRadius) {
      x *= settings.boundaryRadius / distance;
      z *= settings.boundaryRadius / distance;
    }
    displacement.set(x - body.position.x, 0, z - body.position.z);
  }

  /**
   * Garantia adicional: o sistema do Babylon às vezes deixa o jogador entrar em um
   * obstáculo (sobretudo entre dois vizinhos). Aqui ele é empurrado de volta para
   * a superfície, o que preserva o deslizamento.
   * @returns {boolean} false se continuar dentro de algum obstáculo.
   */
  function pushOutOfObstacles() {
    for (let attempt = 0; attempt <= PUSH_ATTEMPTS; attempt += 1) {
      let overlapping = false;
      for (const mesh of scene.meshes) {
        const solid = mesh.metadata?.solidRadius;
        if (!solid || !mesh.checkCollisions) continue;
        const dx = body.position.x - mesh.position.x;
        const dz = body.position.z - mesh.position.z;
        const minimum = solid + settings.radius;
        const distance = Math.hypot(dx, dz);
        if (distance >= minimum - 1e-4) continue;
        overlapping = true;
        if (attempt === PUSH_ATTEMPTS || distance === 0) return false;
        body.position.x = mesh.position.x + (dx / distance) * minimum;
        body.position.z = mesh.position.z + (dz / distance) * minimum;
      }
      if (!overlapping) break;
    }
    return true;
  }

  function interpolate(alpha) {
    position.x = previous.x + (body.position.x - previous.x) * alpha;
    position.z = previous.z + (body.position.z - previous.z) * alpha;
  }

  /** Coloca o jogador parado em um ponto do chão. */
  function teleport(x, z) {
    body.position.set(x, centerY, z);
    body.computeWorldMatrix(true);
    previous.x = x;
    previous.z = z;
    accumulator = 0;
    stop();
  }

  /** Zera a velocidade (pausa). */
  function stop() {
    velocity = { x: 0, z: 0 };
    speed = 0;
    state = 'idle';
    previous.x = body.position.x;
    previous.z = body.position.z;
    interpolate(1);
  }

  teleport(startX, startZ);

  return {
    body,
    position,
    /** 'idle' | 'walking' | 'running' */
    get state() {
      return state;
    },
    /** Velocidade horizontal efetiva, já considerando colisões. */
    get speed() {
      return speed;
    },
    get velocity() {
      return { ...velocity };
    },
    /** Distância total percorrida. */
    get travelled() {
      return travelled;
    },
    /**
     * @param {number} deltaSeconds
     * @param {{ forward: number, right: number, run: boolean }} intent
     * @param {number} yaw direção horizontal do olhar, em radianos
     */
    update(deltaSeconds, intent, yaw) {
      accumulator = Math.min(accumulator + deltaSeconds, settings.fixedStep * MAX_STEPS);
      // A tolerância evita perder um passo por erro de ponto flutuante.
      while (accumulator >= settings.fixedStep - 1e-9) {
        step(intent, yaw);
        accumulator -= settings.fixedStep;
      }
      interpolate(Math.max(0, accumulator) / settings.fixedStep);
    },
    stop,
    teleport,
    reset() {
      travelled = 0;
      teleport(startX, startZ);
    },
  };
}
