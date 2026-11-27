/**
 * Passos do jogador, tocados a cada distância percorrida.
 *
 * O arquivo de origem tem vários passos seguidos; cada um é tocado como um trecho
 * (início + duração) da mesma faixa, sem recortar nem recodificar o MP3. Na corrida
 * o trecho toca mais rápido (mais agudo e mais curto) e os passos são mais frequentes.
 *
 * Só toca depois de unlock(), chamado dentro de um clique (exigência dos navegadores).
 * Se o arquivo não carregar, o jogo segue sem som.
 */

/** Distância entre dois passos, conforme o estado do jogador. */
export function stepStride(state, settings) {
  return state === 'running' ? settings.runStride : settings.walkStride;
}

/** Velocidade de reprodução, conforme o estado do jogador (1 = original). */
export function stepRate(state, settings) {
  return state === 'running' ? settings.runRate : settings.walkRate;
}

const FADE = 0.03;

/**
 * @param {object} settings CONFIG.audio.footsteps
 * @param {{ fetchBytes?: (url: string) => Promise<ArrayBuffer>,
 *   createContext?: () => any, random?: () => number }} [deps]
 */
export function createFootsteps(settings, {
  fetchBytes = defaultFetchBytes,
  createContext = () => new window.AudioContext(),
  random = Math.random,
} = {}) {
  let bytes = null;
  let context = null;
  let output = null;
  let buffer = null;
  let decoding = null;
  let active = false;
  let progress = 0;
  let last = null;
  let previous = -1;
  let played = 0;
  let lastRate = 0;

  function pickStep() {
    const count = settings.steps.length;
    let index = Math.floor(random() * count);
    // Evita o mesmo passo duas vezes seguidas.
    if (index === previous && count > 1) index = (index + 1) % count;
    previous = index;
    return index;
  }

  function play(state) {
    const rate = stepRate(state, settings) * (1 + (random() * 2 - 1) * settings.pitchVariation);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(output);

    // Tempo real do trecho: a duração do arquivo dividida pela velocidade.
    const real = settings.clipLength / rate;
    const now = context.currentTime;
    gain.gain.setValueAtTime(1, now + Math.max(0, real - FADE));
    gain.gain.linearRampToValueAtTime(0, now + real);
    source.start(now, settings.steps[pickStep()], settings.clipLength);
    played += 1;
    lastRate = rate;
  }

  return {
    /** Lê o arquivo (sem tocar). Falhas são informadas e o jogo segue sem som. */
    async load() {
      try {
        bytes = await fetchBytes(settings.file);
        return true;
      } catch (error) {
        console.warn(`[audio] não foi possível carregar "${settings.file}" (${error.message}). Sem passos.`);
        return false;
      }
    },
    /** Liga o áudio. Chamar dentro de um clique ou tecla do jogador. */
    async unlock() {
      if (!bytes) return;
      if (!context) {
        context = createContext();
        output = context.createGain();
        output.gain.value = settings.volume;
        output.connect(context.destination);
      }
      if (!buffer) {
        decoding ??= context.decodeAudioData(bytes.slice(0)).then((decoded) => {
          buffer = decoded;
        }, (error) => {
          console.warn(`[audio] arquivo de passos inválido (${error.message}). Sem passos.`);
          bytes = null;
        });
        await decoding;
      }
      if (context.state !== 'running') await context.resume();
      active = true;
    },
    /** Silencia e pausa o áudio (pausa e menu). */
    suspend() {
      active = false;
      progress = 0;
      if (context?.state === 'running') context.suspend();
    },
    /**
     * Chamado a cada quadro durante o jogo.
     * @param {{ state: string, travelled: number }} player
     * @returns {number} passos tocados neste quadro.
     */
    update(player) {
      const travelled = player.travelled;
      // Nova exploração: a distância voltou a zero.
      if (last === null || travelled < last) last = travelled;
      const moved = travelled - last;
      last = travelled;
      if (!active || !buffer || moved <= 0 || player.state === 'idle') return 0;

      progress += moved;
      const stride = stepStride(player.state, settings);
      let count = 0;
      while (progress >= stride) {
        progress -= stride;
        play(player.state);
        count += 1;
      }
      return count;
    },
    get loaded() {
      return buffer !== null;
    },
    get active() {
      return active;
    },
    /** Passos tocados desde o início. */
    get played() {
      return played;
    },
    /** Velocidade do último passo. */
    get lastRate() {
      return lastRate;
    },
  };
}

async function defaultFetchBytes(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}
