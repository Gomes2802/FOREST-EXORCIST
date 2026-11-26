/**
 * Copia o Babylon.js de node_modules para lib/ (precisa de "npm install" antes).
 * Só é necessário ao atualizar a versão: lib/ já vem pronta para uso offline.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'babylonjs');
const lib = join(root, 'lib');

mkdirSync(lib, { recursive: true });
copyFileSync(join(source, 'babylon.js'), join(lib, 'babylon.js'));
copyFileSync(join(source, 'license.md'), join(lib, 'babylon.LICENSE.md'));
copyFileSync(join(source, 'NOTICE.md'), join(lib, 'babylon.NOTICE.md'));

const { version } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
const sha256 = createHash('sha256').update(readFileSync(join(lib, 'babylon.js'))).digest('hex');
writeFileSync(join(lib, 'VERSION.json'), `${JSON.stringify({ babylonjs: version, sha256 }, null, 2)}\n`);

console.log(`Babylon.js ${version} copiado para lib/ (sha256 ${sha256.slice(0, 16)}...)`);
