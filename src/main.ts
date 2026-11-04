import './style.css';
import { Analyzer } from './analysis';
import { DEFAULT_SETTINGS, MAX_TEXT, freshProject, isReading, validateProject, type Project, type Settings } from './model';
import { fallbackAnalysis, parseScript, REHEARSAL_TEXT, rehearsalRate, type Analysis } from './script';
import { createTimeline, measureRows, Transport } from './timeline';

const paths: Record<string, string> = {
  play: 'm9 5 11 7-11 7V5Z', pause: 'M8 5v14M16 5v14',
  back: 'M5 5v14M19 5 8 12l11 7V5Z', prev: 'm15 6-6 6 6 6', next: 'm9 6 6 6-6 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5', download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5', bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  check: 'm5 12 4 4L19 6', tune: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  text: 'M4 5h16M12 5v15M8 20h8', book: 'M12 5v16M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1V4Z',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', plus: 'M12 5v14M5 12h14',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] ?? paths.text}"/></svg>`;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const STORAGE_KEY = 'kotoba-project-v1';
let loadWarning = '';
let project: Project;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  project = saved ? validateProject(JSON.parse(saved)) : freshProject();
} catch {
  project = freshProject();
  loadWarning = '保存データを復元できませんでした。サンプル原稿を表示しています。';
}
// Invalid draft directives must remain editable after automatic restoration.
let analysis: Analysis = { blocks: [], units: [], mora: 0, unknown: 0 };
let transport = new Transport([]);
const analyzer = new Analyzer();
let analysisState: 'loading' | 'ready' | 'failed' = 'loading';
let revision = 0;
let analyzeTimer: ReturnType<typeof setTimeout>;
let countdownUntil = 0;
let saveTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let rehearsalStarted = 0;
let recommendation: number | null = null;
let preservedOffset = 0;
let hasStarted = false;
let selectedStart = 0;
let selectedEnd = 0;
let composing = false;

$('#app').innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="ことば ホーム"><span class="brand-mark">こ</span><span>ことば<small>JAPANESE TELEPROMPTER</small></span></a>
    <div class="header-actions"><span class="privacy"><span class="status-dot"></span>原稿は、このブラウザの中だけに。</span>
      <button id="import" class="button ghost">${icon('upload')}読み込む</button>
      <button id="export" class="button dark">${icon('download')}保存する</button>
    </div>
  </header>
  <main>
    <section class="workspace-heading"><div><div class="eyebrow">YOUR WORDS, YOUR PACE</div><h1>言葉を、あなたのペースで。</h1><p>原稿を整えて、深呼吸。あとは、あなたの声で。</p></div><button id="rehearsal-open" class="button rehearsal-link">${icon('clock')}自分の速さを見つける<span>↗</span></button></section>
    <div class="workspace">
      <section class="editor-card" aria-label="原稿と設定">
        <div class="tabs" role="tablist" aria-label="編集メニュー">
          <button role="tab" id="tab-script" aria-controls="panel-script" aria-selected="true" class="tab active" data-tab="script">${icon('text')}原稿</button>
          <button role="tab" id="tab-readings" aria-controls="panel-readings" aria-selected="false" tabindex="-1" class="tab" data-tab="readings">${icon('book')}読み・辞書</button>
          <button role="tab" id="tab-settings" aria-controls="panel-settings" aria-selected="false" tabindex="-1" class="tab" data-tab="settings">${icon('tune')}設定</button>
        </div>
        <div id="panel-script" class="panel" role="tabpanel" aria-labelledby="tab-script">
          <label class="field-label" for="title">原稿のタイトル</label><input id="title" class="title-input" maxlength="200" value="${escape(project.title)}" />
          <div class="editor-label"><label class="field-label" for="script">本文</label><span id="char-count"></span></div>
          <textarea id="script" spellcheck="false" maxlength="100000" aria-describedby="script-help">${escape(project.text)}</textarea>
          <div class="insert-toolbar"><span>原稿に挿入</span><button data-insert="note">＋ メモ</button><button data-insert="wait">＋ 待機</button><button data-insert="stop">＋ 停止</button></div>
          <p id="script-help" class="hint">空行で段落を区切れます。メモは読まず、待機・停止で間をつくれます。</p>
          <details class="bookmarks" open><summary>${icon('bookmark')}ブックマーク <span id="bookmark-count">0</span></summary><div class="bookmark-add"><input id="bookmark-name" aria-label="ブックマーク名" placeholder="例：本題から" maxlength="80"/><button id="bookmark-add" class="button small">追加</button></div><p class="hint">本文のカーソル位置に追加します。</p><div id="bookmark-list"></div></details>
        </div>
        <div id="panel-readings" class="panel" role="tabpanel" aria-labelledby="tab-readings" hidden>
          <h2>読みを、ひとつずつ。</h2><p class="panel-intro">人名や専門用語の読みを整えると、スクロールも自然になります。</p>
          <div class="section-heading"><h3>この箇所の読み</h3><span class="pill">最優先</span></div><p class="hint">「原稿」タブで文字を選択してから、このタブを開いてください。</p>
          <div id="selection-label" class="selection-label">本文で文字を選択してください</div><form id="override-form" class="inline-form"><input id="override-reading" aria-label="選択箇所の読み" placeholder="よみ（ひらがな・カタカナ）" maxlength="200"/><button class="button small" type="submit">適用</button></form><div id="override-list" class="item-list"></div>
          <div class="section-heading"><h3>ユーザー辞書</h3><span id="dictionary-count" class="pill">0語</span></div><p class="hint">登録した読みは、別の原稿でも使えます。</p>
          <form id="dictionary-form" class="dictionary-form"><label>単語<input id="dictionary-surface" placeholder="例：日本橋" maxlength="80" required/></label><label>読み<input id="dictionary-reading" placeholder="例：にほんばし" maxlength="200" required/></label><button class="button dark" type="submit">${icon('plus')}辞書に登録</button></form><div id="dictionary-list" class="item-list"></div>
          <div class="section-heading"><h3>解析した読み</h3><span id="unknown-count" class="pill"></span></div><p class="hint">黄色は読みが不明な箇所です。時間は推定しています。</p><div id="token-list" class="token-list"></div>
        </div>
        <div id="panel-settings" class="panel" role="tabpanel" aria-labelledby="tab-settings" hidden>
          <h2>心地よい読みやすさに。</h2><p class="panel-intro">調整すると再生は一時停止します。読む位置は保ったまま、再開できます。</p>
          <label class="field-label" for="mode">スクロール方式</label><select id="mode"><option value="adaptive">日本語の読みに合わせる</option><option value="constant">一定の速度で進む</option></select>
          <div class="range-field adaptive-field"><label for="moraPerMinute">読む速さ <output id="moraPerMinute-value"></output></label><input type="range" id="moraPerMinute" min="60" max="1200" step="1"/><div class="range-ends"><span>ゆっくり</span><span>はやく</span></div></div>
          <div class="range-field constant-field" hidden><label for="pixelsPerSecond">移動速度 <output id="pixelsPerSecond-value"></output></label><input type="range" id="pixelsPerSecond" min="5" max="150" step="1"/></div>
          <div class="settings-separator"></div>
          <div class="range-field"><label for="fontSize">文字サイズ <output id="fontSize-value"></output></label><input type="range" id="fontSize" min="20" max="80" step="1"/></div>
          <div class="range-field"><label for="lineHeight">行間 <output id="lineHeight-value"></output></label><input type="range" id="lineHeight" min="1.2" max="3" step="0.1"/></div>
          <div class="range-field"><label for="width">本文の幅 <output id="width-value"></output></label><input type="range" id="width" min="45" max="100" step="1"/></div>
          <div class="color-fields"><label>文字色<input id="foreground" type="color"/></label><label>背景色<input id="background" type="color"/></label></div>
          <div class="settings-separator"></div><label class="field-label" for="countdown">開始前カウントダウン</label><select id="countdown"><option value="0">なし</option><option value="3">3秒</option><option value="5">5秒</option></select>
          <div class="pause-fields"><label>読点の間（秒）<input id="commaPause" type="number" min="0" max="3" step="0.05"/></label><label>句点の間（秒）<input id="periodPause" type="number" min="0" max="5" step="0.1"/></label><label>段落の間（秒）<input id="paragraphPause" type="number" min="0" max="5" step="0.1"/></label></div>
          <button id="reset-settings" class="button ghost full-width">表示・速度設定を初期値に戻す</button>
        </div>
        <div class="editor-bottom"><span id="save-status">${icon('check')}ブラウザに自動保存</span><span>UTF-8</span></div>
      </section>
      <section class="prompter-card" id="prompter" aria-label="テレプロンプター">
        <div class="prompter-heading"><span class="preview-title"><span class="status-dot"></span> PROMPTER <span id="play-state">停止中</span></span><div><button id="focus" class="preview-action" aria-label="集中モードに切り替え">集中モード</button><button id="fullscreen" class="icon-button" aria-label="全画面表示">${icon('expand')}</button></div></div>
        <div class="viewport" id="viewport"><div class="reading-guide" aria-hidden="true"><span>›</span></div><div class="track-window"><div class="script-track" id="track"></div></div><div class="countdown-overlay" id="countdown-overlay" hidden><span id="countdown-number"></span><small>深呼吸して、始めましょう。</small></div><div class="stage-bottom-fade" aria-hidden="true"></div></div>
        <div class="transport-area"><div class="playback-info"><span id="position-label">原稿のはじめ</span><span id="time-label">約 0:00</span></div><input id="progress" type="range" min="0" max="1000" value="0" aria-label="読む位置"/>
          <div class="transport-buttons"><div class="left-controls"><button id="rewind" class="icon-button" aria-label="先頭に戻る" title="先頭に戻る（Home）">${icon('back')}</button><button id="previous" class="icon-button" aria-label="前の段落" title="前の段落（←）">${icon('prev')}</button></div><button id="play" class="play-button">${icon('play')}<span>再生する</span></button><div class="right-controls"><button id="next" class="icon-button" aria-label="次の段落" title="次の段落（→）">${icon('next')}</button><span class="keyboard-key">Space</span></div></div>
        </div>
        <div class="analysis-bar"><span id="analysis-status" role="status">日本語辞書を読み込み中…</span><button id="retry-analysis" hidden>再試行</button><span id="mode-label">日本語補正 ON</span></div>
      </section>
    </div>
    <footer><span>ことば <span class="footer-divider">/</span> あなたの言葉を、まっすぐに。</span><div><button id="help-open">使い方</button><a href="${import.meta.env.BASE_URL}vendor/THIRD-PARTY.txt" target="_blank" rel="noopener">ライセンス</a><a href="${import.meta.env.BASE_URL}vendor/IPADIC-NOTICE.txt" target="_blank" rel="noopener">辞書について</a></div></footer>
  </main>
  <div id="toast" class="toast" role="status" hidden></div>
  <input id="file-input" type="file" accept=".json,.txt,application/json,text/plain" hidden/>
  <dialog id="save-dialog"><div class="dialog-heading"><h2>原稿を持ち出す</h2><button data-close="save-dialog" class="close-button" aria-label="閉じる">×</button></div><p>ブラウザの保存とは別に、ファイルを手元に残せます。</p><button id="export-json" class="export-option"><strong>原稿と設定を保存 <span>JSON ↗</span></strong><small>読み・辞書・ブックマークも、まとめて復元できます。</small></button><button id="export-txt" class="export-option"><strong>本文だけを保存 <span>TXT ↗</span></strong><small>UTF-8のテキスト。メモや待機の指示行も含みます。</small></button><p class="hint">JSON読み込み時は、ユーザー辞書を含めファイルの内容に置き換わります。現在の内容は先に保存してください。</p></dialog>
  <dialog id="rehearsal-dialog"><div class="dialog-heading"><h2>自分の速さを見つける</h2><button data-close="rehearsal-dialog" class="close-button" aria-label="閉じる">×</button></div><p>開始を押して、下の文章を自然な速さで読んでください。読み終えたら「計測を終える」を押します。マイクは使いません。</p><div class="rehearsal-script">${REHEARSAL_TEXT}</div><div class="rehearsal-result"><span id="rehearsal-time">0:00</span><p id="rehearsal-result">句読点の間も含めて、普段どおりに。</p></div><div class="dialog-actions"><button id="rehearsal-start" class="button dark">計測を始める</button><button id="rehearsal-apply" class="button" disabled>この速さを使う</button></div></dialog>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>ことばの使い方</h2><button data-close="help-dialog" class="close-button" aria-label="閉じる">×</button></div><ol><li>本文に原稿を入力します。空行で段落を区切れます。</li><li>「設定」で文字サイズや速さを調整し、再生します。</li><li>漢字の読みは自動推定です。「読み・辞書」で確認・修正できます。</li><li>「保存する」からJSONを保存すると、原稿も設定も復元できます。</li></ol><h3>キーボード</h3><p>Space：再生・一時停止 ／ ← →：前後の段落 ／ Home：先頭<br>入力欄の編集中はショートカットを無効にします。</p><h3>メモと間の入れ方</h3><p>次の指示を、それぞれ専用の行に記入します。</p><pre>[[メモ:ここでカメラを見る]]\n[[待機:2]]\n[[停止]]</pre><p class="hint">メモは読み時間に含まれません。停止は再生ボタンで解除。本文を編集すると、位置が変わる読み修正・ブックマークはリセットされます。ユーザー辞書は残ります。</p><h3>推定時間について</h3><p>表示時間は目安です。人名・数字・英字の読みは誤ることがあります。黄色の推定箇所は、読みの指定をおすすめします。手動停止で待つ時間は推定時間に含まれません。</p><p class="hint">原稿・設定はブラウザ内で処理します。自動保存はブラウザのデータ削除で消えるため、JSONでも保存してください。TXTはUTF-8対応です。</p></dialog>
`;

function notify(message: string) {
  const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5500);
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); $('#save-status').innerHTML = `${icon('check')}ブラウザに自動保存`; }
  catch { $('#save-status').textContent = '自動保存できません。JSONで保存してください。'; }
}
function formatTime(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function pause() {
  transport.pause(); countdownUntil = 0; $('#countdown-overlay').hidden = true; updatePlayback();
}
function currentOffset() { return transport.current?.start ?? (transport.steps.length ? project.text.length : 0); }
function syncSettings() {
  const s = project.settings;
  for (const [key, value] of Object.entries(s)) {
    const input = $<HTMLInputElement | HTMLSelectElement>(`#${key}`);
    input.value = String(value);
    const output = document.getElementById(`${key}-value`);
    if (output) output.textContent = `${value}${({ moraPerMinute: ' 拍/分', pixelsPerSecond: ' px/秒', fontSize: ' px', lineHeight: ' 倍', width: ' %' } as Record<string, string>)[key] ?? ''}`;
  }
  $('.adaptive-field').hidden = s.mode !== 'adaptive'; $('.constant-field').hidden = s.mode !== 'constant';
  $('#mode-label').textContent = s.mode === 'adaptive' ? '日本語補正 ON' : '一定速度';
  const stage = $('#viewport'); stage.style.setProperty('--prompt-size', `${s.fontSize}px`); stage.style.setProperty('--prompt-leading', String(s.lineHeight)); stage.style.setProperty('--prompt-width', `${s.width}%`); stage.style.color = s.foreground; stage.style.background = s.background;
  stage.style.setProperty('--prompt-background', s.background);
}
function renderPreview() {
  const track = $('#track'); track.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const block of analysis.blocks) {
    const p = document.createElement('div'); p.dataset.block = String(block.id); p.className = `script-block ${block.kind}`;
    if (block.kind === 'text') {
      let offset = block.start;
      for (const char of block.text) {
        if (char === '\n') p.appendChild(document.createElement('br'));
        else { const span = document.createElement('span'); span.dataset.offset = String(offset); span.textContent = char; p.appendChild(span); }
        offset += char.length;
      }
    } else p.textContent = block.kind === 'space' ? '\u00a0' : `${block.kind === 'note' ? 'メモ  ' : block.kind === 'wait' ? '◷  ' : 'Ⅱ  '}${block.text}`;
    fragment.appendChild(p);
  }
  if (!project.text.trim()) { const empty = document.createElement('p'); empty.className = 'preview-empty'; empty.textContent = 'あなたの言葉を、ここに。'; fragment.appendChild(empty); }
  track.appendChild(fragment);
  rebuildTimeline(preservedOffset);
}
function rebuildTimeline(offset = currentOffset()) {
  const rows = measureRows($('#track'), analysis, project.settings);
  transport = new Transport(createTimeline(rows, project.settings));
  let index = transport.steps.findIndex(s => s.start <= offset && s.end > offset);
  if (index < 0) index = transport.steps.findIndex(s => s.start >= offset);
  transport.seek(index < 0 ? Math.max(0, transport.steps.length - 1) : index);
  updatePlayback();
}
function renderLists() {
  $('#char-count').textContent = `${project.text.length.toLocaleString()} 文字`;
  $('#dictionary-count').textContent = `${project.dictionary.length}語`;
  $('#bookmark-count').textContent = String(project.bookmarks.length);
  $('#bookmark-list').innerHTML = project.bookmarks.length ? project.bookmarks.map((b, i) => `<div class="list-item"><button data-bookmark="${i}" class="bookmark-jump">${icon('bookmark')}${escape(b.name)}</button><button data-remove-bookmark="${i}" class="remove-button" aria-label="${escape(b.name)}を削除">×</button></div>`).join('') : '<p class="empty-label">あとで戻りたい場所に、目印を。</p>';
  $('#dictionary-list').innerHTML = project.dictionary.map((d, i) => `<div class="list-item"><span><strong>${escape(d.surface)}</strong><small>${escape(d.reading)}</small></span><button data-remove-dictionary="${i}" class="remove-button" aria-label="${escape(d.surface)}の辞書登録を削除">×</button></div>`).join('');
  $('#override-list').innerHTML = project.overrides.map((d, i) => `<div class="list-item"><span><strong>${escape(d.text)}</strong><small>${escape(d.reading)}</small></span><button data-remove-override="${i}" class="remove-button" aria-label="読み修正を削除">×</button></div>`).join('');
  $('#unknown-count').textContent = analysis.unknown ? `${analysis.unknown}箇所を推定` : '読みを確認';
  $('#token-list').innerHTML = analysis.units.filter(u => u.mora > 0).slice(0, 500).map(u => `<span class="token ${u.unknown ? 'unknown' : ''} ${u.source === 'override' || u.source === 'dictionary' ? 'custom' : ''}" title="${escape(u.source === 'estimate' ? '読み不明・推定時間' : u.reading)}"><span>${escape(u.text)}</span><small>${escape(u.unknown ? '推定' : u.reading)}</small></span>`).join('');
  if (analysis.units.length > 500) $('#token-list').insertAdjacentHTML('beforeend', '<p class="hint">読みの一覧は先頭500区間まで表示しています。</p>');
}
async function analyzeProject() {
  const version = ++revision;
  preservedOffset = currentOffset(); pause();
  try { analysis = fallbackAnalysis(project.text, project.dictionary, project.overrides); }
  catch (error) {
    analysis = { blocks: [], units: [], mora: 0, unknown: 0 }; analysisState = 'failed'; renderPreview();
    $('#analysis-status').textContent = (error as Error).message; $('#retry-analysis').hidden = true;
    $('#play').setAttribute('disabled', ''); renderLists(); return;
  }
  $('#play').removeAttribute('disabled'); analysisState = 'loading';
  $('#analysis-status').textContent = '日本語の読みを解析中…'; $('#retry-analysis').hidden = true;
  renderPreview(); renderLists(); updatePlayback();
  // Snapshot the project before crossing the worker boundary.
  try {
    const result = await analyzer.analyze(structuredClone(project));
    if (revision !== version) return;
    preservedOffset = currentOffset(); pause(); analysis = result; analysisState = 'ready';
    $('#analysis-status').textContent = `読みの解析完了 · ${analysis.mora.toLocaleString()}拍${analysis.unknown ? ` · ${analysis.unknown}箇所は推定` : ''}`;
    renderPreview(); renderLists();
  } catch (error) {
    if (revision !== version) return;
    analysisState = 'failed'; $('#analysis-status').textContent = `${(error as Error).message} 一定速度で再生できます。`; $('#retry-analysis').hidden = false;
    updatePlayback();
  }
}
function scheduleAnalysis() {
  ++revision; analysisState = 'loading'; pause(); clearTimeout(analyzeTimer);
  // Prevent playing a timeline that still belongs to the old script.
  $('#play').setAttribute('disabled', ''); $('#analysis-status').textContent = '原稿の更新を待っています…';
  analyzeTimer = setTimeout(() => { void analyzeProject(); }, 350);
}
function updatePlayback() {
  $('#track').style.transform = `translateY(${-transport.y}px)`;
  const counting = countdownUntil > 0;
  const running = transport.playing || counting;
  const state = counting ? '開始待ち' : transport.waitingForUser ? '再開を待っています' : transport.playing ? '再生中' : transport.index >= transport.steps.length && transport.steps.length ? '読み終わり' : '停止中';
  $('#play-state').textContent = state;
  $('#prompter').classList.toggle('playing', running);
  $('#play').innerHTML = `${icon(running ? 'pause' : 'play')}<span>${counting ? '中止する' : transport.playing ? '一時停止' : transport.waitingForUser ? '続きから再開' : '再生する'}</span>`;
  $('#time-label').textContent = `残り 約 ${formatTime(transport.duration - transport.consumed)}${analysis.blocks.some(b => b.kind === 'stop') ? ' ＋ 停止' : ''}`;
  const current = transport.current;
  const paragraphs = analysis.blocks.filter(b => b.kind === 'text');
  const paragraphIndex = current ? paragraphs.findIndex(b => b.id === current.blockId) : -1;
  $('#position-label').textContent = current?.kind === 'wait' ? `待機中 ${Math.max(0, Math.ceil(current.seconds - transport.elapsed))}秒` : current?.kind === 'stop' ? '準備ができたら、再生を押してください' : paragraphIndex >= 0 ? `段落 ${paragraphIndex + 1} / ${paragraphs.length}` : !current && transport.steps.length ? 'すべて読み終わりました' : '原稿のはじめ';
  $<HTMLInputElement>('#progress').value = String(transport.steps.length ? Math.min(1000, (transport.index + (current?.seconds ? transport.elapsed / current.seconds : 0)) / transport.steps.length * 1000) : 0);
  const play = $<HTMLButtonElement>('#play');
  if (analysisState !== 'ready' && project.settings.mode === 'adaptive') play.disabled = true;
  else if (analysis.blocks.length && project.text.trim()) play.disabled = false;
  else play.disabled = true;
}
function startPlayback() {
  if ($<HTMLButtonElement>('#play').disabled) return;
  if (transport.playing || countdownUntil) { pause(); return; }
  if (transport.index >= transport.steps.length) { transport.seek(0); hasStarted = false; }
  if (!hasStarted && project.settings.countdown > 0 && !transport.waitingForUser) {
    countdownUntil = performance.now() + project.settings.countdown * 1000;
    $('#countdown-overlay').hidden = false;
    $('#countdown-number').textContent = String(project.settings.countdown);
  } else { transport.play(); hasStarted = true; }
  updatePlayback();
}
function seekOffset(offset: number) {
  pause(); hasStarted = false;
  const index = transport.steps.findIndex(s => s.start <= offset && s.end > offset);
  const next = transport.steps.findIndex(s => s.start >= offset);
  transport.seek(index >= 0 ? index : next >= 0 ? next : 0); updatePlayback();
}
function paragraphMove(direction: number) {
  const paragraphs = analysis.blocks.filter(b => b.kind === 'text');
  const offset = currentOffset();
  const target = direction > 0 ? paragraphs.find(b => b.start > offset) : [...paragraphs].reverse().find(b => b.start < offset);
  if (target) seekOffset(target.start);
}
function invalidatePositions() {
  if (project.overrides.length || project.bookmarks.length) notify('本文を変更したため、箇所ごとの読み修正とブックマークをリセットしました。ユーザー辞書は残ります。');
  project.overrides = []; project.bookmarks = []; selectedStart = selectedEnd = 0;
}
function trackSelection() {
  const input = $<HTMLTextAreaElement>('#script');
  selectedStart = input.selectionStart; selectedEnd = input.selectionEnd;
}
function insertDirective(value: string) {
  const input = $<HTMLTextAreaElement>('#script');
  const before = project.text.slice(0, selectedStart); const after = project.text.slice(selectedEnd);
  const inserted = `${before && !before.endsWith('\n') ? '\n' : ''}${value}\n`;
  if (before.length + inserted.length + after.length > MAX_TEXT) { notify('本文は10万文字までです。'); return; }
  const cursor = before.length + inserted.length;
  invalidatePositions(); project.text = before + inserted + after; input.value = project.text; input.focus(); input.setSelectionRange(cursor, cursor); trackSelection(); persist(); scheduleAnalysis();
}
function changeSettings() {
  const offset = currentOffset(); pause();
  const candidate = { ...project.settings } as unknown as Record<string, string | number>;
  for (const key of Object.keys(candidate)) {
    const input = $<HTMLInputElement | HTMLSelectElement>(`#${key}`);
    candidate[key] = ['mode', 'foreground', 'background'].includes(key) ? input.value : Number(input.value);
  }
  try { project.settings = validateProject({ ...project, settings: candidate }).settings; }
  catch (error) { notify((error as Error).message); syncSettings(); return; }
  syncSettings(); rebuildTimeline(offset); persist();
}
function showTab(name: string) {
  document.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => { const active = tab.dataset.tab === name; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
  document.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.id !== `panel-${name}`; });
  $('#selection-label').textContent = selectedEnd > selectedStart ? project.text.slice(selectedStart, selectedEnd) : '本文で文字を選択してください';
}
function download(content: string, extension: string) {
  const url = URL.createObjectURL(new Blob([content], { type: extension === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${project.title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || '原稿'}${extension === 'json' ? '.teleprompt.json' : '.txt'}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); $<HTMLDialogElement>('#save-dialog').close();
}

$('#title').addEventListener('input', () => { project.title = $<HTMLInputElement>('#title').value; persist(); });
$('#script').addEventListener('input', () => {
  const input = $<HTMLTextAreaElement>('#script');
  const text = input.value.replace(/\r\n?/g, '\n');
  if (text === project.text) return;
  invalidatePositions(); project.text = text; hasStarted = false; persist();
  if (!composing) scheduleAnalysis();
  else { ++revision; analysisState = 'loading'; pause(); $('#play').setAttribute('disabled', ''); }
  renderLists();
});
$('#script').addEventListener('compositionstart', () => { composing = true; clearTimeout(analyzeTimer); });
$('#script').addEventListener('compositionend', () => { composing = false; scheduleAnalysis(); });
for (const event of ['select', 'keyup', 'click', 'blur']) $('#script').addEventListener(event, trackSelection);
document.querySelectorAll<HTMLElement>('[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab!));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const tabs = ['script', 'readings', 'settings']; const index = tabs.indexOf(tab.dataset.tab!);
    const name = tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; showTab(name); $(`#tab-${name}`).focus();
  });
});
for (const key of Object.keys(project.settings)) $(`#${key}`).addEventListener('input', changeSettings);
$('#reset-settings').addEventListener('click', () => { const offset = currentOffset(); pause(); project.settings = { ...DEFAULT_SETTINGS }; syncSettings(); rebuildTimeline(offset); persist(); });
$('#play').addEventListener('click', startPlayback);
$('#rewind').addEventListener('click', () => seekOffset(0));
$('#previous').addEventListener('click', () => paragraphMove(-1));
$('#next').addEventListener('click', () => paragraphMove(1));
$('#progress').addEventListener('input', () => { pause(); hasStarted = false; transport.seek(Math.round(Number($<HTMLInputElement>('#progress').value) / 1000 * Math.max(0, transport.steps.length - 1))); updatePlayback(); });
$('#retry-analysis').addEventListener('click', () => { analyzer.reset(); void analyzeProject(); });
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#prompter').requestFullscreen(); }
  catch { notify('このブラウザでは全画面表示を利用できません。集中モードをお試しください。'); }
});
$('#focus').addEventListener('click', () => { document.body.classList.toggle('focus-mode'); $('#focus').textContent = document.body.classList.contains('focus-mode') ? '編集画面に戻る' : '集中モード'; pause(); });
document.addEventListener('fullscreenchange', () => { pause(); });
document.querySelectorAll<HTMLElement>('[data-insert]').forEach(button => button.addEventListener('click', () => {
  const directive = button.dataset.insert;
  insertDirective(directive === 'note' ? '[[メモ:ここでカメラを見る]]' : directive === 'wait' ? '[[待機:2]]' : '[[停止]]');
}));
$('#bookmark-add').addEventListener('click', () => {
  const name = $<HTMLInputElement>('#bookmark-name').value.trim();
  if (!name) { notify('ブックマーク名を入力してください。'); return; }
  const offset = Math.min(selectedStart, Math.max(0, project.text.length - 1));
  if (!project.text.length) { notify('先に本文を入力してください。'); return; }
  if (project.bookmarks.length >= 500) { notify('ブックマークは500件までです。'); return; }
  project.bookmarks.push({ id: crypto.randomUUID(), name, offset, text: project.text.slice(offset, offset + 30) });
  $<HTMLInputElement>('#bookmark-name').value = ''; renderLists(); persist(); notify('カーソル位置にブックマークを追加しました。');
});
$('#override-form').addEventListener('submit', event => {
  event.preventDefault(); const reading = $<HTMLInputElement>('#override-reading').value.trim();
  if (!isReading(reading)) { notify('読みをひらがな・カタカナで入力してください。'); return; }
  const text = project.text.slice(selectedStart, selectedEnd);
  if (!text || text.length > 200 || !analysis.blocks.some(b => b.kind === 'text' && selectedStart >= b.start && selectedEnd <= b.end)) { notify('原稿の本文から200文字以内で、読みを直す箇所を選択してください。'); return; }
  project.overrides = project.overrides.filter(o => !(o.start < selectedEnd && o.end > selectedStart));
  if (project.overrides.length >= 1000) { notify('読み修正は1000件までです。'); return; }
  project.overrides.push({ start: selectedStart, end: selectedEnd, text, reading }); persist(); scheduleAnalysis(); renderLists(); notify('選択箇所の読みを修正しました。');
});
$('#dictionary-form').addEventListener('submit', event => {
  event.preventDefault();
  const surface = $<HTMLInputElement>('#dictionary-surface').value.trim(); const reading = $<HTMLInputElement>('#dictionary-reading').value.trim();
  if (!surface || /\s|\[\[/.test(surface) || !isReading(reading)) { notify('単語に空白や指示を含めず、読みはひらがな・カタカナで入力してください。'); return; }
  const existing = project.dictionary.find(d => d.surface === surface);
  if (existing) existing.reading = reading;
  else if (project.dictionary.length >= 500) { notify('ユーザー辞書は500語までです。'); return; }
  else project.dictionary.push({ surface, reading });
  $<HTMLFormElement>('#dictionary-form').reset(); persist(); scheduleAnalysis(); renderLists(); notify('辞書に登録しました。原稿内の同じ単語に適用します。');
});
document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('button');
  if (!button) return;
  if (button.dataset.bookmark !== undefined) seekOffset(project.bookmarks[Number(button.dataset.bookmark)].offset);
  if (button.dataset.removeBookmark !== undefined) { project.bookmarks.splice(Number(button.dataset.removeBookmark), 1); persist(); renderLists(); }
  if (button.dataset.removeDictionary !== undefined) { project.dictionary.splice(Number(button.dataset.removeDictionary), 1); persist(); scheduleAnalysis(); renderLists(); }
  if (button.dataset.removeOverride !== undefined) { project.overrides.splice(Number(button.dataset.removeOverride), 1); persist(); scheduleAnalysis(); renderLists(); }
  if (button.dataset.close) $<HTMLDialogElement>(`#${button.dataset.close}`).close();
});
$('#export').addEventListener('click', () => { pause(); $<HTMLDialogElement>('#save-dialog').showModal(); });
$('#export-json').addEventListener('click', () => download(JSON.stringify(project, null, 2), 'json'));
$('#export-txt').addEventListener('click', () => download(project.text, 'txt'));
$('#import').addEventListener('click', () => { pause(); $<HTMLInputElement>('#file-input').click(); });
$('#file-input').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#file-input'); const file = input.files?.[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('ファイルは2MB以下にしてください。');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    let next: Project;
    if (file.name.toLowerCase().endsWith('.json')) next = validateProject(JSON.parse(text));
    else if (file.name.toLowerCase().endsWith('.txt')) {
      const body = text.replace(/\r\n?/g, '\n'); if (body.length > MAX_TEXT) throw new Error('本文は10万文字までです。');
      next = { ...project, title: file.name.replace(/\.txt$/i, '').slice(0, 200), text: body, overrides: [], bookmarks: [] };
    } else throw new Error('JSONまたはUTF-8のTXTファイルを選択してください。');
    parseScript(next.text); // Validate directives before replacing the current project.
    clearTimeout(analyzeTimer); project = next; selectedStart = selectedEnd = 0; hasStarted = false;
    $('#selection-label').textContent = '本文で文字を選択してください';
    $<HTMLTextAreaElement>('#script').value = project.text; $<HTMLInputElement>('#title').value = project.title;
    transport.seek(0); preservedOffset = 0; syncSettings(); persist(); await analyzeProject(); notify('原稿を読み込みました。');
  } catch (error) { notify(`読み込めませんでした。${(error as Error).message}`); }
  finally { input.value = ''; }
});
$('#help-open').addEventListener('click', () => { pause(); $<HTMLDialogElement>('#help-dialog').showModal(); });
$('#rehearsal-open').addEventListener('click', () => {
  pause(); rehearsalStarted = 0; recommendation = null;
  $('#rehearsal-time').textContent = '0:00'; $('#rehearsal-result').textContent = '句読点の間も含めて、普段どおりに。'; $('#rehearsal-start').textContent = '計測を始める'; $<HTMLButtonElement>('#rehearsal-apply').disabled = true;
  $<HTMLDialogElement>('#rehearsal-dialog').showModal();
});
$('#rehearsal-start').addEventListener('click', () => {
  if (!rehearsalStarted) { rehearsalStarted = performance.now(); $('#rehearsal-start').textContent = '計測を終える'; recommendation = null; $<HTMLButtonElement>('#rehearsal-apply').disabled = true; }
  else {
    const seconds = (performance.now() - rehearsalStarted) / 1000; rehearsalStarted = 0;
    recommendation = rehearsalRate(seconds); $('#rehearsal-start').textContent = 'もう一度計測';
    $('#rehearsal-result').textContent = recommendation ? `あなたの目安は ${recommendation} 拍/分。適用すると句読点・段落の追加の間は0秒になります。` : '計測が短すぎるか、対応範囲（60〜1200拍/分）外です。文章を最後まで読み、もう一度お試しください。';
    $<HTMLButtonElement>('#rehearsal-apply').disabled = recommendation === null;
  }
});
$('#rehearsal-apply').addEventListener('click', () => {
  if (recommendation === null) return;
  const offset = currentOffset(); project.settings.moraPerMinute = recommendation; project.settings.mode = 'adaptive';
  // The measured pace already includes the reader's natural pauses. Avoid counting them twice.
  project.settings.commaPause = 0; project.settings.periodPause = 0; project.settings.paragraphPause = 0;
  syncSettings(); rebuildTimeline(offset); persist(); $<HTMLDialogElement>('#rehearsal-dialog').close(); notify(`${recommendation}拍/分を設定しました。間は「設定」から追加できます。`);
});
$('#rehearsal-dialog').addEventListener('close', () => { rehearsalStarted = 0; });
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || target.closest('input, textarea, select, button, [contenteditable="true"], [role="tab"]') || document.querySelector('dialog[open]')) return;
  if (event.code === 'Space') { event.preventDefault(); startPlayback(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); paragraphMove(-1); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); paragraphMove(1); }
  else if (event.key === 'Home') { event.preventDefault(); seekOffset(0); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    if (rehearsalStarted) {
      rehearsalStarted = 0; recommendation = null;
      $('#rehearsal-start').textContent = '計測を始める';
      $('#rehearsal-result').textContent = '画面を離れたため、計測を中止しました。もう一度お試しください。';
      $<HTMLButtonElement>('#rehearsal-apply').disabled = true;
    }
  }
});
window.addEventListener('pagehide', saveNow);
let resizeTimer: ReturnType<typeof setTimeout>;
new ResizeObserver(() => { const offset = currentOffset(); pause(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => rebuildTimeline(offset), 100); }).observe($('#viewport'));
let previousFrame = performance.now();
function frame(now: number) {
  const delta = (now - previousFrame) / 1000; previousFrame = now;
  if (countdownUntil) {
    const remaining = Math.ceil((countdownUntil - now) / 1000); $('#countdown-number').textContent = String(Math.max(1, remaining));
    if (now >= countdownUntil) { countdownUntil = 0; $('#countdown-overlay').hidden = true; hasStarted = true; transport.play(); }
  } else if (transport.playing) { transport.tick(Math.min(delta, 0.25)); }
  if (rehearsalStarted) $('#rehearsal-time').textContent = formatTime((now - rehearsalStarted) / 1000);
  if (transport.playing || transport.waitingForUser || countdownUntil || $('#play-state').textContent === '再生中' || $('#play-state').textContent === '開始待ち') updatePlayback();
  requestAnimationFrame(frame);
}
syncSettings(); renderPreview(); renderLists(); void analyzeProject(); requestAnimationFrame(frame);
if (loadWarning) notify(loadWarning);
