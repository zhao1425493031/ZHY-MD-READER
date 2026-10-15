(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const webview = window.chrome && window.chrome.webview;
  const post = msg => webview && webview.postMessage(msg);

  const scroller = $('scroller');
  const content = $('content');
  const tocList = $('toc-list');
  const filesList = $('files-list');
  const filesBody = $('files-body');
  const sidebar = $('sidebar');
  const ctxMenu = $('ctx-menu');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  const THEMES = ['auto', 'light', 'dark'];
  const HTML_LANG = { en: 'en', zh: 'zh-CN', ja: 'ja' };
  const ITEM_MIME = 'application/x-smartmd-item';

  const ICON_FILE = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3.75 1.5h5.19c.2 0 .39.08.53.22l3.31 3.31c.14.14.22.33.22.53v8.69c0 .41-.34.75-.75.75h-8.5a.75.75 0 0 1-.75-.75V2.25c0-.41.34-.75.75-.75ZM4.5 3v10.5h7V6.5H9.25a.75.75 0 0 1-.75-.75V3h-4Zm5.5.56V5h1.44L10 3.56ZM6 8.5h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1Zm0 2h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1Z"/></svg>';
  const ICON_FOLDER = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.75 2.5h4.19c.2 0 .39.08.53.22l1.06 1.06c.14.14.33.22.53.22h6.19c.41 0 .75.34.75.75v8.5c0 .41-.34.75-.75.75H1.75A.75.75 0 0 1 1 13.25V3.25c0-.41.34-.75.75-.75ZM2.5 4v8.75h11V5.5H8.06c-.6 0-1.17-.24-1.59-.66L5.63 4H2.5Z"/></svg>';

  const state = {
    theme: 'auto',
    sidebar: true,
    language: 'en',
    currentPath: null,
    layout: { sidebarWidth: 280, filesRatio: 0.45, filesCollapsed: false, tocCollapsed: false, editorRatio: 0.5 },
  };
  const MODES = ['read', 'split', 'edit'];
  const edit = { mode: 'read', editor: null, source: '', saved: '', dirty: false, canEdit: false, pendingSave: null, previewTimer: 0 };
  const pen = { active: false, tool: 'pen', color: '#e5534b', size: 4, strokes: [], history: [], current: null, erasing: null, width: 0 };
  let lineMarks = [];

  const editorLabels = {};
  const reading = { contentWidth: 90, fontSize: 16 };

  // 宿主在「是否保存」时通过 ExecuteScript 取编辑器内容
  window.SmartMd = { getText: () => (edit.editor ? edit.editor.getText() : null) };
  let strings = {};
  let library = [];
  let headings = [];
  let tocLinks = [];
  let pendingRenameId = null;

  // ---------- 国际化 ----------
  function t(key, ...args) {
    const text = strings[key] ?? key;
    return text.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? args[i] : m));
  }

  function applyStrings() {
    document.documentElement.lang = HTML_LANG[state.language] || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $('btn-theme').textContent = t(`ui.theme.${state.theme}`);
    Object.assign(editorLabels, {
      linkText: t('ui.fmt.linkText'),
      imageAlt: t('ui.fmt.imageAlt'),
      headerCell: t('ui.fmt.headerCell'),
      cell: t('ui.fmt.cell'),
    });
    updateStats();
  }

  // ---------- 主题 ----------
  function applyTheme() {
    const effective = state.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.theme;
    document.documentElement.dataset.theme = effective;
    $('md-light').disabled = effective === 'dark';
    $('md-dark').disabled = effective !== 'dark';
    $('hl-light').disabled = effective === 'dark';
    $('hl-dark').disabled = effective !== 'dark';
    $('btn-theme').textContent = t(`ui.theme.${state.theme}`);
    $('set-theme').value = state.theme;
    if (edit.editor) edit.editor.setDark(effective === 'dark');
    if (mermaidTheme !== null && mermaidTheme !== effective) renderMermaid();
  }

  function applyReading() {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--content-w', `${reading.contentWidth}%`);
    rootStyle.setProperty('--content-fs', `${reading.fontSize}px`);
    $('set-width').value = String(reading.contentWidth);
    $('set-font-size').value = String(reading.fontSize);
  }

  function setTheme(theme) {
    state.theme = THEMES.includes(theme) ? theme : 'auto';
    applyTheme();
    saveSettings();
  }

  function cycleTheme() {
    setTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]);
  }

  function applySidebar() {
    document.body.classList.toggle('sidebar-hidden', !state.sidebar);
    $('set-toc').checked = state.sidebar;
  }

  function toggleSidebar() {
    state.sidebar = !state.sidebar;
    applySidebar();
    saveSettings();
  }

  function saveSettings(extra) {
    post({
      type: 'settings',
      theme: state.theme,
      toc: state.sidebar,
      contentWidth: reading.contentWidth,
      fontSize: reading.fontSize,
      ...extra,
    });
  }

  // ---------- 侧栏布局 ----------
  function applyLayout() {
    const { sidebarWidth, filesRatio, filesCollapsed, tocCollapsed, editorRatio } = state.layout;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--sidebar-w', `${sidebarWidth}px`);
    rootStyle.setProperty('--files-h', `${filesRatio * 100}%`);
    rootStyle.setProperty('--editor-grow', String(editorRatio));
    rootStyle.setProperty('--preview-grow', String(1 - editorRatio));
    document.body.classList.toggle('files-collapsed', filesCollapsed);
    document.body.classList.toggle('toc-collapsed', tocCollapsed);
  }

  function saveLayout() {
    post({ type: 'layout', ...state.layout });
  }

  $('files-header').addEventListener('click', event => {
    if (event.target.closest('.pane-btn')) return;
    state.layout.filesCollapsed = !state.layout.filesCollapsed;
    applyLayout();
    saveLayout();
  });

  $('toc-header').addEventListener('click', () => {
    if (document.body.classList.contains('toc-none')) return;
    state.layout.tocCollapsed = !state.layout.tocCollapsed;
    applyLayout();
    saveLayout();
  });

  function dragHandle(handle, bodyClass, onMove) {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add(bodyClass);
      const move = e => onMove(e);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove(bodyClass);
        saveLayout();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  dragHandle($('sidebar-resizer'), 'resizing', event => {
    const left = sidebar.getBoundingClientRect().left;
    state.layout.sidebarWidth = Math.round(Math.min(Math.max(event.clientX - left, 160), Math.min(800, window.innerWidth - 240)));
    applyLayout();
  });

  dragHandle($('pane-splitter'), 'splitting', event => {
    const rect = sidebar.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    state.layout.filesRatio = Math.min(Math.max(ratio, 0.12), 0.88);
    applyLayout();
  });

  dragHandle($('editor-splitter'), 'resizing-editor', event => {
    const left = $('editor-pane').getBoundingClientRect().left;
    const right = $('preview-wrap').getBoundingClientRect().right;
    const ratio = (event.clientX - left) / (right - left);
    state.layout.editorRatio = Math.min(Math.max(ratio, 0.15), 0.85);
    applyLayout();
  });

  // ---------- 设置 ----------
  function fillLanguages(languages) {
    const select = $('set-language');
    select.innerHTML = '';
    languages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.name;
      select.appendChild(option);
    });
    select.value = state.language;
  }

  function openSettings() {
    hideMenu();
    document.body.classList.add('settings-open');
    $('set-language').focus();
  }

  function closeSettings() {
    document.body.classList.remove('settings-open');
    scroller.focus({ preventScroll: true });
  }

  $('set-language').addEventListener('change', event => saveSettings({ language: event.target.value }));
  $('set-theme').addEventListener('change', event => setTheme(event.target.value));
  $('set-width').addEventListener('change', event => {
    reading.contentWidth = Number(event.target.value) || 90;
    applyReading();
    saveSettings();
  });
  $('set-font-size').addEventListener('change', event => {
    reading.fontSize = Number(event.target.value) || 16;
    applyReading();
    saveSettings();
  });
  $('set-toc').addEventListener('change', event => {
    state.sidebar = event.target.checked;
    applySidebar();
    saveSettings();
  });
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-overlay').addEventListener('click', event => {
    if (event.target === $('settings-overlay')) closeSettings();
  });

  // ---------- 渲染 ----------
  function render(msg) {
    const same = samePath(msg.path, state.currentPath);
    const previousScroll = msg.keepScroll ? scroller.scrollTop : 0;

    $('doc-base').href = msg.baseHref;
    content.innerHTML = msg.html;
    document.body.classList.remove('empty', 'load-failed');
    setFileInfo(msg.name, msg.path);
    $('btn-back').disabled = !msg.canGoBack;

    edit.canEdit = true;
    loadSource(msg.source ?? '', same && msg.keepScroll);
    if (!same || !msg.keepScroll) clearPen();

    enhanceContent();
    buildToc();
    collectLineMarks();

    if (!same && headings.length > 0 && state.layout.tocCollapsed) {
      state.layout.tocCollapsed = false;
      applyLayout();
      saveLayout();
    }

    // 窗口激活时 WebView2 会把焦点交给文档里的可聚焦元素并滚动过去，先把焦点固定在滚动区域
    if (edit.mode === 'read') scroller.focus({ preventScroll: true });

    if (msg.fragment) {
      scrollToId(msg.fragment);
    } else if (edit.mode === 'split' && msg.keepScroll) {
      syncPreviewToEditor();
    } else {
      scroller.scrollTop = previousScroll;
      restoreScrollAfterImages(previousScroll);
    }
    updateActiveHeading();

    if (pendingReveal && samePath(pendingReveal.path, msg.path)) {
      const { line } = pendingReveal;
      pendingReveal = null;
      requestAnimationFrame(() => revealLine(line));
    }
  }

  function applyPreview(html) {
    const previousScroll = scroller.scrollTop;
    content.innerHTML = html;
    enhanceContent();
    buildToc();
    collectLineMarks();
    clearPen();
    if (edit.mode === 'split') syncPreviewToEditor();
    else scroller.scrollTop = previousScroll;
    updateActiveHeading();
  }

  // 图片加载完后页面高度会变，重新定位一次，避免位置漂移
  function restoreScrollAfterImages(position) {
    const pending = [...content.querySelectorAll('img')].filter(img => !img.complete);
    if (pending.length === 0) return;
    let left = pending.length;
    const done = () => {
      if (--left === 0 && Math.abs(scroller.scrollTop - position) > 2) scroller.scrollTop = position;
    };
    pending.forEach(img => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  function showEmpty() {
    content.innerHTML = '';
    tocList.innerHTML = '';
    headings = [];
    tocLinks = [];
    document.body.classList.add('empty', 'toc-none');
    setFileInfo('', '');
    disableEditing();
    updateStats();
  }

  function showError(msg) {
    document.body.classList.remove('empty');
    document.body.classList.add('toc-none', 'load-failed');
    disableEditing();
    tocList.innerHTML = '';
    setFileInfo(msg.name, msg.path);
    content.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'load-error';
    box.textContent = t('ui.error.loadFailed', msg.message);
    content.appendChild(box);
  }

  function setFileInfo(name, path) {
    $('file-name').textContent = name || '';
    $('file-path').textContent = path || '';
    document.title = name ? `${name} - SmartMdReader` : 'SmartMdReader';
    state.currentPath = path || null;
    markActiveFile();
  }

  let contentGen = 0;

  function enhanceContent() {
    contentGen++;
    enhanceCodeBlocks();
    renderMath();
    renderMermaid();
    updateStats();
    applySearchHighlight();
  }

  // ---------- 按需加载的第三方脚本 ----------
  const scriptLoads = {};
  function loadScript(src) {
    if (!scriptLoads[src]) {
      scriptLoads[src] = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
          delete scriptLoads[src];
          reject(new Error(`load failed: ${src}`));
        };
        document.head.appendChild(script);
      });
    }
    return scriptLoads[src];
  }

  // ---------- 数学公式（KaTeX） ----------
  function renderMath() {
    const nodes = [...content.querySelectorAll('.math')];
    if (nodes.length === 0) return;
    if (!window.katex) {
      const gen = contentGen;
      loadScript('https://app.smartmd/vendor/katex/katex.min.js')
        .then(() => {
          if (gen === contentGen) {
            renderMath();
            updateStats();
          }
        })
        .catch(() => {});
      return;
    }
    nodes.forEach(el => {
      if (el.dataset.rendered) return;
      const display = el.tagName === 'DIV';
      let tex = el.textContent.trim();
      tex = display ? tex.replace(/^\\\[|\\\]$/g, '') : tex.replace(/^\\\(|\\\)$/g, '');
      try {
        katex.render(tex, el, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
        el.dataset.rendered = '1';
      } catch {
        // 保留原文
      }
    });
  }

  // ---------- Mermaid 图表 ----------
  let mermaidTheme = null;
  let mermaidSeq = 0;
  const mermaidCache = new Map();

  async function renderMermaid() {
    if (!content.querySelector('.mermaid')) return;
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const gen = contentGen;
    try {
      await loadScript('https://app.smartmd/vendor/mermaid.min.js');
    } catch {
      return;
    }
    if (gen !== contentGen) return;
    if (mermaidTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
      });
      mermaidTheme = theme;
    }

    for (const el of content.querySelectorAll('.mermaid')) {
      if (!el.dataset.source) el.dataset.source = el.textContent.trim();
      if (el.dataset.rendered === theme) continue;
      const source = el.dataset.source;
      const key = `${theme}\n${source}`;
      let svg = mermaidCache.get(key);
      if (!svg) {
        try {
          ({ svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, source));
          mermaidCache.set(key, svg);
          if (mermaidCache.size > 60) mermaidCache.delete(mermaidCache.keys().next().value);
        } catch (err) {
          document.querySelectorAll(`#dmermaid-${mermaidSeq}, #mermaid-${mermaidSeq}`).forEach(n => n.remove());
          if (!el.isConnected) continue;
          el.textContent = source;
          const box = document.createElement('div');
          box.className = 'mermaid-error';
          box.textContent = `${t('ui.mermaid.error')}: ${(err && err.message) || err}`;
          el.appendChild(box);
          continue;
        }
      }
      if (!el.isConnected) continue;
      el.innerHTML = svg;
      el.dataset.rendered = theme;
    }
    if (edit.mode === 'split') syncPreviewToEditor();
  }

  // ---------- 字数统计 ----------
  const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
  function updateStats() {
    const el = $('doc-stats');
    if (document.body.classList.contains('empty') || !content.textContent.trim()) {
      el.textContent = '';
      return;
    }
    const clone = content.cloneNode(true);
    clone.querySelectorAll('.copy-btn, .mermaid, .katex-mathml').forEach(n => n.remove());
    const text = clone.textContent;
    const cjk = (text.match(CJK) || []).length;
    const words = (text.replace(CJK, ' ').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
    const minutes = Math.max(1, Math.round(cjk / 400 + words / 200));
    el.textContent = cjk > words
      ? t('ui.stats.cjk', (cjk + words).toLocaleString(), minutes)
      : t('ui.stats', words.toLocaleString(), minutes);
  }

  function enhanceCodeBlocks() {
    content.querySelectorAll('pre > code').forEach(code => {
      const langClass = [...code.classList].find(c => c.startsWith('language-'));
      const lang = langClass ? langClass.slice('language-'.length) : '';
      if (lang && window.hljs && hljs.getLanguage(lang)) {
        hljs.highlightElement(code);
      }

      const button = document.createElement('button');
      button.className = 'copy-btn';
      button.tabIndex = -1;
      button.textContent = t('ui.copy');
      button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(code.innerText);
          button.textContent = t('ui.copy.done');
        } catch {
          button.textContent = t('ui.copy.failed');
        }
        setTimeout(() => { button.textContent = t('ui.copy'); }, 1200);
      });
      code.parentElement.appendChild(button);
    });
  }

  // ---------- 目录 ----------
  function buildToc() {
    headings = [...content.querySelectorAll('h1, h2, h3, h4')].filter(h => h.id);
    tocList.innerHTML = '';
    tocLinks = [];
    document.body.classList.toggle('toc-none', headings.length === 0);
    if (headings.length === 0) return;

    const minLevel = Math.min(...headings.map(h => Number(h.tagName[1])));
    headings.forEach(h => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.textContent = h.textContent.trim();
      a.title = a.textContent;
      a.style.paddingLeft = `${10 + (Number(h.tagName[1]) - minLevel) * 14}px`;
      a.addEventListener('click', event => {
        event.preventDefault();
        if (edit.mode !== 'read' && edit.editor && h.dataset.line) {
          edit.editor.gotoLine(Number(h.dataset.line) + 1);
          if (edit.mode === 'edit') return;
        }
        h.scrollIntoView({ block: 'start' });
      });
      li.appendChild(a);
      tocList.appendChild(li);
      tocLinks.push(a);
    });
  }

  function updateActiveHeading() {
    if (headings.length === 0) return;
    const top = scroller.getBoundingClientRect().top + 80;
    let index = 0;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top <= top) index = i;
      else break;
    }
    tocLinks.forEach((a, i) => a.classList.toggle('active', i === index));
    const active = tocLinks[index];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  let scrollTicking = false;
  scroller.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      updateActiveHeading();
    });
  });

  function scrollToId(id) {
    if (!id) return;
    const target = document.getElementById(id)
      || document.getElementById(id.toLowerCase())
      || document.getElementsByName(id)[0];
    if (target) target.scrollIntoView({ block: 'start' });
  }

  // ---------- 文件列表 ----------
  const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const folders = () => library.filter(i => i.type === 'folder');

  function renderLibrary() {
    const scrollTop = filesBody.scrollTop;
    filesList.innerHTML = '';
    library.forEach(item => {
      filesList.appendChild(item.type === 'folder' ? folderNode(item) : fileNode(item, null));
    });
    $('files-empty').hidden = library.length > 0;
    filesBody.scrollTop = scrollTop;
    markActiveFile();

    if (pendingRenameId) {
      const row = filesList.querySelector(`.lib-row[data-kind="folder"][data-key="${CSS.escape(pendingRenameId)}"]`);
      pendingRenameId = null;
      if (row) startRename(row);
    }
  }

  function fileNode(item, folderId) {
    const li = document.createElement('li');
    li.className = 'lib-file';
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.classList.toggle('missing', item.missing);
    row.draggable = true;
    row.dataset.kind = 'file';
    row.dataset.key = item.path;
    row.dataset.folder = folderId || '';
    row.title = item.missing ? `${item.path}\n(${t('ui.files.missing')})` : item.path;
    row.innerHTML = `<span class="icon">${ICON_FILE}</span><span class="name"></span>`;
    row.querySelector('.name').textContent = item.name;
    li.appendChild(row);
    return li;
  }

  function folderNode(item) {
    const li = document.createElement('li');
    li.className = 'lib-folder';
    li.classList.toggle('collapsed', !item.expanded);
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.draggable = true;
    row.dataset.kind = 'folder';
    row.dataset.key = item.id;
    row.title = item.name;
    row.innerHTML = `<span class="folder-chevron">▾</span><span class="icon">${ICON_FOLDER}</span><span class="name"></span><span class="count"></span>`;
    row.querySelector('.name').textContent = item.name;
    row.querySelector('.count').textContent = item.items.length || '';
    li.appendChild(row);

    const ul = document.createElement('ul');
    item.items.forEach(file => ul.appendChild(fileNode(file, item.id)));
    li.appendChild(ul);
    return li;
  }

  function markActiveFile() {
    filesList.querySelectorAll('.lib-row[data-kind="file"]').forEach(row => {
      const active = samePath(row.dataset.key, state.currentPath);
      row.classList.toggle('active', active);
      row.classList.toggle('dirty', active && edit.dirty);
    });
  }

  function findFolder(id) {
    return library.find(i => i.type === 'folder' && i.id === id);
  }

  function libOp(op, args) {
    post({ type: 'lib', op, ...args });
  }

  function newFolder() {
    const id = crypto.randomUUID();
    pendingRenameId = id;
    if (state.layout.filesCollapsed) {
      state.layout.filesCollapsed = false;
      applyLayout();
      saveLayout();
    }
    libOp('newFolder', { id, name: t('ui.files.newFolder') });
  }

  function toggleFolder(row) {
    const li = row.parentElement;
    const expanded = li.classList.contains('collapsed');
    li.classList.toggle('collapsed', !expanded);
    libOp('toggle', { id: row.dataset.key, expanded });
  }

  function startRename(row) {
    const nameEl = row.querySelector('.name');
    const original = nameEl.textContent;
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = original;
    row.draggable = false;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = commit => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.replaceWith(nameEl);
      row.draggable = true;
      if (commit && value && value !== original) {
        nameEl.textContent = value;
        libOp('rename', { id: row.dataset.key, name: value });
      }
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', event => event.stopPropagation());
  }

  filesList.addEventListener('click', event => {
    const row = event.target.closest('.lib-row');
    if (!row || event.target.closest('input')) return;
    if (row.dataset.kind === 'folder') toggleFolder(row);
    else post({ type: 'openFile', path: row.dataset.key });
  });

  $('btn-add-files').addEventListener('click', () => post({ type: 'addFiles' }));
  $('btn-new-folder').addEventListener('click', newFolder);

  // ---------- 右键菜单 ----------
  function showMenu(x, y, items) {
    ctxMenu.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      if (item.sep) {
        el.className = 'sep';
      } else if (item.header) {
        el.className = 'header';
        el.textContent = item.header;
      } else {
        el.className = 'item';
        el.classList.toggle('indent', !!item.indent);
        el.classList.toggle('danger', !!item.danger);
        el.classList.toggle('disabled', !!item.disabled);
        el.textContent = item.label;
        el.title = item.label;
        el.addEventListener('click', () => {
          hideMenu();
          item.action();
        });
      }
      ctxMenu.appendChild(el);
    });

    ctxMenu.classList.add('open');
    const rect = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
    ctxMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;
  }

  function hideMenu() {
    ctxMenu.classList.remove('open');
  }

  function fileMenu(row) {
    const path = row.dataset.key;
    const currentFolder = row.dataset.folder;
    const items = [
      { label: t('ui.files.open'), action: () => post({ type: 'openFile', path }) },
      { label: t('ui.files.reveal'), action: () => libOp('reveal', { key: path }) },
    ];

    const targets = [];
    if (currentFolder) targets.push({ label: t('ui.files.topLevel'), folderId: null });
    folders().filter(f => f.id !== currentFolder).forEach(f => targets.push({ label: f.name, folderId: f.id }));
    if (targets.length > 0) {
      items.push({ sep: true }, { header: t('ui.files.moveTo') });
      targets.forEach(target => items.push({
        label: target.label,
        indent: true,
        action: () => libOp('move', { key: path, folderId: target.folderId, before: null }),
      }));
    }

    items.push({ sep: true }, { label: t('ui.files.remove'), danger: true, action: () => libOp('remove', { key: path }) });
    return items;
  }

  function folderMenu(row) {
    const id = row.dataset.key;
    return [
      { label: t('ui.files.add'), action: () => post({ type: 'addFiles', folderId: id }) },
      { label: t('ui.files.newFolder'), action: newFolder },
      { label: t('ui.files.rename'), action: () => startRename(row) },
      { sep: true },
      { label: t('ui.files.deleteFolder'), danger: true, action: () => libOp('deleteFolder', { id }) },
    ];
  }

  function blankMenu() {
    const anyMissing = library.some(i => (i.type === 'folder' ? i.items.some(f => f.missing) : i.missing));
    return [
      { label: t('ui.files.newFolder'), action: newFolder },
      { label: t('ui.files.add'), action: () => post({ type: 'addFiles' }) },
      { sep: true },
      { label: t('ui.files.removeMissing'), disabled: !anyMissing, action: () => libOp('removeMissing') },
    ];
  }

  $('files-pane').addEventListener('contextmenu', event => {
    event.preventDefault();
    if (event.target.closest('input')) return;
    const row = event.target.closest('.lib-row');
    const items = !row ? blankMenu() : row.dataset.kind === 'folder' ? folderMenu(row) : fileMenu(row);
    showMenu(event.clientX, event.clientY, items);
  });

  document.addEventListener('pointerdown', event => {
    if (!ctxMenu.contains(event.target)) hideMenu();
  });
  window.addEventListener('blur', hideMenu);
  window.addEventListener('resize', hideMenu);
  filesBody.addEventListener('scroll', hideMenu);

  // ---------- 文件列表内拖动排序 ----------
  let dragItem = null;

  function clearDropMarks() {
    filesList.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach(el => {
      el.classList.remove('drop-before', 'drop-after', 'drop-into');
    });
    filesBody.classList.remove('drop-root');
  }

  const isExternalFileDrag = event => [...event.dataTransfer.types].includes('Files');

  // 计算落点：{ mark: 行元素与标记类, folderId: 目标容器, before: 插在谁前面 }
  function computeDrop(event) {
    const row = event.target.closest('.lib-row');
    const external = isExternalFileDrag(event);

    if (!row) return { root: true, folderId: null, before: null };

    const rect = row.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const kind = row.dataset.kind;

    if (external) {
      const folderId = kind === 'folder' ? row.dataset.key : (row.dataset.folder || null);
      const markRow = folderId ? filesList.querySelector(`.lib-row[data-kind="folder"][data-key="${CSS.escape(folderId)}"]`) : null;
      return markRow ? { row: markRow, cls: 'drop-into', folderId } : { root: true, folderId: null };
    }

    if (kind === 'folder') {
      const folderId = row.dataset.key;
      if (dragItem.kind === 'file' && ratio > 0.25 && ratio < 0.75) {
        return { row, cls: 'drop-into', folderId, before: null };
      }
      const after = ratio >= 0.5;
      return { row, cls: after ? 'drop-after' : 'drop-before', folderId: null, before: after ? nextKey(null, folderId) : folderId };
    }

    const folderId = row.dataset.folder || null;
    if (dragItem.kind === 'folder' && folderId) {
      // 文件夹只能放在最外层：以目标文件所在的文件夹为参照
      const folderRow = filesList.querySelector(`.lib-row[data-kind="folder"][data-key="${CSS.escape(folderId)}"]`);
      const after = ratio >= 0.5;
      return { row: folderRow, cls: after ? 'drop-after' : 'drop-before', folderId: null, before: after ? nextKey(null, folderId) : folderId };
    }

    const after = ratio >= 0.5;
    return {
      row,
      cls: after ? 'drop-after' : 'drop-before',
      folderId,
      before: after ? nextKey(folderId, row.dataset.key) : row.dataset.key,
    };
  }

  function keyOf(item) {
    return item.type === 'folder' ? item.id : item.path;
  }

  function nextKey(folderId, key) {
    const container = folderId ? (findFolder(folderId)?.items || []) : library;
    const index = container.findIndex(i => (i.type === 'folder' ? i.id === key : samePath(i.path, key)));
    const next = container[index + 1];
    return next ? keyOf(next) : null;
  }

  filesList.addEventListener('dragstart', event => {
    const row = event.target.closest('.lib-row');
    if (!row) return;
    hideMenu();
    dragItem = { kind: row.dataset.kind, key: row.dataset.key };
    event.dataTransfer.setData(ITEM_MIME, row.dataset.key);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });

  filesList.addEventListener('dragend', () => {
    filesList.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    clearDropMarks();
    dragItem = null;
  });

  $('files-pane').addEventListener('dragover', event => {
    const external = isExternalFileDrag(event);
    if (!external && !dragItem) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = external ? 'copy' : 'move';
    document.body.classList.add('drag-sidebar');

    clearDropMarks();
    const drop = computeDrop(event);
    if (drop.root) filesBody.classList.add('drop-root');
    else if (drop.row) drop.row.classList.add(drop.cls);
  });

  $('files-pane').addEventListener('dragleave', event => {
    if (!$('files-pane').contains(event.relatedTarget)) {
      clearDropMarks();
      document.body.classList.remove('drag-sidebar');
    }
  });

  $('files-pane').addEventListener('drop', event => {
    const external = isExternalFileDrag(event);
    if (!external && !dragItem) return;
    event.preventDefault();
    event.stopPropagation();
    const drop = computeDrop(event);
    clearDropMarks();
    endExternalDrag();

    if (external) {
      sendDroppedFiles(event.dataTransfer.files, drop.folderId || null, false);
      return;
    }
    if (drop.before && drop.before === dragItem.key) return;
    libOp('move', { key: dragItem.key, folderId: drop.folderId || null, before: drop.before ?? null });
    dragItem = null;
  });

  // ---------- 从资源管理器拖入 ----------
  let dragDepth = 0;

  function endExternalDrag() {
    dragDepth = 0;
    document.body.classList.remove('dragging', 'drag-sidebar');
  }

  function sendDroppedFiles(files, folderId, open) {
    if (files.length > 0 && webview && webview.postMessageWithAdditionalObjects) {
      webview.postMessageWithAdditionalObjects(JSON.stringify({ type: 'drop', folderId, open }), files);
    }
  }

  document.addEventListener('dragenter', event => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', event => {
    if (!isExternalFileDrag(event)) return;
    if (--dragDepth <= 0) endExternalDrag();
  });
  document.addEventListener('dragover', event => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    document.body.classList.remove('drag-sidebar');
  });
  document.addEventListener('drop', event => {
    event.preventDefault();
    if (!isExternalFileDrag(event)) return;
    endExternalDrag();
    sendDroppedFiles(event.dataTransfer.files, null, true);
  });

  // ---------- 链接 ----------
  function onLinkClick(event) {
    const a = event.target.closest('a[href]');
    if (!a || !content.contains(a)) return;
    event.preventDefault();

    const raw = a.getAttribute('href');
    if (raw.startsWith('#')) {
      scrollToId(decodeURIComponent(raw.slice(1)));
      return;
    }
    post({ type: 'link', href: a.href });
  }

  document.addEventListener('click', onLinkClick);
  document.addEventListener('auxclick', event => {
    if (event.button === 1) onLinkClick(event);
  });

  // ---------- 提示 ----------
  let toastTimer = 0;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ---------- 编辑 ----------
  const isDark = () => document.documentElement.dataset.theme === 'dark';

  function ensureEditor() {
    if (edit.editor || !window.SmartEditor) return;
    edit.editor = SmartEditor.create($('editor-host'), {
      doc: edit.source,
      dark: isDark(),
      onChange: onEditorChange,
      onScroll: () => {
        if (syncLock !== 'preview') syncPreviewToEditor();
      },
      onPasteImage: pasteImage,
      labels: editorLabels,
    });
  }

  function setMode(mode) {
    if (!MODES.includes(mode) || !edit.canEdit) mode = 'read';
    const changed = mode !== edit.mode;
    edit.mode = mode;
    MODES.forEach(m => document.body.classList.toggle(`mode-${m}`, m === mode));
    document.querySelectorAll('#mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    if (changed) post({ type: 'mode', mode });
    if (mode === 'edit') closePen();
    if (mode !== 'edit') refreshPreview();

    if (mode === 'read') {
      scroller.focus({ preventScroll: true });
    } else {
      ensureEditor();
      if (edit.editor) {
        edit.editor.refresh();
        edit.editor.focus();
      }
      if (mode === 'split') requestAnimationFrame(syncPreviewToEditor);
    }
    if (pen.active) requestAnimationFrame(resizePenCanvas);
  }

  function cycleMode() {
    if (!edit.canEdit) return;
    setMode(MODES[(MODES.indexOf(edit.mode) + 1) % MODES.length]);
  }

  function disableEditing() {
    edit.canEdit = false;
    clearTimeout(edit.previewTimer);
    loadSource('', false);
    clearPen();
    closePen();
    setMode('read');
  }

  function loadSource(source, sameDoc) {
    clearTimeout(edit.previewTimer);
    edit.source = source;
    edit.saved = source;
    edit.previewed = source;
    if (edit.editor) {
      if (sameDoc) edit.editor.replaceDoc(source);
      else edit.editor.setDoc(source);
    }
    document.body.classList.remove('external-change');
    setDirty(false);
  }

  function setDirty(dirty) {
    document.body.classList.toggle('dirty', dirty);
    if (edit.dirty === dirty) return;
    edit.dirty = dirty;
    markActiveFile();
    post({ type: 'dirty', dirty });
  }

  function onEditorChange() {
    clearTimeout(edit.previewTimer);
    edit.previewTimer = setTimeout(() => {
      const text = edit.editor.getText();
      setDirty(text !== edit.saved);
      if (edit.mode === 'split') refreshPreview();
    }, 150);
  }

  function refreshPreview() {
    if (!edit.editor || !edit.canEdit) return;
    const text = edit.editor.getText();
    if (text === edit.previewed) return;
    edit.previewed = text;
    post({ type: 'preview', text });
  }

  function saveDoc() {
    if (!edit.editor || !edit.canEdit || edit.mode === 'read') return;
    edit.pendingSave = edit.editor.getText();
    post({ type: 'save', text: edit.pendingSave });
  }

  function onSaved(text) {
    edit.saved = typeof text === 'string' ? text : (edit.pendingSave ?? edit.saved);
    edit.pendingSave = null;
    document.body.classList.remove('external-change');
    setDirty(edit.editor ? edit.editor.getText() !== edit.saved : false);
    toast(t('ui.edit.saved'));
  }

  // 预览里每个块的源码行号（递增），用来按编辑器位置同步滚动
  function collectLineMarks() {
    lineMarks = [];
    let last = -1;
    content.querySelectorAll('[data-line]').forEach(el => {
      const line = Number(el.dataset.line);
      if (line > last && el.getClientRects().length > 0) {
        lineMarks.push({ line, el });
        last = line;
      }
    });
  }

  function syncPreviewToEditor() {
    if (edit.mode !== 'split' || !edit.editor || lineMarks.length === 0) return;
    const line = edit.editor.topLine() - 1;
    let i = 0;
    while (i + 1 < lineMarks.length && lineMarks[i + 1].line <= line) i++;
    const a = lineMarks[i];
    const b = lineMarks[i + 1];
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const topA = a.el.getBoundingClientRect().top - origin;
    let y = topA;
    if (line < a.line) {
      y = 0;
    } else if (b) {
      const topB = b.el.getBoundingClientRect().top - origin;
      y = topA + (topB - topA) * Math.min(1, (line - a.line) / (b.line - a.line));
    }
    lockSync('editor');
    scroller.scrollTop = Math.max(0, y - SYNC_OFFSET);
  }

  // 双向同步：正在滚动的一侧持有锁，另一侧被程序滚动产生的 scroll 事件不再反向同步
  const SYNC_OFFSET = 12;
  let syncLock = null;
  let syncLockTimer = 0;
  function lockSync(side) {
    syncLock = side;
    clearTimeout(syncLockTimer);
    syncLockTimer = setTimeout(() => { syncLock = null; }, 120);
  }

  function syncEditorToPreview() {
    if (edit.mode !== 'split' || !edit.editor || lineMarks.length === 0) return;
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const topOf = i => lineMarks[i].el.getBoundingClientRect().top - origin;
    const y = scroller.scrollTop + SYNC_OFFSET;

    let line;
    if (y < topOf(0)) {
      line = lineMarks[0].line * (y / Math.max(topOf(0), 1));
    } else {
      let lo = 0;
      let hi = lineMarks.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (topOf(mid) <= y) lo = mid;
        else hi = mid - 1;
      }
      const a = lineMarks[lo];
      const b = lineMarks[lo + 1];
      line = a.line;
      if (b) {
        const topA = topOf(lo);
        const topB = topOf(lo + 1);
        if (topB > topA) line += (b.line - a.line) * Math.min(1, (y - topA) / (topB - topA));
      }
    }
    lockSync('preview');
    edit.editor.scrollToLine(line + 1);
  }

  scroller.addEventListener('scroll', () => {
    if (edit.mode === 'split' && syncLock !== 'editor') syncEditorToPreview();
  });

  document.querySelectorAll('#mode-switch button').forEach(button => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  $('btn-save').addEventListener('click', saveDoc);
  $('banner-keep').addEventListener('click', () => document.body.classList.remove('external-change'));
  $('banner-reload').addEventListener('click', () => {
    document.body.classList.remove('external-change');
    if (edit.editor) edit.saved = edit.editor.getText();
    setDirty(false);
    post({ type: 'forceReload' });
  });

  // ---------- 演示笔 ----------
  const penCanvas = $('pen-canvas');
  const penCtx = penCanvas.getContext('2d');
  let penFrame = 0;

  function openPen() {
    if (edit.mode === 'edit' || document.body.classList.contains('empty')) return;
    hideMenu();
    pen.active = true;
    document.body.classList.add('pen-on');
    $('btn-pen').classList.add('active');
    updatePenToolbar();
    resizePenCanvas();
  }

  function closePen() {
    if (!pen.active) return;
    pen.active = false;
    pen.current = null;
    pen.erasing = null;
    clearPen();
    document.body.classList.remove('pen-on', 'pen-eraser');
    $('btn-pen').classList.remove('active');
  }

  function togglePen() {
    if (pen.active) closePen();
    else openPen();
  }

  function clearPen() {
    pen.strokes = [];
    pen.history = [];
    pen.current = null;
    pen.erasing = null;
    redrawPen();
  }

  function updatePenToolbar() {
    document.querySelectorAll('.pen-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === pen.tool));
    document.querySelectorAll('.pen-color').forEach(b => b.classList.toggle('active', b.dataset.color === pen.color));
    document.querySelectorAll('.pen-size').forEach(b => b.classList.toggle('active', Number(b.dataset.size) === pen.size));
    document.body.classList.toggle('pen-eraser', pen.tool === 'eraser');
  }

  // 画布只盖住内容区，不挡滚动条；宽度变化会导致重新排版，笔迹随之清空
  function resizePenCanvas() {
    if (!pen.active) return;
    const width = scroller.clientWidth;
    const height = scroller.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (pen.width && pen.width !== width) clearPen();
    pen.width = width;
    penCanvas.style.width = `${width}px`;
    penCanvas.style.height = `${height}px`;
    penCanvas.style.right = 'auto';
    penCanvas.style.bottom = 'auto';
    penCanvas.width = Math.round(width * dpr);
    penCanvas.height = Math.round(height * dpr);
    redrawPen();
  }

  function scheduleRedraw() {
    if (penFrame) return;
    penFrame = requestAnimationFrame(() => {
      penFrame = 0;
      redrawPen();
    });
  }

  const strokeWidth = (s, pressure) => {
    const base = s.tool === 'highlighter' ? s.size * 4 : s.size;
    return s.pressure ? base * (0.4 + (pressure ?? 0.5)) : base;
  };

  function drawStroke(s) {
    const pts = s.points;
    penCtx.save();
    penCtx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
    penCtx.strokeStyle = s.color;
    penCtx.fillStyle = s.color;
    penCtx.lineCap = s.tool === 'highlighter' ? 'butt' : 'round';
    penCtx.lineJoin = 'round';

    if (pts.length === 1) {
      penCtx.beginPath();
      penCtx.arc(pts[0].x, pts[0].y, strokeWidth(s, pts[0].p) / 2, 0, Math.PI * 2);
      penCtx.fill();
    } else if (s.pressure && s.tool !== 'highlighter') {
      for (let i = 1; i < pts.length; i++) {
        penCtx.lineWidth = strokeWidth(s, pts[i].p);
        penCtx.beginPath();
        penCtx.moveTo(pts[i - 1].x, pts[i - 1].y);
        penCtx.lineTo(pts[i].x, pts[i].y);
        penCtx.stroke();
      }
    } else {
      penCtx.lineWidth = strokeWidth(s, 0.5);
      penCtx.beginPath();
      penCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        penCtx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const end = pts[pts.length - 1];
      penCtx.lineTo(end.x, end.y);
      penCtx.stroke();
    }
    penCtx.restore();
  }

  function redrawPen() {
    const dpr = window.devicePixelRatio || 1;
    penCtx.setTransform(1, 0, 0, 1, 0, 0);
    penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
    if (!pen.active || pen.strokes.length === 0) return;
    penCtx.setTransform(dpr, 0, 0, dpr, 0, -scroller.scrollTop * dpr);
    pen.strokes.forEach(drawStroke);
  }

  // 笔迹坐标记录在文档坐标系（含滚动偏移），滚动时跟着内容走
  function penPoint(e) {
    const rect = penCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top + scroller.scrollTop,
      p: e.pressure || 0.5,
    };
  }

  function eraseAt(pt) {
    for (let i = pen.strokes.length - 1; i >= 0; i--) {
      const s = pen.strokes[i];
      const reach = 8 + strokeWidth(s, 0.5) / 2;
      if (s.points.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) <= reach)) {
        pen.strokes.splice(i, 1);
        pen.erasing.push({ stroke: s, index: i });
      }
    }
    scheduleRedraw();
  }

  function undoPen() {
    const action = pen.history.pop();
    if (!action) return;
    if (action.type === 'add') {
      const index = pen.strokes.indexOf(action.stroke);
      if (index >= 0) pen.strokes.splice(index, 1);
    } else {
      for (let i = action.items.length - 1; i >= 0; i--) {
        pen.strokes.splice(action.items[i].index, 0, action.items[i].stroke);
      }
    }
    redrawPen();
  }

  penCanvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    penCanvas.setPointerCapture(event.pointerId);
    const pt = penPoint(event);
    // 数位笔尾端橡皮 (button 5) 也当橡皮擦
    if (pen.tool === 'eraser' || event.button === 5) {
      pen.erasing = [];
      eraseAt(pt);
      return;
    }
    pen.current = {
      tool: pen.tool,
      color: pen.color,
      size: pen.size,
      pressure: event.pointerType === 'pen',
      points: [pt],
    };
    pen.strokes.push(pen.current);
    scheduleRedraw();
  });

  penCanvas.addEventListener('pointermove', event => {
    if (!pen.current && !pen.erasing) return;
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    (events.length ? events : [event]).forEach(e => {
      const pt = penPoint(e);
      if (pen.current) pen.current.points.push(pt);
      else eraseAt(pt);
    });
    scheduleRedraw();
  });

  const finishPenStroke = () => {
    if (pen.current) {
      pen.history.push({ type: 'add', stroke: pen.current });
      pen.current = null;
    }
    if (pen.erasing) {
      if (pen.erasing.length) pen.history.push({ type: 'erase', items: pen.erasing });
      pen.erasing = null;
    }
  };
  penCanvas.addEventListener('pointerup', finishPenStroke);
  penCanvas.addEventListener('pointercancel', finishPenStroke);

  penCanvas.addEventListener('wheel', event => {
    event.preventDefault();
    scroller.scrollTop += event.deltaY;
  }, { passive: false });

  scroller.addEventListener('scroll', () => {
    if (pen.active) scheduleRedraw();
  });
  new ResizeObserver(() => resizePenCanvas()).observe(scroller);

  document.querySelectorAll('.pen-tool').forEach(b => b.addEventListener('click', () => {
    pen.tool = b.dataset.tool;
    updatePenToolbar();
  }));
  document.querySelectorAll('.pen-color').forEach(b => b.addEventListener('click', () => {
    pen.color = b.dataset.color;
    if (pen.tool === 'eraser') pen.tool = 'pen';
    updatePenToolbar();
  }));
  document.querySelectorAll('.pen-size').forEach(b => b.addEventListener('click', () => {
    pen.size = Number(b.dataset.size);
    if (pen.tool === 'eraser') pen.tool = 'pen';
    updatePenToolbar();
  }));
  $('pen-undo').addEventListener('click', undoPen);
  $('pen-clear').addEventListener('click', clearPen);
  $('pen-close').addEventListener('click', closePen);
  $('btn-pen').addEventListener('click', togglePen);

  // ---------- 编辑器格式工具栏 / 粘贴图片 ----------
  const editorToolbar = $('editor-toolbar');
  editorToolbar.addEventListener('mousedown', event => event.preventDefault());
  editorToolbar.addEventListener('click', event => {
    const button = event.target.closest('button[data-fmt]');
    if (button && edit.editor) edit.editor.format(button.dataset.fmt);
  });

  let imageSeq = 0;
  function pasteImage(file) {
    if (!edit.canEdit) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return;
      post({ type: 'pasteImage', id: String(++imageSeq), mime: file.type, data: dataUrl.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  }

  function onImageSaved(msg) {
    if (!msg.path || !edit.editor) return;
    edit.editor.insertText(`![](${msg.path})`);
  }

  // ---------- 文件内搜索 ----------
  const search = { seq: 0, timer: 0, query: '' };
  const searchInput = $('search-input');
  const searchResults = $('search-results');
  let pendingReveal = null;

  function openSearch() {
    if (!state.sidebar) {
      state.sidebar = true;
      applySidebar();
      saveSettings();
    }
    if (state.layout.filesCollapsed) {
      state.layout.filesCollapsed = false;
      applyLayout();
      saveLayout();
    }
    document.body.classList.add('searching');
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    clearTimeout(search.timer);
    search.seq++;
    search.query = '';
    searchInput.value = '';
    searchResults.innerHTML = '';
    document.body.classList.remove('searching', 'search-active');
    applySearchHighlight();
  }

  function runSearch() {
    clearTimeout(search.timer);
    const query = searchInput.value.trim();
    document.body.classList.toggle('search-active', query.length > 0);
    if (!query) {
      search.query = '';
      searchResults.innerHTML = '';
      applySearchHighlight();
      return;
    }
    search.timer = setTimeout(() => {
      search.seq++;
      searchResults.innerHTML = `<div class="search-status">${escapeHtml(t('ui.search.searching'))}</div>`;
      post({ type: 'search', query, seq: search.seq });
    }, 250);
  }

  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function markQuery(text, query) {
    const re = new RegExp(escapeRegExp(query), 'gi');
    let out = '';
    let last = 0;
    for (const m of text.matchAll(re)) {
      out += escapeHtml(text.slice(last, m.index)) + `<mark>${escapeHtml(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  }

  function showSearchResults(msg) {
    if (msg.seq !== search.seq) return;
    search.query = msg.query;
    applySearchHighlight();
    searchResults.innerHTML = '';
    if (msg.results.length === 0) {
      searchResults.innerHTML = `<div class="search-status">${escapeHtml(t('ui.search.none'))}</div>`;
      return;
    }

    const groups = new Map();
    msg.results.forEach(r => {
      if (!groups.has(r.path)) groups.set(r.path, []);
      groups.get(r.path).push(r);
    });
    groups.forEach((hits, path) => {
      const head = document.createElement('div');
      head.className = 'search-file';
      head.title = path;
      head.innerHTML = `${ICON_FILE}<span class="name"></span><span class="count">${hits.length}</span>`;
      head.querySelector('.name').textContent = hits[0].name;
      searchResults.appendChild(head);
      hits.forEach(hit => {
        const row = document.createElement('a');
        row.className = 'search-hit';
        row.innerHTML = markQuery(hit.text, msg.query);
        row.title = `${hit.name}:${hit.line + 1}`;
        row.addEventListener('click', () => openSearchHit(hit));
        searchResults.appendChild(row);
      });
    });
    if (msg.truncated) {
      const more = document.createElement('div');
      more.className = 'search-status';
      more.textContent = t('ui.search.truncated', msg.results.length);
      searchResults.appendChild(more);
    }
  }

  function openSearchHit(hit) {
    if (samePath(hit.path, state.currentPath)) {
      revealLine(hit.line);
    } else {
      pendingReveal = { path: hit.path, line: hit.line };
      post({ type: 'openFile', path: hit.path });
    }
  }

  /** 定位到源码第 line 行（从 0 开始）对应的位置并闪一下 */
  function revealLine(line) {
    if (edit.mode !== 'read' && edit.editor) edit.editor.gotoLine(line + 1);
    if (edit.mode === 'edit') return;
    let target = null;
    content.querySelectorAll('[data-line]').forEach(el => {
      if (Number(el.dataset.line) <= line && el.getClientRects().length > 0) target = el;
    });
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.classList.remove('search-flash');
    void target.offsetWidth;
    target.classList.add('search-flash');
  }

  /** 用 CSS Highlight API 标出正文里的搜索词，不改动 DOM */
  function applySearchHighlight() {
    if (!window.CSS || !CSS.highlights) return;
    CSS.highlights.delete('search-hit');
    const query = search.query;
    if (!query || !document.body.classList.contains('search-active')) return;
    const re = new RegExp(escapeRegExp(query), 'gi');
    const ranges = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && ranges.length < 2000; node = walker.nextNode()) {
      if (node.parentElement.closest('.copy-btn, .katex-mathml')) continue;
      for (const m of node.data.matchAll(re)) {
        const range = new Range();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        ranges.push(range);
      }
    }
    if (ranges.length) CSS.highlights.set('search-hit', new Highlight(...ranges));
  }

  $('btn-search').addEventListener('click', event => {
    event.stopPropagation();
    if (document.body.classList.contains('searching')) closeSearch();
    else openSearch();
  });
  $('search-close').addEventListener('click', closeSearch);
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = searchResults.querySelector('.search-hit');
      if (first) first.click();
    }
  });

  // ---------- 导出 HTML ----------
  function exportHtml() {
    if (document.body.classList.contains('empty') || document.body.classList.contains('load-failed')) return;
    const clone = content.cloneNode(true);
    clone.querySelectorAll('.copy-btn, .mermaid-error').forEach(n => n.remove());
    const sourceImages = content.querySelectorAll('img');
    clone.querySelectorAll('img').forEach((img, i) => {
      if (sourceImages[i]) img.setAttribute('src', sourceImages[i].src);
    });
    clone.querySelectorAll('[data-line]').forEach(el => el.removeAttribute('data-line'));
    clone.querySelectorAll('[data-rendered], [data-source]').forEach(el => {
      el.removeAttribute('data-rendered');
      el.removeAttribute('data-source');
    });
    post({ type: 'exportHtml', html: clone.innerHTML, title: headings[0] ? headings[0].textContent.trim() : ($('file-name').textContent || 'SmartMdReader') });
  }

  $('btn-export').addEventListener('click', exportHtml);

  // ---------- 工具栏与快捷键 ----------
  $('btn-toc').addEventListener('click', toggleSidebar);
  $('btn-back').addEventListener('click', () => post({ type: 'back' }));
  $('btn-open').addEventListener('click', () => post({ type: 'open' }));
  $('btn-reload').addEventListener('click', () => post({ type: 'reload' }));
  $('btn-theme').addEventListener('click', cycleTheme);
  $('btn-settings').addEventListener('click', openSettings);
  $('file-path').addEventListener('click', () => post({ type: 'reveal' }));

  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const inEditor = !!(event.target.closest && event.target.closest('#editor-host'));
    if (event.ctrlKey && event.key === '\\') {
      event.preventDefault();
      toggleSidebar();
    } else if (event.ctrlKey && event.key === ',') {
      event.preventDefault();
      openSettings();
    } else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'f') {
      event.preventDefault();
      openSearch();
    } else if (event.ctrlKey && !event.shiftKey && !event.altKey && key === 's') {
      event.preventDefault();
      saveDoc();
    } else if (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'e') {
      event.preventDefault();
      cycleMode();
    } else if (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'd' && !inEditor) {
      event.preventDefault();
      togglePen();
    } else if (event.ctrlKey && !event.shiftKey && key === 'z' && pen.active && !inEditor) {
      event.preventDefault();
      undoPen();
    } else if (event.key === 'Escape') {
      if (ctxMenu.classList.contains('open')) {
        event.preventDefault();
        hideMenu();
      } else if (document.body.classList.contains('settings-open')) {
        event.preventDefault();
        closeSettings();
      } else if (pen.active) {
        event.preventDefault();
        closePen();
      }
    }
  });

  // ---------- 与宿主通信 ----------
  if (webview) {
    webview.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'init':
          state.theme = THEMES.includes(msg.theme) ? msg.theme : 'auto';
          state.sidebar = msg.toc !== false;
          state.language = msg.language || 'en';
          strings = msg.strings || {};
          if (msg.layout) Object.assign(state.layout, msg.layout);
          if (msg.contentWidth) reading.contentWidth = msg.contentWidth;
          if (msg.fontSize) reading.fontSize = msg.fontSize;
          applyReading();
          fillLanguages(msg.languages || []);
          applyStrings();
          applySidebar();
          applyLayout();
          applyTheme();
          renderLibrary();
          break;
        case 'library':
          library = msg.items || [];
          renderLibrary();
          break;
        case 'render': render(msg); break;
        case 'previewHtml': if (edit.canEdit) applyPreview(msg.html); break;
        case 'saved': onSaved(msg.text); break;
        case 'imageSaved': onImageSaved(msg); break;
        case 'searchResults': showSearchResults(msg); break;
        case 'discard':
          if (edit.editor) edit.saved = edit.editor.getText();
          setDirty(false);
          break;
        case 'externalChange':
          document.body.classList.add('external-change');
          if (edit.mode === 'read') setMode('split');
          break;
        case 'empty': showEmpty(); break;
        case 'error': showError(msg); break;
        case 'scroll': scrollToId(msg.fragment); break;
        case 'toast': toast(msg.message); break;
      }
    });
  }

  if (window.hljs) hljs.configure({ ignoreUnescapedHTML: true });
  darkQuery.addEventListener('change', applyTheme);
  applyTheme();
  post({ type: 'ready' });
})();
