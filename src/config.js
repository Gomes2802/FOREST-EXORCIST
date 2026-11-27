/**
 * Configurações centrais do jogo.
 * Ajustes visuais e de cena ficam aqui; a lista de sprites fica em
 * assets/sprites/manifest.json (dados, sem código).
 */
export const CONFIG = deepFreeze({
  version: '0.4.2',

  display: {
    /** Resolução de referência. O canvas se adapta à janela. */
    width: 1280,
    height: 720,
  },

  pixel: {
    /** Texels por unidade do mundo: mantém o "tamanho do pixel" igual entre sprites. */
    pixelsPerUnit: 16,
    /** Multiplicador global de resolução dos sprites (nunca amplia além do original). */
    resolutionScale: 1,
    /** Limite do maior lado de qualquer textura de sprite. */
    maxTextureSize: 256,
    /** Pixelização da imagem 3D: 1 = nativa, 2 = metade (640x360 em 1280x720). */
    renderScale: 2,
    /** 0 = preserva o canal alfa; 1..255 = força alfa binário a partir deste valor. */
    alphaCutoff: 0,
    /** 0 = preserva as cores; 2..64 = níveis por canal (posterização). */
    colorLevels: 0,
  },

  /**
   * Áudio. Os passos vêm de um arquivo com vários passos seguidos (dirt_gravel.mp3,
   * 35 s); `steps` são os inícios de cada passo, em segundos, detectados pela forma
   * de onda (ver tools/analyze-footsteps.mjs). Na corrida o trecho toca mais rápido.
   */
  audio: {
    footsteps: {
      file: 'assets/sounds/footsteps/dirt_gravel.mp3',
      /** Volume geral (0 a 1). */
      volume: 0.7,
      steps: [
        0.37, 1.42, 2.18, 2.88, 3.56, 4.24, 5.02, 5.68, 6.66, 7.45, 7.87, 8.30, 8.81, 9.47, 10.35,
        10.80, 11.65, 12.76, 13.68, 14.39, 16.08, 16.87, 17.63, 18.51, 19.42, 20.47, 21.61, 22.55,
        24.03, 26.43, 26.87, 27.50, 30.61, 31.21, 31.65, 32.77,
      ],
      /** Duração de cada trecho, em segundos do arquivo. */
      clipLength: 0.4,
      /** Distância percorrida entre dois passos, andando e correndo. */
      walkStride: 1.3,
      runStride: 1.7,
      /** Velocidade de reprodução: correndo, mais rápido e mais agudo. */
      walkRate: 1,
      runRate: 1.35,
      /** Variação aleatória da velocidade de cada passo (0 desliga). */
      pitchVariation: 0.04,
    },
  },

  /**
   * Qualidade gráfica. Só muda o que é desenhado e a resolução: alcance da cruz,
   * colisões, velocidade e controles são os mesmos em todos os níveis.
   */
  graphics: {
    /** 'auto' | 'muito-baixo' | 'baixo' | 'medio' | 'alto' */
    quality: 'auto',
    /** Ordem do mais leve ao mais pesado (o automático só desce nesta lista). */
    levels: ['muito-baixo', 'baixo', 'medio', 'alto'],
    labels: { auto: 'Automática', 'muito-baixo': 'Muito baixa', baixo: 'Baixa', medio: 'Média', alto: 'Alta' },
    /**
     * renderScale: divisor da resolução (2 = 640x360, 2.5 = 512x288, 3 = 426x240).
     * Distâncias de desenho por categoria (a neblina também limita):
     * spriteDistance árvores e pedras; smallDistance sprites baixos (arbustos,
     * plantas); grassDistance grama, cheia até grassNear e com grassFarDensity
     * (fração) no limite; shadowDistance sombras no chão.
     */
    presets: {
      'muito-baixo': {
        renderScale: 3, spriteDistance: 27, smallDistance: 14, grassDistance: 10,
        grassNear: 5, grassFarDensity: 0.35, shadowDistance: 12,
      },
      baixo: {
        renderScale: 2.5, spriteDistance: 31, smallDistance: 19, grassDistance: 13,
        grassNear: 7, grassFarDensity: 0.45, shadowDistance: 18,
      },
      medio: {
        renderScale: 2, spriteDistance: 55, smallDistance: 26, grassDistance: 18,
        grassNear: 10, grassFarDensity: 0.6, shadowDistance: 28,
      },
      alto: {
        renderScale: 2, spriteDistance: 55, smallDistance: 34, grassDistance: 24,
        grassNear: 16, grassFarDensity: 0.8, shadowDistance: 36,
      },
    },
    /**
     * Automática: começa em `start` e, se a média ficar abaixo de minFps por
     * `window` segundos de jogo, desce um nível e avisa o jogador. Nunca sobe.
     */
    auto: { start: 'medio', minFps: 28, window: 4, warmup: 2, noticeDuration: 6 },
  },

  assets: {
    spriteBasePath: 'assets/sprites/',
    spriteManifest: 'assets/sprites/manifest.json',
    groundTexture: 'assets/textures/ground.png',
    pathTexture: 'assets/textures/path.png',
  },

  lighting: {
    /** Luz da noite no chão, nas trilhas e nos troncos. */
    ambient: { color: '#6a82c4', groundColor: '#121a26', intensity: 0.62 },
    moon: { color: '#9fb8f0', intensity: 0.5, direction: [-0.4, -1, 0.35] },
    /** Lanterna presa à câmera (tecla F). */
    lantern: {
      color: '#ffe2b0',
      intensity: 3,
      /** Alcance em unidades. */
      range: 20,
      /** Abertura total do cone, em radianos. */
      angle: 1.45,
      /** Maior = centro mais forte e borda mais suave. */
      exponent: 16,
      /** Deslocamento em relação aos olhos: [para a direita, para baixo]. */
      offset: [0.25, 0.2],
      startOn: true,
    },
    /** Cor da noite aplicada aos sprites (somada à lanterna). */
    spriteTint: '#53628f',
  },

  environment: {
    /** Neblina exponencial ao quadrado: discreta perto, total ao longe. */
    fog: { color: '#16223a', density: 0.055 },
    sky: {
      zenithColor: '#040713',
      radius: 80,
      /** Altura (0..1) até onde vale a cor da neblina e extensão do degradê. */
      horizon: 0.06,
      fade: 0.45,
      /** Fração da esfera desenhada, a partir do topo (o resto fica atrás do chão). */
      slice: 0.56,
    },
    moon: { color: '#d8e0f0', radius: 2.4, offset: [-17, 24, 60] },
    /** Silhuetas no horizonte; a cor mais distante é mais próxima da neblina. */
    backdrop: {
      sprite: 'backdrop_01',
      layers: [
        { radius: 58, height: 17, color: '#152037', offset: 0.37 },
        { radius: 50, height: 11, color: '#131d32', offset: 0 },
      ],
    },
    /** Sombra no chão: sprite e tamanho em relação à largura do objeto. */
    shadow: { sprite: 'shadow_01', size: 0.95 },
    /**
     * Distância máxima de desenho = fogReach / densidade da neblina, limitada.
     * É recalculada a cada `step` unidades percorridas.
     */
    culling: {
      fogReach: 2, minDistance: 24, maxDistance: 55, step: 1.5,
      /** Sprites mais baixos que isto usam smallDistance (ver graphics.presets). */
      smallHeight: 1.5,
      /** Tamanho das regiões de grama e de sombras, em unidades. */
      grassChunk: 12, shadowChunk: 20,
    },
  },

  player: {
    startPosition: [0, 0, 0],
    /** Altura dos olhos em relação ao chão (unidades ≈ metros). */
    eyeHeight: 1.7,
    /** Velocidades em unidades por segundo. */
    walkSpeed: 3,
    runSpeed: 5.5,
    /** Variação máxima da velocidade, em unidades/s². Maior = resposta mais seca. */
    acceleration: 24,
    deceleration: 30,
    /** Elipsoide de colisão. */
    radius: 0.35,
    height: 1.8,
    /** Passo fixo da física (s): o resultado não depende da taxa de quadros. */
    fixedStep: 1 / 120,
    /** Distância máxima do centro do mapa que o jogador pode alcançar. */
    boundaryRadius: 32,
  },

  camera: {
    fov: 1.05,
    nearClip: 0.1,
    farClip: 100,
    /** Radianos por pixel de movimento do mouse. */
    mouseSensitivity: 0.0022,
    invertY: false,
    /** Limite do olhar para cima e para baixo, em graus. */
    pitchLimitDegrees: 80,
    /** Suavização da rotação (constante de tempo em segundos; 0 desliga). */
    smoothingTime: 0.025,
    /** Balanço da caminhada. Amplitudes em unidades; 0 desliga. */
    bob: {
      walkAmplitude: 0.04,
      runAmplitude: 0.075,
      /** Metade do deslocamento lateral em relação ao vertical. */
      lateralRatio: 0.5,
      /** Distância percorrida por passo. */
      walkStride: 1.5,
      runStride: 2.1,
      /** Tempo para o balanço surgir e sumir (constante de tempo em segundos). */
      blendTime: 0.12,
    },
    /** Balanço lento da câmera atrás do menu (radianos). 0 desliga. */
    idleSway: 0.12,
    idleSwayPeriod: 18,
  },

  /** Entidade de teste (fica parada na trilha, perto do início). */
  entity: {
    sprite: 'ghost_01',
    position: [1.3, 0.25, 11],
    /** Tamanho do volume detectado, em fração do sprite. */
    hitbox: { width: 0.7, height: 0.9 },
    /** Flutuação suave. */
    float: { amplitude: 0.08, period: 3.2 },
    /** Efeitos durante o exorcismo: cor, tremor e cintilação (0 desliga). */
    effects: { tint: '#ffc66e', shake: 0.07, flicker: 0.35, pulseSpeed: 11 },
    /** Desaparecimento: duração (s) e quanto ela sobe. */
    fadeDuration: 1.6,
    fadeRise: 0.9,
  },

  exorcism: {
    /** Segundos de mira necessários (com speed = 1). */
    duration: 4,
    /** Multiplicador da velocidade do progresso. */
    speed: 1,
    /** Alcance máximo, dos olhos até a entidade. */
    range: 10,
    /** Interrupção: quanto a cruz precisa estar erguida (0..1) para valer. */
    requiredRaise: 0.9,
    /** Interrupção: fração perdida por segundo ao parar (0 = o progresso fica). */
    decayPerSecond: 0,
    /** Interrupção: troncos e pedras na frente escondem a entidade. */
    blockedByObstacles: true,
    message: 'A entidade foi expulsa.',
    messageDuration: 3.5,
    /** Clarão discreto na tela ao concluir. */
    flash: true,
    /** Cruz na mão: posição em relação à câmera [direita, cima, frente]. */
    cross: {
      sprite: 'held_cross',
      height: 0.5,
      position: [0.34, -0.36, 0.9],
      /** Quanto ela desce até sair da tela. */
      loweredOffset: 0.62,
      tilt: -0.08,
      raiseTime: 0.25,
      lowerTime: 0.2,
      /** Cor na penumbra; brilha durante o exorcismo. */
      tint: '#b9ad9c',
      tremor: 0.004,
    },
  },

  forest: {
    /** Altura das malhas invisíveis de colisão. */
    colliderHeight: 5,
    seed: 1337,
    groundSize: 180,
    groundSubdivisions: 90,
    /** O chão é dividido em groundTiles x groundTiles regiões. */
    groundTiles: 3,
    groundTileSize: 4,
    pathTileSize: 2,
    /** Trilhas de terra: pontos [x, z] ligados por uma curva suave. */
    paths: [
      {
        halfWidth: 1.5,
        points: [[7, -56], [3, -42], [-4, -30], [-3, -18], [0.5, -8], [0, 0], [0, 7],
          [0.8, 14], [-2.5, 21], [-5, 28], [-1, 37], [2, 46], [0, 56]],
      },
      {
        halfWidth: 1.2,
        points: [[0.8, 14], [7, 16.5], [13, 13], [19, 6], [27, 5], [35, 10], [45, 8], [54, 12]],
      },
    ],
    /** Faixa sempre livre de cada lado do centro das trilhas. */
    pathHalfWidth: 1.4,
    /** Raio sem obstáculos em volta do ponto inicial. */
    spawnClearing: 2.2,
    /** Menor vão entre dois obstáculos (o jogador tem 0,7 de largura). */
    minSolidGap: 0.9,
    /** Só há colisão até esta distância do centro (o jogador para antes). */
    solidLimit: 36,
    /**
     * Distribuição aleatória (determinística) por grupo definido no manifesto, em
     * anéis em torno do centro. clumping agrupa em manchas (0..1); canopy afasta
     * a largura da imagem das trilhas; pathFactor multiplica a faixa livre.
     */
    layers: [
      { group: 'log', kind: 'log', count: 14, minRadius: 5, maxRadius: 31, scale: [0.8, 1.2] },
      { group: 'tree', count: 115, minRadius: 5, maxRadius: 34, scale: [0.8, 1.3], canopy: 0.5 },
      { group: 'dead_tree', count: 24, minRadius: 5, maxRadius: 34, scale: [0.8, 1.2], canopy: 0.4 },
      { group: 'tree_small', count: 60, minRadius: 4, maxRadius: 36, scale: [0.7, 1.25], canopy: 0.5 },
      { group: 'rock', count: 40, minRadius: 3, maxRadius: 33, scale: [0.55, 1.25], canopy: 0.5 },
      { group: 'vegetation', count: 190, minRadius: 2.5, maxRadius: 38, scale: [0.7, 1.35], canopy: 0.5, clumping: 0.8 },
      { group: 'plant', count: 160, minRadius: 1.5, maxRadius: 30, scale: [0.7, 1.3], clumping: 0.7 },
      { group: 'grass', kind: 'grass', count: 2200, minRadius: 1, maxRadius: 38, scale: [0.65, 1.35], clumping: 0.85, pathFactor: 0.8 },
      // Anéis externos, fora do alcance: adensam e fecham o horizonte.
      { group: 'tree', count: 340, minRadius: 34, maxRadius: 56, scale: [0.95, 1.45], canopy: 0.3 },
      { group: 'tree_small', count: 60, minRadius: 34, maxRadius: 52, scale: [0.8, 1.3], canopy: 0.3 },
    ],
    /** Objetos em posições fixas: [x, y, z]. */
    landmarks: [
      { sprite: 'cross', position: [-1.5, 0, 5] },
      { sprite: 'dead_tree_01', position: [-4.2, 0, 9] },
      { sprite: 'tree_01', position: [5.2, 0, 9.5] },
      { sprite: 'rock_01', position: [1.9, 0, 4.6] },
      { sprite: 'bush_01', position: [-2.6, 0, 4.2] },
    ],
  },
});

function deepFreeze(object) {
  Object.values(object).forEach((value) => {
    if (value && typeof value === 'object') deepFreeze(value);
  });
  return Object.freeze(object);
}
