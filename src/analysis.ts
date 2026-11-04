import type { Project } from './model';
import type { Analysis } from './script';

export class Analyzer {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  reset() {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error('解析を再起動しました。')); }
    this.pending.clear();
  }
  analyze(project: Project): Promise<Analysis> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => {
        const p = this.pending.get(event.data.id);
        if (!p) return;
        clearTimeout(p.timeout);
        this.pending.delete(event.data.id);
        if (event.data.error) p.reject(new Error(event.data.error)); else p.resolve(event.data.result);
      };
      this.worker.onerror = event => {
        for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error(`解析を開始できませんでした: ${event.message || '辞書処理でエラーが発生しました'}`)); }
        this.pending.clear(); this.worker?.terminate(); this.worker = undefined;
      };
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('辞書の読み込みがタイムアウトしました。再試行するか、一定速度で再生してください。'));
        this.reset();
      }, 60_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker!.postMessage({ id, project, dictionaryURL: new URL(`${import.meta.env.BASE_URL}vendor/dict/`, document.baseURI).pathname });
    });
  }
}
