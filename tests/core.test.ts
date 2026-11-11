import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, freshProject, validateProject } from '../src/model';
import { buildUnits, countMora, fallbackAnalysis, parseScript, punctuationPause, rehearsalRate } from '../src/script';
import { createTimeline, Transport, type Row, type Step } from '../src/timeline';

const require = createRequire(import.meta.url);
const kuromoji = require('kuromoji');
const tokenizer: { tokenize: (s: string) => import('../src/script').Token[] } = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: join(dirname(require.resolve('kuromoji/package.json')), 'dict') }).build((err: Error | null, t: never) => err ? reject(err) : resolve(t)));
const units = (text: string, dictionary: import('../src/model').DictionaryEntry[] = [], overrides: import('../src/model').ReadingOverride[] = []) => buildUnits(parseScript(text)[0], t => tokenizer.tokenize(t), dictionary, overrides);
const step = (partial: Partial<Step> = {}): Step => ({ fromY: 0, y: 50, start: 0, end: 2, seconds: 1, holdSeconds: 0, gate: false, kind: 'text', blockId: 0, ...partial });

describe('Japanese timing with the actual bundled dictionary', () => {
  it('assigns the same mora count to 東京 and とうきょう', () => {
    expect(units('東京').reduce((s, u) => s + u.mora, 0)).toBe(4);
    expect(units('とうきょう').reduce((s, u) => s + u.mora, 0)).toBe(4);
  });
  it.each([['きゃく', 2], ['しんぶん', 4], ['がっこう', 4], ['チョコレート', 5], ['ティー', 2], ['ｷｮｳ', 2], ['。、\n ', 0]])('counts %s as %i mora', (text, count) => expect(countMora(text)).toBe(count));
  it('uses longest user dictionary matches and occurrence overrides with highest priority', () => {
    const text = '日本橋と日本橋';
    const result = units(text, [{ surface: '日本', reading: 'にほん' }, { surface: '日本橋', reading: 'にほんばし' }], [{ start: 4, end: 7, text: '日本橋', reading: 'にっぽんばし' }]);
    expect(result.filter(u => u.text === '日本橋').map(u => u.reading)).toEqual(['にほんばし', 'にっぽんばし']);
    expect(result.map(u => u.text).join('')).toBe(text);
  });
  it('retokenizes automatic text around forced readings instead of losing characters', () => {
    const result = units('東京大学へ行く', [{ surface: '東京', reading: 'とうきょう' }]);
    expect(result.map(u => u.text).join('')).toBe('東京大学へ行く');
    expect(result.find(u => u.text === '大学')?.reading).toBe('ダイガク');
  });
  it('preserves spaces, newlines, and surrogate pairs in offsets', () => {
    const text = '東京 😀\n こんにちは'; const result = units(text);
    expect(result.map(u => u.text).join('')).toBe(text);
    for (const u of result) expect(text.slice(u.start, u.end)).toBe(u.text);
  });
  it('does not count punctuation pauses twice in a consecutive run', () => {
    expect(punctuationPause('こんにちは！？、次です。', DEFAULT_SETTINGS)).toBeCloseTo(DEFAULT_SETTINGS.periodPause * 2);
  });
  it('supports a fallback estimate without a loaded dictionary', () => {
    const result = fallbackAnalysis('未知の漢字', [], []);
    expect(result.unknown).toBeGreaterThan(0); expect(result.mora).toBeGreaterThan(0);
  });
});

describe('notes, pauses, paragraphs and playback', () => {
  it('parses only whole-line instructions and preserves source positions', () => {
    const text = '本文\n続き\n\n[[メモ:カメラ]]\n[[待機:2.5]]\n[[停止]]\n\n次';
    const blocks = parseScript(text);
    expect(blocks.map(b => b.kind)).toEqual(['text', 'space', 'note', 'wait', 'stop', 'space', 'text']);
    expect(blocks[0].text).toBe('本文\n続き'); expect(blocks[3].seconds).toBe(2.5);
    expect(text.slice(blocks.at(-1)!.start, blocks.at(-1)!.end)).toBe('次');
    expect(fallbackAnalysis('[[メモ:長いメモの文章]]\n[[待機:2]]\n[[停止]]', [], []).mora).toBe(0);
  });
  it.each(['[[待機:61]]', '[[待機:..]]', '途中[[停止]]', '[[知らない指示]]', '[[メモ:]]'])('rejects malformed instructions: %s', text => expect(() => parseScript(text)).toThrow());
  it('assigns more reading time to a line with more mora', () => {
    const block = parseScript('東京の朝')[0];
    const rows: Row[] = [{ y: 0, start: 0, end: 2, mora: 4, punctuation: 0, block, last: false }, { y: 60, start: 2, end: 4, mora: 8, punctuation: 0, block, last: true }];
    const result = createTimeline(rows, DEFAULT_SETTINGS);
    expect(result[1].seconds).toBe(result[0].seconds * 2);
  });
  it.each([0, 1])('limits movement across a line with %i mora', mora => {
    const block = parseScript('あ\n次の行')[0];
    const rows: Row[] = [
      { y: 0, start: 0, end: 1, mora, punctuation: 0, block, last: false },
      { y: 72, start: 2, end: 5, mora: 4, punctuation: 0, block, last: true },
    ];
    const t = new Transport(createTimeline(rows, { ...DEFAULT_SETTINGS, moraPerMinute: 1200 }));
    t.play();
    t.tick(1 / 60);
    expect(t.y).toBeGreaterThan(0);
    expect(t.y).toBeLessThanOrEqual(3);
  });

  it.each(['adaptive', 'constant'] as const)('scrolls continuously across cues and zero-length paragraph pauses in %s mode', mode => {
    const blocks = parseScript('[[メモ:合図]]\n\n[[待機:2]]\n[[停止]]\n次');
    const rows: Row[] = blocks.map((block, i) => ({
      y: i * 72, start: block.start, end: block.end, mora: 0, punctuation: 0, block, last: true,
    }));
    const settings = { ...DEFAULT_SETTINGS, mode, paragraphPause: 0 };
    const t = new Transport(createTimeline(rows, settings));
    const frame = 1 / 60;
    const maxFrameDistance = (mode === 'constant' ? settings.pixelsPerSecond : 180) * frame;

    t.play();
    t.tick(frame);
    expect(t.y).toBeGreaterThan(0);
    expect(t.y).toBeLessThanOrEqual(maxFrameDistance + 0.0001);

    const timeBeforeWait = t.steps[0].seconds + t.steps[1].seconds;
    t.tick(timeBeforeWait - frame + 1.99);
    expect(t.current.kind).toBe('wait');
    expect(t.y).toBeCloseTo(144);
    t.tick(.02);
    expect(t.y).toBeGreaterThan(144);
    expect(t.y - 144).toBeLessThanOrEqual(maxFrameDistance + 0.0001);

    t.tick(t.steps[2].seconds);
    expect(t.waitingForUser).toBe(true);
    expect(t.y).toBeCloseTo(216);
    t.play();
    t.tick(frame);
    expect(t.y).toBeGreaterThan(216);
    expect(t.y - 216).toBeLessThanOrEqual(maxFrameDistance + 0.0001);
  });

  it('does not instantly discard the last line in constant-speed mode', () => {
    const block = parseScript('本文')[0];
    expect(createTimeline([{ y: 0, start: 0, end: 2, mora: 4, punctuation: 0, block, last: true }], { ...DEFAULT_SETTINGS, mode: 'constant' })[0].seconds).toBeGreaterThan(0);
  });
  it('waits the full specified duration and gates until manually resumed', () => {
    const t = new Transport([step(), step({ kind: 'wait', seconds: 2 }), step({ kind: 'stop', gate: true, seconds: 0 }), step()]);
    t.play(); t.tick(1.5); expect(t.index).toBe(1); expect(t.elapsed).toBeCloseTo(.5);
    t.tick(1.5); expect(t.index).toBe(2); expect(t.waitingForUser).toBe(true); expect(t.playing).toBe(false);
    t.tick(100); expect(t.index).toBe(2);
    t.play(); t.tick(.5); expect(t.index).toBe(3); expect(t.elapsed).toBeCloseTo(.5);
    t.tick(.5); expect(t.playing).toBe(false); expect(t.index).toBe(4);
  });
  it('preserves elapsed time on pause and reenables gates after seeking', () => {
    const t = new Transport([step(), step({ gate: true, seconds: 0, kind: 'stop' })]);
    t.play(); t.tick(.4); t.pause(); t.tick(5); expect(t.elapsed).toBe(.4);
    t.play(); t.tick(.6); expect(t.waitingForUser).toBe(true);
    t.play(); t.tick(1); t.seek(1); t.play(); t.tick(.01); expect(t.waitingForUser).toBe(true);
  });
});

describe('project file validation', () => {
  it('round-trips all settings, dictionary, overrides and bookmarks', () => {
    const p = freshProject(); p.dictionary = [{ surface: '東京', reading: 'とうきょう' }];
    p.text = '東京の朝'; p.overrides = [{ start: 0, end: 2, text: '東京', reading: 'とうきょう' }];
    p.bookmarks = [{ id: 'test', name: '導入', offset: 0, text: p.text }];
    expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('rejects unsupported versions, HTML colors and out-of-range numbers', () => {
    expect(() => validateProject({ ...freshProject(), version: 2 })).toThrow();
    expect(() => validateProject({ ...freshProject(), settings: { ...DEFAULT_SETTINGS, fontSize: 9999 } })).toThrow();
    expect(() => validateProject({ ...freshProject(), settings: { ...DEFAULT_SETTINGS, background: 'url(javascript:alert(1))' } })).toThrow();
  });
  it('rejects stale, overlapping, or empty reading ranges and bookmarks', () => {
    const p = freshProject(); p.text = '東京';
    expect(() => validateProject({ ...p, overrides: [{ start: 0, end: 1, text: '大阪', reading: 'おおさか' }] })).toThrow();
    const o = { start: 0, end: 2, text: '東京', reading: 'とうきょう' };
    expect(() => validateProject({ ...p, overrides: [o, o] })).toThrow();
    expect(() => validateProject({ ...p, overrides: [{ start: 10, end: 11, text: '', reading: 'あ' }] })).toThrow();
    expect(() => validateProject({ ...p, bookmarks: [{ id: 'b', name: 'test', offset: 0, text: '大阪' }] })).toThrow();
  });
  it('rejects duplicate dictionary entries and invalid reading strings', () => {
    const d = { surface: '東京', reading: 'とうきょう' };
    expect(() => validateProject({ ...freshProject(), dictionary: [d, d] })).toThrow();
    expect(() => validateProject({ ...freshProject(), dictionary: [{ surface: '東京', reading: '<script>' }] })).toThrow();
  });
  it('treats HTML in the manuscript as plain text', () => {
    expect(validateProject({ ...freshProject(), text: '<script>alert(1)</script>' }).text).toContain('<script>');
  });
});

describe('rehearsal without a microphone', () => {
  it('computes a reasonable recommendation and rejects invalid measurements', () => {
    expect(rehearsalRate(30)).toBeGreaterThan(60);
    expect(rehearsalRate(30)).toBeLessThan(1200);
    for (const seconds of [0, 1, 4.9, -10, Infinity, NaN, 10000]) expect(rehearsalRate(seconds)).toBeNull();
  });
});
