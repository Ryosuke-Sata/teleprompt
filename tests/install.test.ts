import { describe, expect, it } from 'vitest';
import { getInstallGuide } from '../src/install';

describe('install instructions', () => {
  it('recognizes iPad desktop mode despite the Mac user agent', () => {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15';
    const guide = getInstallGuide({ userAgent, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(guide.destination).toBe('ホーム画面');
    expect(guide.steps.join(' ')).toContain('ウェブアプリとして開く');
  });

  it('uses the Dock path on desktop Safari', () => {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15';
    const guide = getInstallGuide({ userAgent, platform: 'macOS', maxTouchPoints: 0 });
    expect(guide.destination).toBe('Dock');
    expect(guide.steps[0]).toContain('Dockに追加');
  });

  it('uses the Edge menu even when the user agent also identifies as Chrome', () => {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0';
    const guide = getInstallGuide({ userAgent, platform: 'Windows', maxTouchPoints: 0 });
    expect(guide.destination).toBe('スタートメニュー');
    expect(guide.steps.join(' ')).toContain('このサイトをアプリとしてインストール');
  });

  it('uses the Android home screen even when navigator.platform reports Linux', () => {
    const userAgent = 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36';
    const guide = getInstallGuide({ userAgent, platform: 'Linux armv8l', maxTouchPoints: 5 });
    expect(guide.destination).toBe('ホーム画面');
    expect(guide.steps.join(' ')).toContain('ホーム画面に追加');
  });

  it('routes an iPhone in-app browser to Safari', () => {
    const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Instagram 1.0';
    const guide = getInstallGuide({ userAgent, platform: 'iPhone', maxTouchPoints: 5 });
    expect(guide.steps[0]).toContain('Safariで開き');
  });
});
