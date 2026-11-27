/**
 * Sons da entidade: estrutura pronta, ainda sem arquivos.
 *
 * Cada som é opcional (CONFIG.audio.entity). Sem arquivo configurado, nada é
 * carregado, nenhum contexto de áudio é criado e nada é processado. Para ativar,
 * coloque o arquivo em assets/sounds/ e informe o caminho.
 *
 *   appear     ao surgir            vanish    ao desaparecer
 *   presence   em laço enquanto presente      exorcised ao ser expulsa
 */

export const ENTITY_CUES = Object.freeze(['appear', 'presence', 'vanish', 'exorcised']);

/**
 * @param {{ volume: number } & Record<string, string|null>} settings
 * @param {{ fetchBytes?: (url: string) => Promise<ArrayBuffer>,
 *   createContext?: () => any }} [deps]
 */
export function createEntitySounds(settings, {
  fetchBytes = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  },
  createContext = () => new window.AudioContext(),
} = {}) {
  const files = new Map();
  const buffers = new Map();
  let context = null;
  let output = null;
  let loop = null;
  let active = false;
  let wantsPresence = false;

  function start(name, looping = false) {
    if (!active || !buffers.has(name)) return null;
    const source = context.createBufferSource();
    source.buffer = buffers.get(name);
    source.loop = looping;
    source.connect(output);
    source.start();
    return source;
  }

  function refreshPresence() {
    if (wantsPresence && active && !loop) loop = start('presence', true);
    else if (!wantsPresence && loop) {
      loop.stop();
      loop = null;
    }
  }

  return {
    async load() {
      await Promise.all(ENTITY_CUES.filter((name) => settings[name]).map(async (name) => {
        try {
          files.set(name, await fetchBytes(settings[name]));
        } catch (error) {
          console.warn(`[audio] não foi possível carregar "${settings[name]}" (${error.message}).`);
        }
      }));
    },
    /** Chamar dentro de um clique do jogador. */
    async unlock() {
      if (files.size === 0) return;
      if (!context) {
        context = createContext();
        output = context.createGain();
        output.gain.value = settings.volume;
        output.connect(context.destination);
        await Promise.all([...files].map(async ([name, bytes]) => {
          try {
            buffers.set(name, await context.decodeAudioData(bytes.slice(0)));
          } catch (error) {
            console.warn(`[audio] arquivo de "${name}" inválido (${error.message}).`);
          }
        }));
      }
      if (context.state !== 'running') await context.resume();
      active = true;
      refreshPresence();
    },
    suspend() {
      active = false;
      if (context?.state === 'running') context.suspend();
    },
    /** @param {'appear'|'vanish'|'gone'|'exorcised'|'reset'} name acontecimento da entidade */
    event(name) {
      if (name === 'appear') wantsPresence = true;
      if (name === 'vanish' || name === 'exorcised' || name === 'reset') wantsPresence = false;
      refreshPresence();
      if (name === 'appear' || name === 'vanish' || name === 'exorcised') start(name);
    },
  };
}
