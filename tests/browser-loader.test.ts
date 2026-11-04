import { expect, it, vi, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import kuromoji from '../src/vendor/kuromoji.mjs';

const require = createRequire(import.meta.url);
const dictionaryPath = join(dirname(require.resolve('kuromoji/package.json')), 'dict');
let decodeHTTP = false;
class DictionaryXHR {
  status = 200;
  responseType = '';
  response: ArrayBuffer = new ArrayBuffer(0);
  onload: () => void = () => {};
  onerror: (error: unknown) => void = () => {};
  private url = '';
  open(_method: string, url: string) { this.url = url; }
  send() {
    queueMicrotask(() => {
      try {
        const compressed = readFileSync(join(dictionaryPath, basename(this.url)));
        const bytes = decodeHTTP ? gunzipSync(compressed) : compressed;
        this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        this.onload();
      } catch (error) { this.onerror(error); }
    });
  }
}
vi.stubGlobal('XMLHttpRequest', DictionaryXHR);
afterAll(() => vi.unstubAllGlobals());
for (const decoded of [false, true]) {
  it(`loads the actual browser bundle when HTTP decoding is ${decoded ? 'enabled' : 'disabled'}`, async () => {
    decodeHTTP = decoded;
    const tokenizer = await new Promise<{ tokenize(text: string): { reading?: string }[] }>((resolve, reject) => {
      kuromoji.builder({ dicPath: '/teleprompt/vendor/dict/' }).build((error: Error | null, value: never) => error ? reject(error) : resolve(value));
    });
    expect(tokenizer.tokenize('東京')[0].reading).toBe('トウキョウ');
  }, 20_000);
}
