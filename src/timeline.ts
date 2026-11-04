import type { Settings } from './model';
import { punctuationPause, type Analysis, type Block } from './script';

export interface Row { y: number; start: number; end: number; mora: number; punctuation: number; block: Block; last: boolean }
export interface Step { y: number; fromY: number; start: number; end: number; seconds: number; gate: boolean; kind: Block['kind']; blockId: number }
export function createTimeline(rows: Row[], settings: Settings): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextY = rows[i + 1]?.y ?? row.y;
    let seconds: number;
    if (row.block.kind === 'wait') seconds = row.block.seconds ?? 0;
    else if (row.block.kind === 'stop') seconds = 0;
    else if (row.block.kind === 'note') seconds = 0;
    else if (row.block.kind === 'space') seconds = settings.paragraphPause;
    else seconds = settings.mode === 'adaptive'
      ? row.mora * 60 / settings.moraPerMinute + row.punctuation
      : (Math.max(0, nextY - row.y) || settings.fontSize * settings.lineHeight) / settings.pixelsPerSecond;
    // Reading and waits hold the current line; movement is continuous during text.
    const target = row.block.kind === 'text' || row.block.kind === 'space' ? nextY : row.y;
    steps.push({ y: target, fromY: row.y, start: row.start, end: row.end, seconds: Math.max(0, seconds), gate: row.block.kind === 'stop', kind: row.block.kind, blockId: row.block.id });
    // Notes and cues have no reading time, but their display positions are reached by the previous text.
  }
  return steps;
}

export function measureRows(container: HTMLElement, analysis: Analysis, settings: Settings): Row[] {
  const rect = container.getBoundingClientRect();
  const rows: Row[] = [];
  let unitCursor = 0;
  for (const block of analysis.blocks) {
    const element = container.querySelector<HTMLElement>(`[data-block="${block.id}"]`);
    if (!element) continue;
    if (block.kind !== 'text') {
      rows.push({ y: element.getBoundingClientRect().top - rect.top, start: block.start, end: block.end, mora: 0, punctuation: 0, block, last: true });
      continue;
    }
    const characters = Array.from(element.querySelectorAll<HTMLElement>('[data-offset]'));
    const groups: { y: number; chars: HTMLElement[] }[] = [];
    for (const char of characters) {
      const y = char.getBoundingClientRect().top - rect.top;
      const current = groups.at(-1);
      if (current && Math.abs(current.y - y) < 2) current.chars.push(char);
      else groups.push({ y, chars: [char] });
    }
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const start = Number(group.chars[0].dataset.offset);
      const last = group.chars.at(-1)!;
      const end = Number(last.dataset.offset) + (last.textContent?.length ?? 1);
      let mora = 0;
      while (unitCursor < analysis.units.length && analysis.units[unitCursor].end <= start) unitCursor++;
      for (let k = unitCursor; k < analysis.units.length && analysis.units[k].start < end; k++) {
        const unit = analysis.units[k];
        const intersectionStart = Math.max(start, unit.start);
        const intersectionEnd = Math.min(end, unit.end);
        if (intersectionStart >= intersectionEnd) continue;
        // Unicode code points avoid charging half a surrogate as a full character.
        const total = Array.from(unit.text.replace(/\s/g, '')).length;
        const part = Array.from(unit.text.slice(intersectionStart - unit.start, intersectionEnd - unit.start).replace(/\s/g, '')).length;
        mora += total ? unit.mora * part / total : 0;
      }
      rows.push({ y: group.y, start, end, mora, punctuation: punctuationPause(group.chars.map(c => c.textContent).join(''), settings), block, last: i === groups.length - 1 });
    }
  }
  return rows;
}

export class Transport {
  index = 0;
  elapsed = 0;
  playing = false;
  waitingForUser = false;
  private released = new Set<number>();
  constructor(public steps: Step[]) {}
  get current() { return this.steps[this.index]; }
  get y(): number {
    const step = this.current;
    if (!step) return this.steps.at(-1)?.y ?? 0;
    const t = step.seconds ? Math.min(1, this.elapsed / step.seconds) : 0;
    return step.fromY + (step.y - step.fromY) * t;
  }
  get duration() { return this.steps.reduce((s, step) => s + step.seconds, 0); }
  get consumed() { return this.steps.slice(0, this.index).reduce((s, step) => s + step.seconds, 0) + this.elapsed; }
  play() {
    if (this.waitingForUser) { this.released.add(this.index); this.waitingForUser = false; }
    this.playing = this.steps.length > 0;
  }
  pause() { this.playing = false; }
  seek(index: number) {
    this.index = Math.max(0, Math.min(index, Math.max(0, this.steps.length - 1)));
    this.elapsed = 0;
    this.playing = false;
    this.waitingForUser = false;
    this.released.clear();
  }
  tick(delta: number) {
    if (!this.playing) return;
    let remaining = Math.max(0, delta);
    for (let guard = 0; guard <= this.steps.length; guard++) {
      const step = this.current;
      if (!step) { this.playing = false; return; }
      if (step.gate && !this.released.has(this.index)) {
        this.waitingForUser = true; this.playing = false; return;
      }
      const available = Math.max(0, step.seconds - this.elapsed);
      if (remaining < available) { this.elapsed += remaining; return; }
      remaining -= available;
      this.index++;
      this.elapsed = 0;
    }
    this.playing = false;
  }
}
