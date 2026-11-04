export interface Settings {
  mode: 'adaptive' | 'constant';
  moraPerMinute: number;
  pixelsPerSecond: number;
  fontSize: number;
  lineHeight: number;
  width: number;
  foreground: string;
  background: string;
  countdown: number;
  commaPause: number;
  periodPause: number;
  paragraphPause: number;
}
export interface DictionaryEntry { surface: string; reading: string }
export interface ReadingOverride { start: number; end: number; text: string; reading: string }
export interface Bookmark { id: string; name: string; offset: number; text: string }
export interface Project {
  format: 'kotoba-teleprompt';
  version: 1;
  title: string;
  text: string;
  settings: Settings;
  dictionary: DictionaryEntry[];
  overrides: ReadingOverride[];
  bookmarks: Bookmark[];
}
export const DEFAULT_SETTINGS: Settings = {
  mode: 'adaptive', moraPerMinute: 360, pixelsPerSecond: 32,
  fontSize: 38, lineHeight: 1.9, width: 88,
  foreground: '#f2f4ee', background: '#172622', countdown: 3,
  commaPause: 0.25, periodPause: 0.6, paragraphPause: 0.7,
};
export const SAMPLE = `言葉を、あなたのペースで。\n\n東京の朝。窓を開けると、新しい一日が始まります。\n今日は、自分の言葉をゆっくり届けてみましょう。\n\n[[メモ:肩の力を抜いて、カメラを見る]]\n[[待機:2]]\n\n大切なのは、速く読むことよりも、伝わること。\n漢字の多い文章も、ひらがなの文章も、読みの長さに合わせて進みます。\n\n[[停止]]\n\n準備ができたら、もう一度、再生を押してください。\nあなたの声で、あなたらしく。`;
export function freshProject(): Project {
  return { format: 'kotoba-teleprompt', version: 1, title: 'はじめての原稿', text: SAMPLE,
    settings: { ...DEFAULT_SETTINGS }, dictionary: [], overrides: [], bookmarks: [] };
}
export const MAX_TEXT = 100_000;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
export function isReading(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u.test(value) && /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(value);
}
export function validateProject(data: unknown): Project {
  if (!object(data) || data.format !== 'kotoba-teleprompt' || data.version !== 1) throw new Error('対応している「ことば」形式（version 1）のJSONではありません。');
  if (!string(data.title, 200) || !string(data.text, MAX_TEXT) || data.text.includes('\r')) throw new Error('原稿の形式または長さが不正です（本文は10万文字まで、改行はLF）。');
  const s = data.settings;
  if (!object(s) || !['adaptive', 'constant'].includes(String(s.mode))) throw new Error('速度モードが不正です。');
  const bounds = { moraPerMinute: [60, 1200], pixelsPerSecond: [5, 150], fontSize: [20, 80], lineHeight: [1.2, 3], width: [45, 100], countdown: [0, 5], commaPause: [0, 3], periodPause: [0, 5], paragraphPause: [0, 5] };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = s[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`設定値 ${key} が範囲外です。`);
  }
  if (![0, 3, 5].includes(s.countdown as number) || !Number.isInteger(s.fontSize)) throw new Error('カウントダウンまたは文字サイズが不正です。');
  for (const key of ['foreground', 'background']) if (typeof s[key] !== 'string' || !/^#[\da-f]{6}$/i.test(s[key] as string)) throw new Error('色の指定が不正です。');
  if (!Array.isArray(data.dictionary) || data.dictionary.length > 500 || !Array.isArray(data.overrides) || data.overrides.length > 1000 || !Array.isArray(data.bookmarks) || data.bookmarks.length > 500) throw new Error('辞書・読み修正・ブックマークの形式または件数が不正です。');
  const dictionary: DictionaryEntry[] = [];
  for (const entry of data.dictionary) {
    if (!object(entry) || !string(entry.surface, 80) || !entry.surface.trim() || /\s|\[\[/.test(entry.surface) || !string(entry.reading, 200) || !isReading(entry.reading) || dictionary.some(d => d.surface === entry.surface)) throw new Error('ユーザー辞書に不正な項目があります。');
    dictionary.push({ surface: entry.surface, reading: entry.reading });
  }
  const overrides: ReadingOverride[] = [];
  for (const entry of data.overrides) {
    if (!object(entry) || !Number.isInteger(entry.start) || !Number.isInteger(entry.end) || (entry.start as number) < 0 || (entry.end as number) <= (entry.start as number) || (entry.end as number) > data.text.length || !string(entry.text, 200) || !entry.text || data.text.slice(entry.start as number, entry.end as number) !== entry.text || !string(entry.reading, 200) || !isReading(entry.reading)) throw new Error('箇所ごとの読み修正と本文が一致しません。');
    const r = { start: entry.start as number, end: entry.end as number, text: entry.text, reading: entry.reading };
    if (overrides.some(o => o.start < r.end && o.end > r.start)) throw new Error('読み修正の範囲が重複しています。');
    overrides.push(r);
  }
  const bookmarks: Bookmark[] = [];
  for (const entry of data.bookmarks) {
    if (!object(entry) || !string(entry.id, 100) || !entry.id || bookmarks.some(b => b.id === entry.id) || !string(entry.name, 80) || !entry.name.trim() || !Number.isInteger(entry.offset) || (entry.offset as number) < 0 || (entry.offset as number) >= data.text.length || !string(entry.text, 60) || !entry.text || data.text.slice(entry.offset as number, (entry.offset as number) + entry.text.length) !== entry.text) throw new Error('ブックマークと本文が一致しません。');
    bookmarks.push({ id: entry.id, name: entry.name, offset: entry.offset as number, text: entry.text });
  }
  return { format: 'kotoba-teleprompt', version: 1, title: data.title, text: data.text,
    settings: { mode: s.mode, ...Object.fromEntries(Object.keys(bounds).map(key => [key, s[key]])), foreground: s.foreground, background: s.background } as Settings,
    dictionary, overrides, bookmarks };
}
