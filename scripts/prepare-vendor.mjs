import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('kuromoji/package.json'));
const target = new URL('../public/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(join(root, 'build/kuromoji.js'), new URL('kuromoji.js', target));
const bundle = await readFile(join(root, 'build/kuromoji.js'), 'utf8');
const needle = 'var gz = new zlib.Zlib.Gunzip(new Uint8Array(arraybuffer));';
if (!bundle.includes(needle)) throw new Error('Unexpected kuromoji bundle: review loader compatibility patch.');
const compatible = '/*! Modified for Kotoba: accept dictionaries already decoded by HTTP Content-Encoding. Original notices retained. */\n' + bundle.replace(needle,
  'if (new Uint8Array(arraybuffer)[0] !== 0x1f || new Uint8Array(arraybuffer)[1] !== 0x8b) { callback(null, arraybuffer); return; }\n        ' + needle);
await mkdir(new URL('../src/vendor/', import.meta.url), { recursive: true });
// Wrap the prebuilt UMD explicitly so both Vite dev and production use the same ES module.
await writeFile(new URL('../src/vendor/kuromoji.mjs', import.meta.url), 'const module = { exports: {} }; const exports = module.exports;\n' + compatible + '\nexport default module.exports;\n');
await cp(join(root, 'dict'), new URL('dict/', target), { recursive: true });
await cp(join(root, 'LICENSE-2.0.txt'), new URL('KUROMOJI-LICENSE.txt', target));
await cp(join(root, 'NOTICE.md'), new URL('IPADIC-NOTICE.txt', target));

// The Browserify bundle embeds these transitive packages. Ship their licenses too.
const dependencies = ['async', 'lodash', 'doublearray', 'zlibjs', 'browserify-zlib', 'pako', 'buffer', 'base64-js', 'ieee754', 'isarray', 'process', 'path-browserify', 'util', 'inherits', 'stream-browserify', 'readable-stream', 'core-util-is', 'string_decoder', 'events', 'is-buffer'];
let notices = '# Third-party software\n\nkuromoji.js 0.1.2: Apache-2.0 (KUROMOJI-LICENSE.txt)\nIPADIC: see IPADIC-NOTICE.txt (NAIST / ICOT notices)\n\nKotoba modifies the browser dictionary loader to accept both gzip bytes and HTTP-decoded bytes. The generated ES module and production analysis worker contain this compatibility modification. Original browser bundle: kuromoji.js.\n';
for (const name of dependencies) {
  try {
    const packageRoot = dirname(require.resolve(`${name}/package.json`, { paths: [root] }));
    const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(packageRoot)).filter(file => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file));
    notices += `\n## ${name} ${metadata.version}\n`;
    for (const file of files) notices += `\n${await readFile(join(packageRoot, file), 'utf8')}\n`;
  } catch { /* Only packages available in this distribution are listed. */ }
}
await writeFile(new URL('THIRD-PARTY.txt', target), notices);
console.log('Prepared local Japanese dictionary and third-party notices.');
