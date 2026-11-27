/** Passos do jogador: distância, velocidade na corrida e pausa (sem som real). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createFootsteps, stepRate, stepStride } from '../../src/audio/footsteps.js';

const settings = CONFIG.audio.footsteps;
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} x ${b}`);

/** Contexto de áudio falso: registra cada trecho tocado. */
function fakeContext({ state = 'suspended' } = {}) {
  const started = [];
  const context = {
    state,
    currentTime: 0,
    destination: {},
    started,
    decodeAudioData: async (bytes) => ({ duration: 35, bytes }),
    createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
    createBufferSource: () => {
      const source = {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        start(when, offset, duration) {
          started.push({ offset, duration, rate: source.playbackRate.value });
        },
      };
      return source;
    },
    resume: async () => {
      context.state = 'running';
    },
    suspend: () => {
      context.state = 'suspended';
    },
  };
  return context;
}

/** Sequência determinística de números em [0, 1). */
function sequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

async function ready(options = {}) {
  const context = fakeContext(options);
  const footsteps = createFootsteps(settings, {
    fetchBytes: async () => new ArrayBuffer(8),
    createContext: () => context,
    random: options.random ?? sequence([0.5]),
  });
  await footsteps.load();
  await footsteps.unlock();
  // Passa a contar a partir da posição atual do jogador.
  const player = { state: 'walking', travelled: 0 };
  footsteps.update(player);
  return { context, footsteps, player };
}

test('a corrida tem passos mais curtos e mais rápidos que a caminhada', () => {
  assert.equal(stepStride('walking', settings), settings.walkStride);
  assert.equal(stepStride('running', settings), settings.runStride);
  assert.equal(stepRate('walking', settings), settings.walkRate);
  assert.equal(stepRate('running', settings), settings.runRate);
  assert.ok(settings.runStride > settings.walkStride, 'a corrida dá passos mais espaçados em distância');
  assert.ok(settings.runRate > settings.walkRate * 1.2, 'mas toca mais rápido');
  // Em tempo, a corrida dá mais passos por segundo (5,5 u/s contra 3 u/s).
  const perSecond = (speed, stride) => speed / stride;
  assert.ok(perSecond(CONFIG.player.runSpeed, settings.runStride) > perSecond(CONFIG.player.walkSpeed, settings.walkStride));
});

test('um passo é tocado a cada distância percorrida', async () => {
  const { context, footsteps, player } = await ready();
  let steps = 0;
  for (let i = 0; i < 10; i += 1) {
    player.travelled += 0.5; // 5 unidades no total
    steps += footsteps.update(player);
  }
  assert.equal(steps, Math.floor(5 / settings.walkStride));
  assert.equal(context.started.length, steps);
  assert.equal(footsteps.played, steps);
  for (const { duration } of context.started) close(duration, settings.clipLength);
});

test('cada passo toca um trecho do arquivo, com início da lista de passos', async () => {
  const { context, footsteps, player } = await ready({ random: sequence([0, 0.5, 0.99]) });
  player.travelled += settings.walkStride * 3 + 0.01;
  footsteps.update(player);
  assert.equal(context.started.length, 3);
  for (const { offset } of context.started) assert.ok(settings.steps.includes(offset), `início ${offset} fora da lista`);
  // Nunca o mesmo passo duas vezes seguidas.
  const offsets = context.started.map((s) => s.offset);
  for (let i = 1; i < offsets.length; i += 1) assert.notEqual(offsets[i], offsets[i - 1]);
});

test('correndo, os passos tocam mais rápido e são mais frequentes', async () => {
  const walk = await ready({ random: sequence([0.5]) });
  walk.player.travelled += 6;
  walk.footsteps.update(walk.player);
  const walkRates = walk.context.started.map((s) => s.rate);

  const run = await ready({ random: sequence([0.5]) });
  run.player.state = 'running';
  run.player.travelled += 6;
  run.footsteps.update(run.player);
  const runRates = run.context.started.map((s) => s.rate);

  assert.ok(walkRates.length > 0 && runRates.length > 0);
  const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(average(runRates) > average(walkRates) * 1.3, `${average(runRates)} x ${average(walkRates)}`);
  close(average(walkRates), settings.walkRate, settings.walkRate * settings.pitchVariation);
  close(average(runRates), settings.runRate, settings.runRate * settings.pitchVariation);
});

test('em um segundo de jogo, a corrida dá mais passos que a caminhada', async () => {
  const perSecond = async (state, speed) => {
    const { context, footsteps, player } = await ready({ random: sequence([0.5]) });
    player.state = state;
    for (let i = 0; i < 60; i += 1) {
      player.travelled += speed / 60; // um segundo no ritmo da velocidade
      footsteps.update(player);
    }
    return context.started.length;
  };
  const walking = await perSecond('walking', CONFIG.player.walkSpeed);
  const running = await perSecond('running', CONFIG.player.runSpeed);
  assert.ok(running > walking, `${running} passos correndo x ${walking} andando`);
  assert.ok(walking >= 1 && running >= 2);
});

test('parado não toca passo algum', async () => {
  const { context, footsteps, player } = await ready();
  player.state = 'idle';
  for (let i = 0; i < 60; i += 1) footsteps.update(player);
  assert.equal(context.started.length, 0);
});

test('sem unlock (sem gesto do jogador) nada toca, e a distância não se acumula', async () => {
  const context = fakeContext();
  const footsteps = createFootsteps(settings, {
    fetchBytes: async () => new ArrayBuffer(8), createContext: () => context,
  });
  await footsteps.load();
  const player = { state: 'walking', travelled: 0 };
  footsteps.update(player);
  player.travelled += 10;
  assert.equal(footsteps.update(player), 0);
  assert.equal(context.started.length, 0);
});

test('pausa silencia e nenhuma distância andada na pausa vira passo', async () => {
  const { context, footsteps, player } = await ready();
  footsteps.suspend();
  assert.equal(context.state, 'suspended');
  player.travelled += 20;
  assert.equal(footsteps.update(player), 0);
  assert.equal(context.started.length, 0);
  await footsteps.unlock();
  assert.equal(context.state, 'running');
  assert.equal(footsteps.update(player), 0, 'a distância da pausa não conta');
  player.travelled += settings.walkStride;
  assert.equal(footsteps.update(player), 1);
});

test('nova exploração (distância zerada) não causa passos nem erros', async () => {
  const { footsteps, player } = await ready();
  player.travelled = 10;
  footsteps.update(player);
  player.travelled = 0; // reset do jogador
  assert.equal(footsteps.update(player), 0);
  player.travelled = settings.walkStride;
  assert.equal(footsteps.update(player), 1);
});

test('arquivo ausente: o aviso é dado e o jogo segue sem som', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const footsteps = createFootsteps(settings, {
      fetchBytes: async () => {
        throw new Error('HTTP 404');
      },
      createContext: () => fakeContext(),
    });
    assert.equal(await footsteps.load(), false);
    await footsteps.unlock();
    assert.equal(footsteps.loaded, false);
    assert.equal(footsteps.update({ state: 'walking', travelled: 9 }), 0);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /dirt_gravel\.mp3/);
});

test('arquivo corrompido não derruba o áudio: avisa e fica sem passos', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const context = fakeContext();
    context.decodeAudioData = async () => {
      throw new Error('EncodingError');
    };
    const footsteps = createFootsteps(settings, {
      fetchBytes: async () => new ArrayBuffer(8), createContext: () => context,
    });
    await footsteps.load();
    await footsteps.unlock();
    assert.equal(footsteps.loaded, false);
  } finally {
    console.warn = original;
  }
  assert.ok(warnings.some((w) => /inválido/.test(w)));
});

test('a configuração do áudio aponta para o arquivo real e tem passos em ordem', () => {
  assert.equal(settings.file, 'assets/sounds/footsteps/dirt_gravel.mp3');
  assert.ok(settings.steps.length > 30);
  for (let i = 1; i < settings.steps.length; i += 1) {
    assert.ok(settings.steps[i] > settings.steps[i - 1] + settings.clipLength * 0.9, `passos muito juntos em ${i}`);
  }
  assert.ok(settings.steps.at(-1) < 35, 'o último passo está dentro dos 35 s do arquivo');
  assert.ok(settings.volume > 0 && settings.volume <= 1);
});
