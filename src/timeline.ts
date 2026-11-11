import type { Settings } from './model';
import { punctuationPause, type Analysis, type Block } from './script';

export interface Row { y: number; start: number; end: number; mora: number; punctuation: number; block: Block; last: boolean }
export interface Step {
  y: number;
  fromY: number;
  start: number;
  end: number;
  seconds: number;
  holdSeconds: number;
  gate: boolean;
  kind: Block['kind'];
  blockId: number;
}

const MAX_ADAPTIVE_SCROLL_PX_PER_SECOND = 180;

export function createTimeline(rows: Row[], settings: Settings): Step[] {
  const adaptive = settings.mode === 'adaptive';
  const scrollSpeed = adaptive ? MAX_ADAPTIVE_SCROLL_PX_PER_SECOND : settings.pixelsPerSecond;

  return rows.map((row, index) => {
    const nextY = rows[index + 1]?.y ?? row.y;
    const travelSeconds = Math.abs(nextY - row.y) / scrollSpeed;
    let holdSeconds = 0;
    let seconds = travelSeconds;

    switch (row.block.kind) {
      case 'text': {
        const readingSeconds = adaptive
          ? row.mora * 60 / settings.moraPerMinute + row.punctuation
          : travelSeconds || settings.fontSize * settings.lineHeight / scrollSpeed;
        seconds = Math.max(readingSeconds, travelSeconds);
        break;
      }
      case 'space':
        seconds = Math.max(settings.paragraphPause, travelSeconds);
        if (!adaptive) holdSeconds = seconds - travelSeconds;
        break;
      case 'wait':
        holdSeconds = row.block.seconds ?? 0;
        seconds += holdSeconds;
        break;
    }

    return {
      y: nextY,
      fromY: row.y,
      start: row.start,
      end: row.end,
      seconds,
      holdSeconds,
      gate: row.block.kind === 'stop',
      kind: row.block.kind,
      blockId: row.block.id,
    };
  });
}

export function measureRows(container: HTMLElement, analysis: Analysis, settings: Settings): Row[] {
  const rect = container.getBoundingClientRect();
  const rows: Row[] = [];
  let unitCursor = 0;
  for (const block of analysis.blocks) {
    const element = container.querySelector<HTMLElement>(`[data-block="${block.id}"]`);
    if (!element) continue;
    if (block.kind !== 'text') {
      const bounds = element.getBoundingClientRect();
      rows.push({ y: bounds.top + bounds.height / 2 - rect.top, start: block.start, end: block.end, mora: 0, punctuation: 0, block, last: true });
      continue;
    }
    const characters = Array.from(element.querySelectorAll<HTMLElement>('[data-offset]'));
    const groups: { top: number; centerY: number; chars: HTMLElement[] }[] = [];
    for (const char of characters) {
      const bounds = char.getBoundingClientRect();
      const top = bounds.top - rect.top;
      const current = groups.at(-1);
      if (current && Math.abs(current.top - top) < 2) current.chars.push(char);
      else groups.push({ top, centerY: top + bounds.height / 2, chars: [char] });
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
      rows.push({ y: group.centerY, start, end, mora, punctuation: punctuationPause(group.chars.map(c => c.textContent).join(''), settings), block, last: i === groups.length - 1 });
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
    if (this.elapsed <= step.holdSeconds || step.y === step.fromY) return step.fromY;
    const travelSeconds = step.seconds - step.holdSeconds;
    const progress = Math.min(1, (this.elapsed - step.holdSeconds) / travelSeconds);
    return step.fromY + (step.y - step.fromY) * progress;
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
