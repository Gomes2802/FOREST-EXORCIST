/**
 * Cruz segurada pelo jogador, presa à câmera. Três estados:
 *  - "unequipped": guardada, fora da tela;
 *  - "equipped_idle": na mão, parada, com o sprite de repouso;
 *  - "equipped_using": botão esquerdo pressionado, tocando a folha de animação.
 *
 * A aparência é separada do comportamento: para trocar por um modelo, passe outra
 * `createVisual` que devolva { mesh, show(quadro|null), dispose() }.
 */
import { createPixelTexture, createSpriteMaterial } from '../graphics/materials.js';

export const CROSS_STATES = Object.freeze({
  UNEQUIPPED: 'unequipped',
  IDLE: 'equipped_idle',
  USING: 'equipped_using',
});

/** Grupo de renderização próprio: desenhada por cima do cenário. */
const HAND_GROUP = 2;

/**
 * Quanto do gesto de erguer já passou (0 a 1), em tempo real (independe do FPS).
 * É a regra do exorcismo: o progresso só começa depois de `threshold`.
 * @param {{ raiseTime: number, lowerTime: number }} settings
 * @param {number} threshold fração a partir da qual ela vale como erguida
 */
export function createRaise({ raiseTime, lowerTime }, threshold) {
  let amount = 0;
  return {
    get amount() {
      return amount;
    },
    /** @returns {number} quantos segundos deste passo ela passou erguida. */
    update(dt, holding) {
      if (!holding) {
        amount = Math.max(0, amount - dt / lowerTime);
        if (amount < 1e-6) amount = 0;
        return 0;
      }
      const before = amount;
      amount = Math.min(1, amount + dt / raiseTime);
      if (amount > 1 - 1e-6) amount = 1;
      if (before >= threshold) return dt;
      if (amount < threshold) return 0;
      return Math.max(0, dt - (threshold - before) * raiseTime);
    },
    reset() {
      amount = 0;
    },
  };
}

/**
 * Quadro atual de uma animação, pelo tempo decorrido. Avança no máximo um quadro
 * por atualização: abaixo de `fps` quadros de tela por segundo a animação fica
 * mais lenta, mas nenhum desenho é pulado.
 * @param {{ frames: number, fps: number, loop: boolean }} settings
 *   loop false: para no último quadro até ser reiniciada.
 */
export function createFrameClock({ frames, fps, loop }) {
  const period = 1 / fps;
  let frame = -1;
  let elapsed = 0;
  return {
    /** A primeira chamada depois de reset() devolve o quadro 0. */
    update(dt) {
      if (frame < 0) {
        frame = 0;
        return frame;
      }
      if (!loop && frame === frames - 1) return frame;
      elapsed += dt;
      if (elapsed >= period - 1e-9) {
        // A sobra vale para o próximo quadro, mas nunca mais que um período.
        elapsed = Math.min(elapsed - period, period);
        frame = (frame + 1) % frames;
      }
      return frame;
    },
    reset() {
      frame = -1;
      elapsed = 0;
    },
  };
}

/**
 * Visual padrão: um único plano e um único material. Usar a cruz troca a textura
 * (já enviada à placa) e, a cada quadro novo, as quatro coordenadas do plano.
 * Trocar de material faria o Babylon.js recompilar o shader a cada uso.
 *
 * O plano cobre apenas a parte da imagem que tem desenho (`crop`): o resto é
 * transparente e custaria preenchimento à toa sem placa de vídeo.
 */
export function createSpriteCrossVisual(BABYLON, scene, { settings, spriteManager, pixelRenderer }) {
  const record = spriteManager.get(settings.sprite);
  const sheet = spriteManager.get(settings.useSprite);
  const { left, top } = settings.crop;
  const fullWidth = settings.height * record.aspect;
  const width = fullWidth * (1 - left);
  const height = settings.height * (1 - top);

  const mesh = BABYLON.MeshBuilder.CreatePlane('held-cross', { width, height, updatable: true }, scene);
  // Mantém a imagem no mesmo lugar: o recorte tira só a esquerda e o topo.
  mesh.position.set((fullWidth * left) / 2, (-settings.height * top) / 2, 0);
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  /** Coordenadas de textura do quadro `index` numa folha com `count` quadros. */
  const frameUvs = (index, count) => {
    const uvs = new Float32Array((positions.length / 3) * 2);
    for (let i = 0; i < positions.length / 3; i += 1) {
      const u = left + (positions[i * 3] / width + 0.5) * (1 - left);
      uvs[i * 2] = (index + u) / count;
      uvs[i * 2 + 1] = (positions[i * 3 + 1] / height + 0.5) * (1 - top);
    }
    return uvs;
  };
  // Sprite ausente: o xadrez de aviso é mostrado inteiro, sem fatiar.
  const count = sheet.status === 'loaded' ? settings.frames : 1;
  const idleUvs = frameUvs(0, 1);
  const useUvs = Array.from({ length: count }, (_, index) => frameUvs(index, count));
  mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, idleUvs, true);

  const material = createSpriteMaterial(BABYLON, scene, record, { pixelRenderer, tint: settings.tint });
  material.fogEnabled = false;
  mesh.material = material;
  const idle = material.diffuseTexture;
  const using = createPixelTexture(BABYLON, scene, sheet.canvas, pixelRenderer, 'sprite');
  using.hasAlpha = true;

  return {
    mesh,
    /** @param {number|null} frame quadro da animação; null = repouso. */
    show(frame) {
      const texture = frame === null ? idle : using;
      if (material.diffuseTexture !== texture) material.diffuseTexture = texture;
      mesh.updateVerticesData(BABYLON.VertexBuffer.UVKind, frame === null ? idleUvs : useUvs[frame % count]);
    },
    dispose() {
      mesh.dispose();
      material.dispose();
      idle.dispose();
      using.dispose();
    },
  };
}

/** Passo fixo da mola: o movimento não depende da taxa de quadros. */
const SPRING_STEP = 1 / 120;

/**
 * Movimento da mão ao equipar e guardar: a cruz sobe em arco, vinda da direita e
 * de baixo, com uma mola amortecida (ultrapassa um pouco e assenta, como um punho
 * real). Só afeta o desenho.
 */
export function createHandMotion({ omega, zeta }) {
  let position = 0;
  let velocity = 0;
  return {
    /** 0 = guardada, 1 = na mão (pode passar de 1 por um instante). */
    get position() {
      return position;
    },
    get velocity() {
      return velocity;
    },
    /** @returns {void} avança a mola até o alvo, em passos fixos. */
    follow(target, dt) {
      let remaining = Math.min(Math.max(dt, 0), 0.1);
      while (remaining > 1e-9) {
        const step = Math.min(SPRING_STEP, remaining);
        remaining -= step;
        const acceleration = omega * omega * (target - position) - 2 * zeta * omega * velocity;
        velocity += acceleration * step;
        position += velocity * step;
      }
      // Diferença já invisível: para de vez, e a cruz fica imóvel na tela.
      if (Math.abs(target - position) < 1e-3 && Math.abs(velocity) < 2e-2) {
        position = target;
        velocity = 0;
      }
    },
    reset() {
      position = 0;
      velocity = 0;
    },
  };
}

export function createCross(BABYLON, scene, camera, { settings, requiredRaise, createVisual }) {
  const raise = createRaise(settings, requiredRaise);
  /** Alvo da mão ao equipar e guardar: avança no tempo, e a mola o segue. */
  const reach = createRaise(settings, 1);
  const hand = createHandMotion(settings.motion);
  const clock = createFrameClock(settings);
  const root = new BABYLON.TransformNode('cross', scene);
  root.parent = camera;
  let visual = null;
  let equipped = false;
  /** Só um aperto feito com a cruz já na mão a usa. */
  let armed = true;
  /** Quadro da animação em uso, ou null em repouso. */
  let frame = null;

  function build() {
    visual?.dispose();
    visual = createVisual();
    visual.mesh.parent = root;
    visual.mesh.renderingGroupId = HAND_GROUP;
    visual.mesh.isPickable = false;
    visual.mesh.alwaysSelectAsActiveMesh = true;
    visual.show(frame);
  }

  function show(next) {
    if (next === frame) return;
    frame = next;
    visual.show(frame);
  }

  /** Posição da mão. Não muda durante o uso: só ao equipar e guardar. */
  function place() {
    const [x, y, z] = settings.position;
    const { arcX, arcTilt, sway } = settings.motion;
    const p = hand.position;
    const lower = 1 - p;
    // A mão vem da direita e de baixo; o pulso fica para trás do movimento.
    root.position.set(x + lower * arcX, y - lower * settings.loweredOffset, z);
    root.rotation.z = settings.tilt - lower * arcTilt - hand.velocity * sway;
    root.setEnabled(equipped || Math.abs(p) > 1e-3);
  }

  function stopUsing() {
    clock.reset();
    show(null);
  }

  build();
  place();

  return {
    root,
    get mesh() {
      return visual.mesh;
    },
    get state() {
      if (!equipped) return CROSS_STATES.UNEQUIPPED;
      return frame === null ? CROSS_STATES.IDLE : CROSS_STATES.USING;
    },
    get using() {
      return frame !== null;
    },
    get frame() {
      return frame;
    },
    /** Quanto do gesto de uso já passou (0 a 1). */
    get amount() {
      return raise.amount;
    },
    get visible() {
      return root.isEnabled(false);
    },
    /**
     * @param {boolean} value equipar (true) ou guardar (false)
     * @param {boolean} [holding] o botão de uso já estava pressionado
     */
    equip(value, holding = false) {
      equipped = Boolean(value);
      armed = !holding;
      stopUsing();
      place();
    },
    /** @returns {number} segundos deste passo com a cruz erguida. */
    update(dt, holding) {
      if (!holding) armed = true;
      const using = equipped && armed && holding;
      const ready = raise.update(dt, using);
      if (using) show(clock.update(dt));
      else if (frame !== null) stopUsing();
      const goal = Number(equipped);
      // Parada na mão ou guardada, não há nada a recalcular.
      if (reach.amount !== goal || hand.position !== goal || hand.velocity !== 0) {
        reach.update(dt, equipped);
        hand.follow(reach.amount, dt);
        place();
      }
      return ready;
    },
    /** Pausa e telas abertas: encerra o uso na hora e mantém a cruz equipada. */
    interrupt() {
      raise.reset();
      stopUsing();
    },
    reset() {
      equipped = false;
      armed = true;
      raise.reset();
      reach.reset();
      hand.reset();
      stopUsing();
      place();
    },
    /** Recria o visual (nova resolução dos sprites), mantendo o estado. */
    refresh() {
      build();
    },
    /** Desenha cada aparência uma vez no carregamento (compila e envia à GPU). */
    async prime(draw) {
      const enabled = root.isEnabled(false);
      root.setEnabled(true);
      for (const view of [0, null]) {
        visual.show(view);
        await draw(visual.mesh);
      }
      visual.show(frame);
      root.setEnabled(enabled);
    },
    dispose() {
      visual.dispose();
      root.dispose();
    },
  };
}
