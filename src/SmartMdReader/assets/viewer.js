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
    layout: { sidebarWidth: 280, filesRatio: 0.45, filesCollapsed: false, tocCollapsed: false },
  };
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
    $('btn-theme').textContent = t(`ui.theme.${state.theme}`);
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
    post({ type: 'settings', theme: state.theme, toc: state.sidebar, ...extra });
  }

  // ---------- 侧栏布局 ----------
  function applyLayout() {
    const { sidebarWidth, filesRatio, filesCollapsed, tocCollapsed } = state.layout;
    document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
    document.documentElement.style.setProperty('--files-h', `${filesRatio * 100}%`);
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
    const previousScroll = msg.keepScroll ? scroller.scrollTop : 0;

    $('doc-base').href = msg.baseHref;
    content.innerHTML = msg.html;
    document.body.classList.remove('empty');
    setFileInfo(msg.name, msg.path);
    $('btn-back').disabled = !msg.canGoBack;

    enhanceCodeBlocks();
    buildToc();

    // 窗口激活时 WebView2 会把焦点交给文档里的可聚焦元素并滚动过去，先把焦点固定在滚动区域
    scroller.focus({ preventScroll: true });

    if (msg.fragment) {
      scrollToId(msg.fragment);
    } else {
      scroller.scrollTop = previousScroll;
      restoreScrollAfterImages(previousScroll);
    }
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
  }

  function showError(msg) {
    document.body.classList.remove('empty');
    document.body.classList.add('toc-none');
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
      row.classList.toggle('active', samePath(row.dataset.key, state.currentPath));
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

  // ---------- 工具栏与快捷键 ----------
  $('btn-toc').addEventListener('click', toggleSidebar);
  $('btn-back').addEventListener('click', () => post({ type: 'back' }));
  $('btn-open').addEventListener('click', () => post({ type: 'open' }));
  $('btn-reload').addEventListener('click', () => post({ type: 'reload' }));
  $('btn-theme').addEventListener('click', cycleTheme);
  $('btn-settings').addEventListener('click', openSettings);
  $('file-path').addEventListener('click', () => post({ type: 'reveal' }));

  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key === '\\') {
      event.preventDefault();
      toggleSidebar();
    } else if (event.ctrlKey && event.key === ',') {
      event.preventDefault();
      openSettings();
    } else if (event.key === 'Escape') {
      if (ctxMenu.classList.contains('open')) {
        event.preventDefault();
        hideMenu();
      } else if (document.body.classList.contains('settings-open')) {
        event.preventDefault();
        closeSettings();
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
