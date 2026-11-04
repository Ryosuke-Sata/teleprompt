import { type DictionaryEntry, type ReadingOverride, type Settings } from './model';

export interface Block { id: number; start: number; end: number; text: string; kind: 'text' | 'note' | 'wait' | 'stop' | 'space'; seconds?: number }
export interface Token { surface_form: string; reading?: string; pronunciation?: string; word_type?: string }
export interface Unit { start: number; end: number; text: string; reading: string; mora: number; unknown: boolean; source: 'dictionary' | 'override' | 'auto' | 'estimate' }
export interface Analysis { blocks: Block[]; units: Unit[]; unknown: number; mora: number }
export function parseScript(text: string): Block[] {
  const blocks: Block[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const last = blocks.at(-1);
    const start = offset;
    offset += line.length + 1;
    if (!trimmed) {
      if (last?.kind !== 'space') blocks.push({ id: start, start, end: start + line.length, text: '', kind: 'space' });
      continue;
    }
    const directive = trimmed.match(/^\[\[(メモ:([^\]\n]+)|待機:([\d.]+)|停止)\]\]$/u);
    if (trimmed.includes('[[') || trimmed.includes(']]')) {
      if (!directive) throw new Error(`${text.slice(0, start).split('\n').length}行目の指示が不正です。メモ・待機・停止を専用の行に記入してください。`);
      const seconds = directive[3] === undefined ? undefined : Number(directive[3]);
      if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0 || seconds > 60)) throw new Error('待機時間は0〜60秒で指定してください。');
      blocks.push({ id: start, start, end: start + line.length, text: directive[2] ?? (seconds === undefined ? '手動で再開' : `${seconds}秒 待機`), kind: directive[2] ? 'note' : seconds === undefined ? 'stop' : 'wait', seconds });
    } else if (last?.kind === 'text') {
      last.text += '\n' + line;
      last.end = start + line.length;
    } else blocks.push({ id: start, start, end: start + line.length, text: line, kind: 'text' });
  }
  return blocks;
}
export function countMora(reading: string): number {
  const kana = Array.from(reading.normalize('NFKC'));
  let count = 0;
  for (let i = 0; i < kana.length; i++) {
    const char = kana[i];
    if (/\s|[\p{P}\p{S}]/u.test(char) && char !== 'ー') continue;
    if (/[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/u.test(char) && i > 0 && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(kana[i - 1]) && !/[っッんンー]/u.test(kana[i - 1])) continue;
    count++;
  }
  return count;
}
function fallback(text: string): { reading: string; unknown: boolean; mora: number } {
  const unknown = /[\p{Script=Han}\p{Script=Latin}\p{N}]/u.test(text);
  const reading = text;
  const mora = unknown ? Array.from(text).reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 2 : /[\p{L}\p{N}ー]/u.test(c) ? 1 : 0), 0) : countMora(text);
  return { reading, unknown, mora };
}
export function buildUnits(block: Block, tokenize: (text: string) => Token[], dictionary: DictionaryEntry[], overrides: ReadingOverride[]): Unit[] {
  if (block.kind !== 'text') return [];
  const result: Unit[] = [];
  const local = overrides.filter(o => o.start >= block.start && o.end <= block.end);
  const sorted = [...dictionary].sort((a, b) => b.surface.length - a.surface.length);
  const forced: { start: number; end: number; reading: string; source: 'dictionary' | 'override' }[] = [];
  for (let i = 0; i < block.text.length;) {
    const absolute = block.start + i;
    const override = local.find(o => o.start === absolute);
    const entry = sorted.find(e => block.text.startsWith(e.surface, i) && !local.some(o => o.start < absolute + e.surface.length && o.end > absolute));
    if (override || entry) {
      const end = override ? override.end : absolute + entry!.surface.length;
      forced.push({ start: absolute, end, reading: override?.reading ?? entry!.reading, source: override ? 'override' : 'dictionary' });
      i = end - block.start;
    } else i++;
  }
  const automatic = (from: number, to: number) => {
    if (from >= to) return;
    const text = block.text.slice(from - block.start, to - block.start);
    let cursor = 0;
    const append = (surface: string, index: number, token?: Token) => {
      const known = token?.pronunciation || token?.reading;
      const f = known && known !== '*' ? { reading: known, mora: countMora(known), unknown: false } : fallback(surface);
      result.push({ start: from + index, end: from + index + surface.length, text: surface, ...f, source: f.unknown ? 'estimate' : 'auto' });
    };
    for (const token of tokenize(text)) {
      const i = text.indexOf(token.surface_form, cursor);
      if (i < 0 || !token.surface_form) continue;
      if (i > cursor) append(text.slice(cursor, i), cursor);
      append(token.surface_form, i, token);
      cursor = i + token.surface_form.length;
    }
    if (cursor < text.length) append(text.slice(cursor), cursor);
  };
  let position = block.start;
  for (const f of forced) {
    automatic(position, f.start);
    const text = block.text.slice(f.start - block.start, f.end - block.start);
    result.push({ ...f, text, mora: countMora(f.reading), unknown: false });
    position = f.end;
  }
  automatic(position, block.end);
  return result;
}
export function fallbackAnalysis(text: string, dictionary: DictionaryEntry[], overrides: ReadingOverride[]): Analysis {
  const blocks = parseScript(text);
  const units = blocks.flatMap(block => buildUnits(block, () => [], dictionary, overrides));
  return { blocks, units, mora: units.reduce((n, u) => n + u.mora, 0), unknown: units.filter(u => u.unknown).length };
}
export function punctuationPause(text: string, settings: Settings): number {
  // One pause for each run. A full stop takes precedence over commas in that run.
  return Array.from(text.matchAll(/[、，,。！？!?．.]+/gu)).reduce((sum, match) => sum + (/[。！？!?．.]/u.test(match[0]) ? settings.periodPause : settings.commaPause), 0);
}
export const REHEARSAL_TEXT = '今日は、自分の言葉をゆっくり届けてみましょう。東京の街を歩くと、いつもとは違う景色が見えてきます。大切なのは、急がず、一つひとつの言葉を丁寧に伝えることです。聞いている人を思い浮かべながら、あなたにとって自然な速さで読んでください。';
export const REHEARSAL_READING = 'きょうはじぶんのことばをゆっくりとどけてみましょうとうきょうのまちをあるくといつもとはちがうけしきがみえてきますたいせつなのはいそがずひとつひとつのことばをていねいにつたえることですきいているひとをおもいうかべながらあなたにとってしぜんなはやさでよんでください';
export function rehearsalRate(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 5) return null;
  const rate = Math.round(countMora(REHEARSAL_READING) * 60 / seconds);
  return rate >= 60 && rate <= 1200 ? rate : null;
}
