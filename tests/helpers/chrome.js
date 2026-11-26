/**
 * Controle mínimo do Google Chrome pelo protocolo DevTools, usando apenas o
 * Node (>= 22). Também inicia o servidor local do jogo.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const KEY_CODES = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyF: 70, ShiftLeft: 16 };

export const findChrome = () => CANDIDATES.find((path) => path && existsSync(path));

export async function startServer(directory) {
  // No Windows, "python3" costuma ser apenas o atalho da loja de aplicativos.
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(python, [join(directory, 'serve.py'), '--port', '0', '--no-browser'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`servidor encerrou (${code})`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) resolve(match[0]);
    });
  });
  return {
    url,
    async close() {
      if (child.exitCode !== null) return;
      child.kill();
      await once(child, 'exit');
    },
  };
}

/**
 * @param {{ display?: string, visible?: boolean }} [options]
 *   display: tela X para abrir com janela (Linux); visible: janela comum.
 */
export async function launchChrome({ display, visible = Boolean(process.env.FE_VISIBLE) } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'fe-chrome-'));
  // Por padrão usa WebGL por software (funciona sem GPU). FE_GPU=1 usa a GPU.
  const graphics = process.env.FE_GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'linux' ? ['--use-angle=gl'] : [])]
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  let windowFlags = ['--headless=new'];
  if (display) windowFlags = ['--kiosk', '--window-position=0,0', '--ozone-platform=x11', '--password-store=basic'];
  else if (visible) windowFlags = ['--window-position=0,0', '--disable-backgrounding-occluded-windows'];
  const child = spawn(findChrome(), [
    ...windowFlags,
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1280,720',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    // Simula computador sem internet: só o servidor local é alcançável.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ...graphics,
    'about:blank',
  ], {
    stdio: 'ignore',
    env: display ? { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '' } : process.env,
  });

  const portFile = join(profile, 'DevToolsActivePort');
  let target;
  for (let attempt = 0; attempt < 200 && !target; attempt += 1) {
    await delay(100);
    if (!existsSync(portFile)) continue;
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    if (!port) continue;
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((item) => item.type === 'page');
  }
  if (!target) {
    child.kill();
    throw new Error('Chrome não respondeu.');
  }

  const page = await connectPage(target.webSocketDebuggerUrl);
  if (!display) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }
  page.close = async () => {
    // Encerramento limpo: os processos auxiliares do Chrome param de gravar no
    // perfil antes de ele ser apagado. Se não responder, o processo é encerrado.
    const exited = child.exitCode === null ? once(child, 'exit') : Promise.resolve();
    page.send('Browser.close').catch(() => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
    page.socket.close();
    await delay(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return page;
}

export async function connectPage(address) {
  const socket = new WebSocket(address);
  await once(socket, 'open');
  let sequence = 0;
  const waiting = new Map();
  const log = { errors: [], warnings: [], requests: [] };

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    const { method, params } = message;
    if (method === 'Runtime.consoleAPICalled') {
      const text = params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (params.type === 'error' || params.type === 'assert') log.errors.push(text);
      if (params.type === 'warning') log.warnings.push(text);
    } else if (method === 'Runtime.exceptionThrown') {
      log.errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    } else if (method === 'Log.entryAdded') {
      const { level, text, url = '' } = params.entry;
      if (level === 'error') log.errors.push(`${text} ${url}`);
      if (level === 'warning') log.warnings.push(`${text} ${url}`);
    } else if (method === 'Network.requestWillBeSent') {
      log.requests.push(params.request.url);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      sequence += 1;
      waiting.set(sequence, { resolve, reject });
      socket.send(JSON.stringify({ id: sequence, method, params }));
    });

  for (const domain of ['Runtime', 'Log', 'Network', 'Page']) await send(`${domain}.enable`);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  const waitFor = async (expression, timeout = 30000) => {
    const limit = Date.now() + timeout;
    while (Date.now() < limit) {
      if (await evaluate(expression).catch(() => false)) return;
      await delay(100);
    }
    throw new Error(`tempo esgotado: ${expression}\nconsole: ${log.errors.join('\n')}`);
  };

  return {
    socket,
    log,
    send,
    evaluate,
    waitFor,
    async open(url) {
      log.errors.length = 0;
      log.warnings.length = 0;
      log.requests.length = 0;
      await send('Page.navigate', { url });
    },
    async click(selector) {
      // Clique real do mouse, para detectar elementos encobertos.
      const point = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        return element.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
      })()`);
      if (!point) throw new Error(`elemento não clicável: ${selector}`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
      }
    },
    /** Pressiona (e mantém) uma tecla física, como "KeyW" ou "ShiftLeft". */
    async keyDown(code) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: code, windowsVirtualKeyCode: KEY_CODES[code] });
    },
    async keyUp(code) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code, windowsVirtualKeyCode: KEY_CODES[code] });
    },
    async mouse(type, x, y, buttons = 0) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: buttons ? 'left' : 'none', buttons, clickCount: 1 });
    },
    async key(key, code) {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
      }
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },
  };
}
