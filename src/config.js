/**
 * Configurações centrais do jogo.
 * Ajustes visuais e de cena ficam aqui; a lista de sprites fica em
 * assets/sprites/manifest.json (dados, sem código).
 */
import { INVESTIGATION } from './content/investigation.js';

export const CONFIG = deepFreeze({
  version: '0.7.1',

  /** Etapa 7: documentos, objetivos e descobertas (src/content/investigation.js). */
  investigation: INVESTIGATION,

  /**
   * Itens que podem ir para a mão. `slot` é a tecla numérica; o `id` liga o item
   * ao seu controlador (Game.equipment).
   */
  items: [{ id: 'cross', slot: 1, name: 'Cruz' }],

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
    /**
     * Sons da entidade: ainda não há arquivos. Informe um caminho (ex.:
     * 'assets/sounds/entity/appear.mp3') para ativar cada um.
     */
    entity: {
      appear: null, presence: null, vanish: null, exorcised: null,
      exorcising: 'assets/sounds/entity/exorcism.mp3',
      volume: 0.6,
    },
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
        renderScale: 1.5, spriteDistance: 55, smallDistance: 26, grassDistance: 18,
        grassNear: 10, grassFarDensity: 0.6, shadowDistance: 28,
      },
      alto: {
        renderScale: 1.5, spriteDistance: 55, smallDistance: 34, grassDistance: 24,
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
    /** Texturas das construções (substituíveis, como o chão). */
    buildingTextures: {
      planks: 'assets/textures/cabin/planks.png',
      floor: 'assets/textures/cabin/floor.png',
      roof: 'assets/textures/cabin/roof.png',
      books: 'assets/textures/cabin/books.png',
      paper: 'assets/textures/cabin/paper.png',
      portrait: 'assets/textures/cabin/portrait.png',
    },
  },

  lighting: {
    /** Luz da noite no chão, nas trilhas e nos troncos. */
    ambient: { color: '#4d5f8c', groundColor: '#0b1019', intensity: 0.5 },
    moon: { color: '#8093c0', intensity: 0.4, direction: [-0.4, -1, 0.35] },
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
    spriteTint: '#3b4766',
    /** Penumbra dentro das construções (além da lamparina e da lanterna). */
    interiorColor: '#1c2030',
    /** Brilho próprio, fraco, das pistas ao ar livre: achá-las sem a lanterna. */
    clueGlow: '#2b2a24',
  },

  environment: {
    /** Neblina exponencial ao quadrado: discreta perto, total ao longe. */
    fog: { color: '#0b1426', density: 0.055 },
    sky: {
      zenithColor: '#020309',
      radius: 80,
      /** Altura (0..1) até onde vale a cor da neblina e extensão do degradê. */
      horizon: 0.06,
      fade: 0.45,
      /** Fração da esfera desenhada, a partir do topo (o resto fica atrás do chão). */
      slice: 0.56,
    },
    moon: { color: '#aab5cc', radius: 2.4, offset: [-17, 24, 60] },
    /** Silhuetas no horizonte; a cor mais distante é mais próxima da neblina. */
    backdrop: {
      sprite: 'backdrop_01',
      layers: [
        { radius: 58, height: 17, color: '#0e1628', offset: 0.37 },
        { radius: 50, height: 11, color: '#0b1322', offset: 0 },
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
      /** Limites da floresta enquanto o jogador está dentro de uma construção. */
      indoor: { spriteDistance: 30, smallDistance: 15, grassDistance: 9, shadowDistance: 12 },
      /** O interior das construções só é desenhado até esta distância. */
      interiorDistance: 22,
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

  /** Textura usada por cada parte das construções. */
  buildingMaterials: {
    outside: 'planks', inside: 'planks', door: 'planks', wood: 'planks',
    floor: 'floor', roof: 'roof', books: 'books', paper: 'paper', portrait: 'portrait',
    /** Pistas ao ar livre (uma textura clara; o tom vem de cada peça). */
    clue: 'paper',
  },

  /**
   * Construções da floresta. As posições `at` são relativas ao centro: [x, z] nos
   * móveis e [x, altura, z] nos objetos examináveis e na lamparina.
   */
  buildings: [
    {
      id: 'cabin',
      type: 'cabin',
      seed: 41,
      /** A sudoeste do início: fora da vista de quem começa olhando para o norte. */
      center: [-17, -12],
      size: [6, 5],
      wallHeight: 2.7,
      wallThickness: 0.2,
      /** Porta na parede leste; reach: alcance da tecla E; speed: segundos. */
      door: { width: 1.3, height: 2.2, openAngle: 1.75, speed: 0.5, reach: 2.6 },
      windows: [
        { wall: 'north', offset: -0.6, width: 1.2, bottom: 0.95, top: 1.95 },
        { wall: 'south', offset: 0.5, width: 1.2, bottom: 0.95, top: 1.95 },
        { wall: 'west', offset: -0.4, width: 1.1, bottom: 0.95, top: 1.95 },
      ],
      roof: { overhang: 0.45, rise: 1.5 },
      /** Faixa sem vegetação em volta (soma-se à largura de cada imagem). */
      clearing: 1.2,
      anchorClearing: 1.4,
      /** Onde uma entidade pode aparecer: fora das janelas e diante da porta. */
      anchorDistance: 2.4,
      entranceDistance: 5,
      lamp: { at: [-2.0, 1.02, 1.55], color: '#ffb866', glow: '#ffd08a', intensity: 0.9, range: 7, flicker: 0.07 },
      furniture: [
        { type: 'table', at: [-1.85, 1.65], size: [1.5, 0.9], height: 0.82, solid: true },
        { type: 'chair', at: [-1.75, 0.55], size: [0.55, 0.55], height: 1.1, solid: true },
        { type: 'shelf', at: [-1.9, -2.08], size: [1.6, 0.42], height: 2.05, solid: true },
        { type: 'wardrobe', at: [1.6, 1.97], size: [1.15, 0.6], height: 2.05, solid: true },
        { type: 'crate', at: [2.15, -1.8], size: [0.8, 0.8], height: 0.7, solid: true },
        { type: 'papers', at: [-1.55, 1.55], size: [0.7, 0.5], height: 0.82 },
        { type: 'books', at: [2.15, -1.8], size: [0.4, 0.3], height: 0.7 },
        { type: 'portrait', at: [-2.76, 0.65], size: [0.07, 0.7], height: 1.6 },
      ],
      examinables: [
        {
          id: 'papers', name: 'os papéis', at: [-1.55, 0.9, 1.55],
          message: '"Ela olha de volta quando a encaro. Com a cruz erguida, não foge."',
        },
        {
          id: 'shelf', name: 'a estante', at: [-1.9, 1.2, -1.9],
          message: 'Livros inchados de umidade. Alguém marcou à força a página de uma oração.',
        },
        {
          id: 'wardrobe', name: 'o armário', at: [1.6, 1.25, 1.65],
          message: 'Vazio, exceto por um casaco que ainda cheira a fumaça.',
        },
        {
          id: 'chair', name: 'a cadeira', at: [-1.75, 0.7, 0.55],
          message: 'Afastada da mesa, como se alguém tivesse se levantado às pressas.',
        },
        {
          id: 'portrait', name: 'o retrato', at: [-2.7, 1.6, 0.65],
          message: 'Uma família diante desta cabana. Os rostos foram riscados.',
        },
        {
          id: 'crate', name: 'o caixote', at: [2.15, 0.85, -1.8],
          message: 'Velas gastas e um terço partido. Quem morou aqui também tentou expulsar algo.',
        },
      ],
    },
  ],

  /** Interação com a tecla E. */
  interaction: {
    /** Ângulo máximo entre o centro da tela e o objeto, em graus. */
    angle: 32,
    /** Distância até a construção a partir da qual se procura algo. */
    nearby: 9,
    messageDuration: 5.5,
    prompts: { open: 'Abrir a porta', close: 'Fechar a porta', examine: 'Examinar', read: 'Ler' },
    blockedDoor: 'Saia do vão para fechar a porta.',
  },

  /** Regras entre entidades. */
  encounters: {
    /** Presentes ao mesmo tempo, no máximo. */
    maxActive: 2,
    /** Segundos entre aparições de entidades diferentes. */
    minGap: 5,
    /** Distância e ângulo (graus, vistos pelo jogador) mínimos entre duas. */
    separation: 9,
    separationAngle: 18,
  },

  /**
   * Tipos de entidade. `visual` substitui valores de `entity`, `behavior` os de
   * `haunting`, e `exorcism` os de `exorcism`.
   */
  entityTypes: [
    /** A original: usa os valores gerais. */
    { id: 'ghost', name: 'Entidade', behavior: { anchorChance: 0.25 } },
    {
      /** Aparece mais longe, observa por muito tempo e muda de lugar sem ser vista. */
      id: 'watcher',
      name: 'Observadora',
      visual: {
        sprite: 'watcher_01',
        hover: 0.05,
        turnSpeed: 0.55,
        moodTints: { shy: '#c2c8dc' },
        float: { amplitude: 0.025, period: 6 },
        stare: { period: 8, duration: 2.2, stretch: 0.05 },
        effects: { shake: 0.04, flicker: 0.25 },
      },
      behavior: {
        first: { delay: 30 },
        interval: { min: 18, max: 30 },
        stay: { min: 12, max: 20 },
        appearTime: 3,
        disappearTime: 2,
        minDistance: 16,
        maxDistance: 26,
        minVisibility: 0.12,
        maxObserveDistance: 34,
        fleeDistance: 7,
        moods: { shy: 1 },
        shyDistance: 15,
        shyAfter: 4.5,
        look: { opacity: [0.85, 1], scale: [0.95, 1.08] },
        anchorChance: 0.75,
        relocate: { max: 2, wait: 2.5, unseenFor: 1, minStep: 3, maxStep: 7, hiddenAngle: 62 },
      },
      exorcism: { duration: 2.6, message: 'A observadora foi expulsa.' },
    },
    {
      /** Aparições curtas, aos saltos; ao sumir, pode voltar logo em outro ponto. */
      id: 'unstable',
      name: 'Instável',
      visual: {
        sprite: 'wisp_01',
        hover: 0.45,
        turnSpeed: 3,
        moodTints: { still: '#d9dfea' },
        float: { amplitude: 0.18, period: 1.4 },
        stare: { period: 2, duration: 0.5, stretch: 0.18 },
        effects: { shake: 0.12, flicker: 0.45, pulseSpeed: 17, jitter: 0.14, jitterRate: 9, idleFlicker: 0.45 },
      },
      behavior: {
        first: { delay: 50 },
        interval: { min: 14, max: 26 },
        stay: { min: 3.5, max: 6 },
        appearTime: 0.9,
        disappearTime: 0.8,
        fleeDisappearTime: 0.4,
        minDistance: 10,
        maxDistance: 18,
        fleeDistance: 4,
        moods: { still: 1 },
        resumeGrace: 4,
        look: { opacity: [0.75, 0.95], scale: [0.85, 1.15] },
        anchorChance: 0.2,
        blink: { chance: 0.65, max: 2, delay: { min: 0.7, max: 1.6 } },
      },
      exorcism: { duration: 1.6, message: 'A presença instável se desfez.' },
    },
  ],

  /** Aparência da entidade (padrão; cada tipo pode substituir). */
  entity: {
    sprite: 'ghost_01',
    /** Altura em que flutua acima do chão. */
    hover: 0.25,
    /** Velocidade com que se volta para o jogador, em radianos por segundo. */
    turnSpeed: 0.9,
    /** Cor de base de cada humor (ver haunting.moods). */
    moodTints: { still: '#d9dfea', shy: '#97a4c0', elusive: '#9fb8a8' },
    /** De tempos em tempos "encara": clareia e se estica. */
    stare: { period: 5, duration: 1.2, stretch: 0.06 },
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

  /** Comportamento da entidade (tempos em segundos, distâncias em unidades). */
  haunting: {
    /** Primeira aparição depois de começar a explorar. */
    first: { delay: 6 },
    /** Intervalo sorteado entre desaparecer e aparecer de novo. */
    interval: { min: 8, max: 18 },
    /** Nova tentativa quando não há lugar adequado. */
    retryDelay: 1,
    /** Quanto tempo observa antes de partir. */
    stay: { min: 6, max: 14 },
    /** Duração do surgimento e do desaparecimento (o de fuga é mais rápido). */
    appearTime: 1.8,
    disappearTime: 1.6,
    fleeDisappearTime: 0.7,
    /** Fração do surgimento a partir da qual pode ser mirada. */
    targetableAt: 0.5,

    /** Distância de aparição até o jogador. */
    minDistance: 12,
    maxDistance: 22,
    /** Só aparece onde a neblina ainda deixa passar esta fração da imagem. */
    minVisibility: 0.25,
    /** Ângulo em relação ao olhar (graus): nem no centro, nem às costas. */
    minViewAngle: 14,
    maxViewAngle: 48,
    /** Folga em volta de objetos e distância mínima do lugar anterior. */
    clearance: 1,
    minRespawnGap: 8,
    /**
     * Pontos que precisam estar visíveis ao surgir: [afastamento lateral, altura].
     * Corpo (centro e lados) e cabeça.
     */
    sightPoints: [[0, 1.5], [-0.5, 1.5], [0.5, 1.5], [0, 2.3]],
    /**
     * Se nenhum lugar passar, as regras afrouxam nesta ordem (distância, objetos e
     * centro do corpo visível valem sempre).
     */
    /** Quanto do raio da folhagem conta como obstrução (1 = tudo). */
    foliageScale: 1,
    fallbacks: [
      { foliageScale: 0.7 },
      { foliageScale: 0.7, sightPoints: [[0, 1.5], [0, 2.3]] },
      { foliageScale: 0.5, sightPoints: [[0, 1.5]], maxViewAngle: 100 },
    ],
    /** Sorteios por tentativa, candidatos comparados e preferência pelas trilhas. */
    attempts: 120,
    candidates: 6,
    pathDistance: 5,
    pathWeight: 3,

    /** Observação: some se o jogador ficar mais longe que isto... */
    maxObserveDistance: 30,
    /** ...ou chegar mais perto que isto (menor que o alcance da cruz). */
    fleeDistance: 5,
    /** Ângulo do olhar que conta como "olhando para ela" (graus). */
    gazeAngle: 25,
    /** Humor tímido: encarada a até shyDistance por shyAfter segundos. */
    shyDistance: 14,
    shyAfter: 3,
    /** Humor esquivo: segundos sem contato visual, depois de vista. */
    lookAwayAfter: 1.5,
    /** Tempo de graça depois de um exorcismo interrompido. */
    resumeGrace: 6,
    /**
     * Aparições junto a construções (janelas e entrada): chance por tipo
     * (anchorChance), distâncias aceitas e fuga mais curta, pois há uma parede.
     */
    anchorChance: 0,
    anchorMinDistance: 3.5,
    anchorMaxDistance: 18,
    /** Menor que o das aparições comuns: há parede e moldura no caminho. */
    anchorMinViewAngle: 7,
    anchorViewAngle: 60,
    anchorFleeDistance: 2.8,
    /** Intervalo entre verificações de visão e passo fixo da lógica. */
    senseInterval: 0.1,
    step: 1 / 60,
    /** Pesos dos comportamentos; o mesmo não se repete em seguida. */
    moods: { still: 0.5, shy: 0.25, elusive: 0.25 },
    /** Variação visual sorteada a cada aparição. */
    look: { opacity: [0.82, 1], scale: [0.92, 1.1] },
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
      /** Imagem em repouso e folha de animação de uso (quadros lado a lado). */
      sprite: 'held_cross',
      useSprite: 'using_cross',
      frames: 5,
      /** Quadros por segundo; loop false para no último enquanto o botão durar. */
      fps: 12,
      loop: false,
      /**
       * Fração transparente à esquerda e no topo de cada quadro, que não é
       * desenhada. Ajuste se trocar a arte (um teste confere as imagens).
       */
      crop: { left: 0.31, top: 0.27 },
      height: 0.66,
      position: [0.36, -0.29, 0.9],
      /** Quanto ela desce até sair da tela ao ser guardada. */
      loweredOffset: 0.62,
      tilt: -0.08,
      raiseTime: 0.25,
      lowerTime: 0.2,
      /** Cor na penumbra. */
      tint: '#ffffff',
      /**
       * Movimento da mão ao equipar e guardar: omega (rapidez) e zeta (amortecimento; abaixo de 1 há
       * um pequeno sobrepasso). arcX é quanto a cruz vem da direita, arcTilt a
       * inclinação ao sair, sway o atraso do pulso.
       */
      motion: { omega: 13, zeta: 0.55, arcX: 0.12, arcTilt: 0.32, sway: 0.02 },
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
      // Picada até a porta da cabana.
      {
        halfWidth: 1,
        points: [[-1.5, -13], [-4.5, -10.8], [-8, -10.6], [-11, -12.3], [-13.4, -12]],
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
