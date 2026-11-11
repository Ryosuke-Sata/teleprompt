type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'chromeos' | 'desktop' | 'unknown';
type Browser = 'safari' | 'chrome' | 'edge' | 'other' | 'embedded';

interface InstallEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

interface InstallGuide {
  destination: string;
  steps: string[];
  note?: string;
}

export function getInstallGuide({ userAgent, platform, maxTouchPoints }: InstallEnvironment): InstallGuide {
  const isIPadInDesktopMode = /Mac/i.test(platform + userAgent) && maxTouchPoints > 1;
  let os: Platform = 'unknown';
  if (/iPhone|iPad|iPod|\biOS\b/i.test(platform + userAgent) || isIPadInDesktopMode) os = 'ios';
  else if (/Android/i.test(platform + userAgent)) os = 'android';
  else if (/Mac/i.test(platform + userAgent)) os = 'mac';
  else if (/Win/i.test(platform + userAgent)) os = 'windows';
  else if (/CrOS|Chrome OS/i.test(platform + userAgent)) os = 'chromeos';
  else if (/Linux|X11/i.test(platform + userAgent)) os = 'desktop';

  let browser: Browser = 'other';
  if (/FBAN|FBAV|Instagram|Line\/|GSA\/|; wv\)/i.test(userAgent)) browser = 'embedded';
  else if (/Edg(?:e|A|iOS)?\//.test(userAgent)) browser = 'edge';
  else if (/(?:Chrome|CriOS)\//.test(userAgent) && !/SamsungBrowser|OPR\//.test(userAgent)) browser = 'chrome';
  else if (/Version\/[\d.]+.*Safari\//.test(userAgent)) browser = 'safari';

  if (os === 'ios') {
    return {
      destination: 'ホーム画面',
      steps: [
        browser === 'embedded'
          ? 'このページをSafariで開き、共有メニューを開きます。'
          : 'ブラウザの共有メニューを開きます。Safariでは、レイアウトによってページメニュー内に「共有」があります。',
        '「ホーム画面に追加」を選びます。',
        '「ウェブアプリとして開く」が表示されたらオンにし、「追加」をタップします。',
      ],
      note: browser === 'safari'
        ? '「ホーム画面に追加」が見つからない場合は、共有メニュー下部の「アクションを編集」を確認してください。'
        : '共有メニューに「ホーム画面に追加」が見つからない場合は、このページをSafariで開いてください。',
    };
  }

  if (os === 'android') {
    return {
      destination: 'ホーム画面',
      steps: [
        browser === 'chrome' ? 'Chromeの右上にある「︙」を開きます。' : 'このページをChromeで開き、右上の「︙」をタップします。',
        '「ホーム画面に追加」から「インストール」を選びます。「アプリをインストール」が直接表示された場合は、その項目を選びます。',
        'ブラウザの確認画面で追加します。',
      ],
    };
  }

  if (os === 'mac' && browser === 'safari') {
    return {
      destination: 'Dock',
      steps: ['Safariのメニューバーで「ファイル」→「Dockに追加」を選びます。', '名前を確認し、「追加」をクリックします。'],
      note: '「Dockに追加」にはmacOS Sonoma 14以降が必要です。項目が見つからない場合は、ChromeまたはEdgeでも追加できます。',
    };
  }

  const destination = {
    mac: 'Macのアプリ一覧',
    windows: 'スタートメニュー',
    chromeos: 'ランチャー',
    desktop: 'アプリ一覧',
    unknown: '端末のアプリ一覧',
  }[os];

  if (browser === 'edge') {
    return {
      destination,
      steps: ['Edgeの右上にある「…」を開きます。', '「アプリ」→「このサイトをアプリとしてインストール」を選びます。', 'ブラウザの確認画面で「インストール」を選びます。'],
    };
  }

  return {
    destination,
    steps: [
      browser === 'chrome' ? 'Chromeの右上にある「︙」を開きます。' : 'このページをChromeで開き、右上の「︙」を開きます。',
      '「キャスト、保存、共有」→「ページをアプリとしてインストール」を選びます。',
      'ブラウザの確認画面で「インストール」を選びます。',
    ],
  };
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'kotoba-install-invitation-dismissed';

export function setupAppInstall(pausePlayback: () => void) {
  const invitation = document.querySelector<HTMLElement>('#install-invitation')!;
  const invitationCopy = document.querySelector<HTMLElement>('#install-invitation-copy')!;
  const invitationAction = document.querySelector<HTMLButtonElement>('#install-invitation-action')!;
  const dismiss = document.querySelector<HTMLButtonElement>('#install-invitation-dismiss')!;
  const open = document.querySelector<HTMLButtonElement>('#install-open')!;
  const dialog = document.querySelector<HTMLDialogElement>('#install-dialog')!;
  const steps = document.querySelector<HTMLOListElement>('#install-steps')!;
  const note = document.querySelector<HTMLElement>('#install-note')!;

  const device = navigator as Navigator & { userAgentData?: { platform: string }; standalone?: boolean };
  const guide = getInstallGuide({
    userAgent: device.userAgent,
    platform: device.userAgentData?.platform || device.platform,
    maxTouchPoints: device.maxTouchPoints,
  });

  const standalone = window.matchMedia('(display-mode: standalone)');
  let installed = false;
  let promptEvent: InstallPromptEvent | undefined;
  let prompting = false;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    // The current page still remembers the choice if storage is unavailable.
  }

  invitationCopy.textContent = `${guide.destination}から「ことば」を開けます。`;
  note.textContent = guide.note ?? '';
  note.hidden = !guide.note;
  steps.replaceChildren(...guide.steps.map(instruction => {
    const item = document.createElement('li');
    item.textContent = instruction;
    return item;
  }));

  function render() {
    const appMode = installed || standalone.matches || device.standalone === true;
    open.hidden = appMode;
    open.disabled = prompting;
    invitation.hidden = appMode || dismissed;
    invitationAction.textContent = promptEvent ? 'インストール' : '追加方法を見る';
  }

  function dismissInvitation() {
    dismissed = true;
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // The invitation remains dismissed for this page.
    }
    render();
  }

  function showGuide() {
    if (!dialog.open) dialog.showModal();
  }

  async function install() {
    if (prompting || open.hidden) return;
    pausePlayback();
    const browserPrompt = promptEvent;
    if (!browserPrompt) {
      showGuide();
      dismissInvitation();
      return;
    }

    prompting = true;
    promptEvent = undefined;
    try {
      // Keep this call inside the user's click, before any asynchronous work.
      const result = browserPrompt.prompt();
      dismissInvitation();
      if ((await result).outcome === 'accepted') installed = true;
    } catch {
      showGuide();
    } finally {
      prompting = false;
      render();
    }
  }

  invitationAction.addEventListener('click', install);
  dismiss.addEventListener('click', () => {
    dismissInvitation();
    open.focus({ preventScroll: true });
  });
  open.addEventListener('click', install);
  dialog.addEventListener('close', () => {
    if (!open.hidden) open.focus({ preventScroll: true });
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = undefined;
    dismissInvitation();
    if (dialog.open) dialog.close();
  });
  standalone.addEventListener('change', render);
  render();
}
