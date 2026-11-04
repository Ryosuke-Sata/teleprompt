import kuromoji from './vendor/kuromoji.mjs';
import { buildUnits, parseScript } from './script';
import type { Project } from './model';

let tokenizer: { tokenize(text: string): import('./script').Token[] };
let loading: Promise<void> | undefined;
self.onmessage = (event: MessageEvent<{ id: number; project: Project; dictionaryURL: string }>) => {
  const { id, project, dictionaryURL } = event.data;
  const run = () => {
    try {
      const blocks = parseScript(project.text);
      const units = blocks.flatMap(b => buildUnits(b, text => tokenizer.tokenize(text), project.dictionary, project.overrides));
      self.postMessage({ id, result: { blocks, units, mora: units.reduce((n, u) => n + u.mora, 0), unknown: units.filter(u => u.unknown).length } });
    } catch (error) { self.postMessage({ id, error: String(error) }); }
  };
  if (tokenizer) run();
  else {
    loading ??= new Promise<void>((resolve, reject) => {
      kuromoji.builder({ dicPath: dictionaryURL }).build((error, value) => {
        if (error) reject(new Error('辞書を読み込めませんでした。ネットワーク接続を確認して再試行してください。'));
        else { tokenizer = value; resolve(); }
      });
    });
    void loading.then(run).catch(error => { self.postMessage({ id, error: error.message }); loading = undefined; });
  }
};
