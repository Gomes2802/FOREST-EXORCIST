/**
 * Câmera em primeira pessoa: rotação suave pelo mouse, limite vertical e balanço
 * de caminhada. A câmera só segue a posição informada; quem move é o jogador.
 */
export function createCameraController(BABYLON, scene, settings, eyeHeight, startPosition) {
  const [x, y, z] = startPosition;
  const camera = new BABYLON.FreeCamera('player', new BABYLON.Vector3(x, y + eyeHeight, z), scene);
  camera.fov = settings.fov;
  camera.minZ = settings.nearClip;
  camera.maxZ = settings.farClip;
  camera.inputs.clear(); // Os controles são tratados por core/input.js.
  scene.activeCamera = camera;

  const pitchLimit = (settings.pitchLimitDegrees * Math.PI) / 180;
  const { bob } = settings;

  // "target" é o que o mouse pediu; yaw/pitch são os valores suavizados.
  const target = { yaw: 0, pitch: 0 };
  let yaw = 0;
  let pitch = 0;
  let bobWeight = 0;
  let bobAmplitude = bob.walkAmplitude;
  let bobPhase = 0;
  let lastTravelled = 0;
  let idleTime = 0;
  const offset = { side: 0, up: 0 };

  function apply(position) {
    camera.position.set(
      position.x + Math.cos(yaw) * offset.side,
      position.y + eyeHeight + offset.up,
      position.z - Math.sin(yaw) * offset.side,
    );
    // Rotação z sempre zero: o horizonte nunca inclina.
    camera.rotation.set(pitch, yaw, 0);
  }

  return {
    camera,
    pitchLimit,
    /** Direção horizontal pedida pelo mouse (usada pelo movimento). */
    get yaw() {
      return target.yaw;
    },
    get pitch() {
      return target.pitch;
    },
    get bobOffset() {
      return { ...offset };
    },

    /** Aplica o deslocamento do mouse, em pixels. */
    look(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      target.yaw += dx * settings.mouseSensitivity;
      const direction = settings.invertY ? -1 : 1;
      const wanted = target.pitch + dy * settings.mouseSensitivity * direction;
      target.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, wanted));
    },

    /**
     * @param {number} dt
     * @param {{ position: {x:number,y:number,z:number}, state: string, travelled: number }} player
     */
    update(dt, player) {
      const smooth = settings.smoothingTime > 0 ? 1 - Math.exp(-dt / settings.smoothingTime) : 1;
      yaw += (target.yaw - yaw) * smooth;
      pitch += (target.pitch - pitch) * smooth;

      const moving = player.state !== 'idle';
      const running = player.state === 'running';
      const blend = 1 - Math.exp(-dt / bob.blendTime);
      bobWeight += ((moving ? 1 : 0) - bobWeight) * blend;
      if (moving) {
        bobAmplitude += ((running ? bob.runAmplitude : bob.walkAmplitude) - bobAmplitude) * blend;
        // A fase avança com a distância, então o ritmo segue a velocidade.
        const stride = running ? bob.runStride : bob.walkStride;
        bobPhase += (Math.max(0, player.travelled - lastTravelled) / stride) * Math.PI;
      }
      lastTravelled = player.travelled;
      if (!moving && bobWeight < 0.001) {
        bobWeight = 0;
        bobPhase = 0;
      }

      const strength = bobAmplitude * bobWeight;
      offset.up = Math.sin(bobPhase * 2) * strength;
      offset.side = Math.sin(bobPhase) * strength * bob.lateralRatio;
      apply(player.position);
    },

    /** Balanço lento usado atrás do menu. */
    updateIdle(dt, position) {
      idleTime += dt;
      yaw = Math.sin((idleTime / settings.idleSwayPeriod) * Math.PI * 2) * settings.idleSway;
      pitch = 0;
      offset.up = 0;
      offset.side = 0;
      apply(position);
    },

    reset(position = { x, y, z }) {
      target.yaw = 0;
      target.pitch = 0;
      yaw = 0;
      pitch = 0;
      bobWeight = 0;
      bobPhase = 0;
      lastTravelled = 0;
      idleTime = 0;
      offset.up = 0;
      offset.side = 0;
      apply(position);
    },
  };
}
