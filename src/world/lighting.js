/**
 * Iluminação noturna e lanterna (sem sombras dinâmicas, por desempenho).
 *
 * São apenas três luzes:
 *  - ambiente e lua, azuladas, só no chão, nas trilhas e nos troncos;
 *  - lanterna, um cone preso à câmera, em tudo (inclusive nos sprites, que já têm
 *    a cor da noite na própria tonalidade).
 * A neblina e o céu ficam em environment.js.
 */
export function createLighting(BABYLON, scene, settings) {
  const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
  ambient.diffuse = BABYLON.Color3.FromHexString(settings.ambient.color);
  ambient.groundColor = BABYLON.Color3.FromHexString(settings.ambient.groundColor);
  ambient.specular = BABYLON.Color3.Black();
  ambient.intensity = settings.ambient.intensity;

  const moon = new BABYLON.DirectionalLight(
    'moonlight',
    BABYLON.Vector3.FromArray(settings.moon.direction).normalize(),
    scene,
  );
  moon.diffuse = BABYLON.Color3.FromHexString(settings.moon.color);
  moon.specular = BABYLON.Color3.Black();
  moon.intensity = settings.moon.intensity;

  const flashlight = createFlashlight(BABYLON, scene, settings.lantern);

  return {
    ambient,
    moon,
    lantern: flashlight.light,
    flashlight,
    /** Sprites ficam fora da luz ambiente e da lua. */
    excludeFromNight(mesh) {
      for (const light of [ambient, moon]) light.excludedMeshes.push(mesh);
    },
  };
}

/** Direção do olhar para os ângulos da câmera (pitch positivo olha para baixo). */
export function viewDirection(yaw, pitch) {
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  };
}

/**
 * Lanterna: SpotLight presa à câmera. Desligar zera a intensidade em vez de
 * remover a luz, para o Chrome não precisar recompilar shaders (engasgo).
 */
export function createFlashlight(BABYLON, scene, settings) {
  const light = new BABYLON.SpotLight(
    'lantern',
    new BABYLON.Vector3(0, 0, 0),
    new BABYLON.Vector3(0, 0, 1),
    settings.angle,
    settings.exponent,
    scene,
  );
  light.diffuse = BABYLON.Color3.FromHexString(settings.color);
  light.specular = BABYLON.Color3.Black();
  light.range = settings.range;

  let on = settings.startOn;
  const apply = () => {
    light.intensity = on ? settings.intensity : 0;
  };
  apply();

  return {
    light,
    get isOn() {
      return on;
    },
    setOn(value) {
      on = Boolean(value);
      apply();
    },
    toggle() {
      this.setOn(!on);
    },
    reset() {
      this.setOn(settings.startOn);
    },
    /** Leva o feixe à posição e à direção da câmera (mão direita, um pouco abaixo). */
    follow(camera) {
      const { position, rotation } = camera;
      const [right, down] = settings.offset;
      light.position.set(
        position.x + Math.cos(rotation.y) * right,
        position.y - down,
        position.z - Math.sin(rotation.y) * right,
      );
      const direction = viewDirection(rotation.y, rotation.x);
      light.direction.set(direction.x, direction.y, direction.z);
    },
  };
}
