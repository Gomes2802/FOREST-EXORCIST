/**
 * Detecta os inícios dos passos em assets/sounds/footsteps/dirt_gravel.mp3, pela
 * forma de onda (usa o Chrome, que decodifica o MP3). A saída é a lista `steps`
 * de CONFIG.audio.footsteps.
 *
 *   node tools/analyze-footsteps.mjs [caminho-do-arquivo]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, startServer } from '../tests/helpers/chrome.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? 'assets/sounds/footsteps/dirt_gravel.mp3';

const server = await startServer(root);
const page = await launchChrome();
try {
  await page.open(`${server.url}index.html`);
  await page.waitFor('document.readyState === "complete"');
  const result = await page.evaluate(`(async () => {
    const bytes = await (await fetch(${JSON.stringify(file)})).arrayBuffer();
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(bytes);
    const data = buffer.getChannelData(0);
    const win = Math.round(buffer.sampleRate * 0.01);
    const env = [];
    for (let i = 0; i + win <= data.length; i += win) {
      let sum = 0;
      for (let j = 0; j < win; j += 1) sum += data[i + j] * data[i + j];
      env.push(Math.sqrt(sum / win));
    }
    const peak = Math.max(...env);
    // Início: o sinal sobe acima de 12% do pico depois de pelo menos 0,25 s de silêncio.
    const steps = [];
    let quiet = 25;
    let lastOnset = -1000;
    env.forEach((value, k) => {
      const loud = value > peak * 0.12;
      if (loud && quiet >= 25 && k - lastOnset > 40) {
        steps.push(+(k * 0.01).toFixed(2));
        lastOnset = k;
      }
      quiet = loud ? 0 : quiet + 1;
    });
    return { seconds: +buffer.duration.toFixed(2), sampleRate: buffer.sampleRate, steps };
  })()`);
  console.log(`Arquivo: ${file} (${result.seconds} s, ${result.sampleRate} Hz)`);
  console.log(`Passos detectados: ${result.steps.length}`);
  console.log(result.steps.map((s) => s.toFixed(2)).join(', '));
} finally {
  await page.close();
  await server.close();
}
