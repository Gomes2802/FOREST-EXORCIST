/**
 * Build: valida o projeto e monta em dist/ a versão para distribuir.
 * Não há transpilação nem empacotamento; o navegador usa os módulos ES direto.
 * Não precisa de node_modules.
 */
import { chmodSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const RUNTIME = [
  'index.html', 'style.css', 'README.md', 'CHANGELOG.md',
  'serve.py', 'start.sh', 'lib', 'src', 'assets',
];

const errors = [];
const read = (path) => readFileSync(join(root, path), 'utf8');
const walk = (path) =>
  statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => walk(join(path, name))) : [path];

for (const entry of RUNTIME) {
  if (!existsSync(join(root, entry))) errors.push(`ausente: ${entry}`);
}

if (errors.length === 0) {
  // 1. Sintaxe e imports.
  for (const file of walk(join(root, 'src'))) {
    const name = relative(root, file);
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (error) {
      errors.push(`sintaxe: ${name}\n${error.stderr}`);
    }
    for (const [, target] of read(name).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      if (!target.startsWith('.')) errors.push(`${name}: import não local "${target}"`);
      else if (!existsSync(join(dirname(file), target))) errors.push(`${name}: import quebrado "${target}"`);
    }
  }

  // 2. Nenhuma referência externa no código do jogo.
  const ownFiles = ['index.html', 'style.css', 'assets/sprites/manifest.json'];
  ownFiles.push(...walk(join(root, 'src')).map((file) => relative(root, file)));
  for (const name of ownFiles) {
    if (/(?:https?|wss?):\/\/|(?:src|href)=["']\/\/|url\(\s*["']?\/\//i.test(read(name))) {
      errors.push(`${name}: contém endereço externo`);
    }
  }

  // 3. Arquivos referenciados por HTML e manifesto.
  for (const [, target] of read('index.html').matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!target.startsWith('data:') && !existsSync(join(root, target))) {
      errors.push(`index.html: arquivo inexistente "${target}"`);
    }
  }
  try {
    const { sprites } = JSON.parse(read('assets/sprites/manifest.json'));
    for (const [id, { file = `${id}.png` }] of Object.entries(sprites)) {
      // Sprite ausente não impede o jogo, mas deve ser avisado.
      if (!existsSync(join(root, 'assets/sprites', file))) {
        console.warn(`aviso: sprite "${id}" sem arquivo (${file}); será usada a alternativa.`);
      }
    }
  } catch (error) {
    errors.push(`manifest.json inválido: ${error.message}`);
  }

  // 4. Integridade da biblioteca local.
  try {
    const { sha256 } = JSON.parse(read('lib/VERSION.json'));
    const actual = createHash('sha256').update(readFileSync(join(root, 'lib/babylon.js'))).digest('hex');
    if (actual !== sha256) errors.push('lib/babylon.js difere de lib/VERSION.json (rode npm run vendor)');
  } catch (error) {
    errors.push(`biblioteca local: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error(`Build falhou:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
for (const entry of RUNTIME) cpSync(join(root, entry), join(dist, entry), { recursive: true });
chmodSync(join(dist, 'start.sh'), 0o755);

const files = walk(dist);
const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
console.log(`Build concluído: dist/ com ${files.length} arquivos (${(bytes / 1048576).toFixed(1)} MB).`);
