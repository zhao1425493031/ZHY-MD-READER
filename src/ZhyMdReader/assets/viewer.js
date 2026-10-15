(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const webview = window.chrome && window.chrome.webview;
  const post = msg => webview && webview.postMessage(msg);

  const scroller = $('scroller');
  const content = $('content');
  const tocList = $('toc-list');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  const THEMES = ['auto', 'light', 'dark'];
  const HTML_LANG = { en: 'en', zh: 'zh-CN', ja: 'ja' };

  const state = { theme: 'auto', toc: true, language: 'en' };
  let strings = {};
  let headings = [];
  let tocLinks = [];

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

  function applyToc() {
    document.body.classList.toggle('toc-hidden', !state.toc);
    $('set-toc').checked = state.toc;
  }

  function toggleToc() {
    state.toc = !state.toc;
    applyToc();
    saveSettings();
  }

  function saveSettings(extra) {
    post({ type: 'settings', theme: state.theme, toc: state.toc, ...extra });
  }

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
    state.toc = event.target.checked;
    applyToc();
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
    document.body.classList.add('empty');
    setFileInfo('', '');
  }

  function showError(msg) {
    document.body.classList.remove('empty');
    document.body.classList.add('no-toc');
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
    document.title = name ? `${name} - ZHY MD Reader` : 'ZHY MD Reader';
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
    document.body.classList.toggle('no-toc', headings.length === 0);
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

  // ---------- 拖拽 ----------
  let dragDepth = 0;
  document.addEventListener('dragenter', event => {
    event.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('dragging');
    }
  });
  document.addEventListener('dragover', event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const files = event.dataTransfer.files;
    if (files.length > 0 && webview && webview.postMessageWithAdditionalObjects) {
      webview.postMessageWithAdditionalObjects('drop', files);
    }
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
  $('btn-toc').addEventListener('click', toggleToc);
  $('btn-back').addEventListener('click', () => post({ type: 'back' }));
  $('btn-open').addEventListener('click', () => post({ type: 'open' }));
  $('btn-reload').addEventListener('click', () => post({ type: 'reload' }));
  $('btn-theme').addEventListener('click', cycleTheme);
  $('btn-settings').addEventListener('click', openSettings);
  $('file-path').addEventListener('click', () => post({ type: 'reveal' }));

  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key === '\\') {
      event.preventDefault();
      toggleToc();
    } else if (event.ctrlKey && event.key === ',') {
      event.preventDefault();
      openSettings();
    } else if (event.key === 'Escape' && document.body.classList.contains('settings-open')) {
      event.preventDefault();
      closeSettings();
    }
  });

  // ---------- 与宿主通信 ----------
  if (webview) {
    webview.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'init':
          state.theme = THEMES.includes(msg.theme) ? msg.theme : 'auto';
          state.toc = msg.toc !== false;
          state.language = msg.language || 'en';
          strings = msg.strings || {};
          fillLanguages(msg.languages || []);
          applyStrings();
          applyToc();
          applyTheme();
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
