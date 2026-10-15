// CodeMirror 6 打包入口，构建为 src/SmartMdReader/assets/vendor/editor.js，暴露 window.SmartEditor
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, highlightSpecialChars, rectangularSelection, crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap,
} from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '.cm-scroller': {
    fontFamily: '"Cascadia Mono", Consolas, "BIZ UDGothic", "MS Gothic", "Microsoft YaHei UI", monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '12px 0 40vh' },
  '&.cm-focused': { outline: 'none' },
});

const lightTheme = [syntaxHighlighting(defaultHighlightStyle, { fallback: true })];

// ---------- 格式化命令 ----------

/** 用 before/after 包住选区；已经包住时去掉。没有选区时插入占位文字并选中。 */
function wrap(view, before, after = before, placeholder = '') {
  const { state } = view;
  const tr = state.changeByRange(range => {
    const outerFrom = range.from - before.length;
    const outerTo = range.to + after.length;
    if (outerFrom >= 0 && outerTo <= state.doc.length
      && state.sliceDoc(outerFrom, range.from) === before && state.sliceDoc(range.to, outerTo) === after) {
      return {
        changes: [{ from: outerFrom, to: range.from }, { from: range.to, to: outerTo }],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      };
    }
    const text = range.empty ? placeholder : state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: before + text + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

function selectedLines(state) {
  const lines = new Map();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.set(n, state.doc.line(n));
  }
  return [...lines.values()];
}

const LIST_PREFIX = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;

/** 行首前缀：kind = ul / ol / task / quote，全部已有时去掉 */
function toggleLines(view, kind) {
  const lines = selectedLines(view.state);
  const test = {
    ul: /^\s*[-*+] (?!\[[ xX]\] )/,
    ol: /^\s*\d+[.)] /,
    task: /^\s*[-*+] \[[ xX]\] /,
    quote: /^\s*> /,
  }[kind];
  const remove = lines.every(l => test.test(l.text));
  const changes = lines.map((line, i) => {
    const match = line.text.match(LIST_PREFIX);
    const indent = match ? match[1] : (line.text.match(/^\s*/) || [''])[0];
    const oldEnd = line.from + (match ? match[0].length : indent.length);
    const prefix = remove ? '' : { ul: '- ', ol: `${i + 1}. `, task: '- [ ] ', quote: '> ' }[kind];
    return { from: line.from + indent.length, to: oldEnd, insert: prefix };
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** 标题级别循环：无 → # → ## → ### → 无 */
function cycleHeading(view) {
  const changes = selectedLines(view.state).map(line => {
    const match = line.text.match(/^(#{1,6}) /);
    const level = match ? match[1].length : 0;
    const next = level >= 3 ? '' : '#'.repeat(level + 1) + ' ';
    return { from: line.from, to: line.from + (match ? match[0].length : 0), insert: next };
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** 在光标处插入独立的一块（前后补空行） */
function insertBlock(view, text, selectFrom = -1, selectTo = -1) {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  let at = range.from;
  let prefix = '';
  if (line.text.trim().length > 0) {
    at = state.doc.lineAt(range.to).to;
    prefix = '\n\n';
  } else if (line.number > 1 && state.doc.line(line.number - 1).text.trim().length > 0) {
    prefix = '\n';
  }
  const insert = prefix + text + '\n';
  const base = at + prefix.length;
  const selection = selectFrom >= 0
    ? EditorSelection.range(base + selectFrom, base + (selectTo >= 0 ? selectTo : selectFrom))
    : EditorSelection.cursor(base + text.length);
  view.dispatch({ changes: { from: at, to: range.to > at ? range.to : at, insert }, selection, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

function insertLink(view, image, label) {
  const { state } = view;
  const range = state.selection.main;
  const text = range.empty ? label : state.sliceDoc(range.from, range.to);
  const head = `${image ? '!' : ''}[${text}](`;
  const insert = `${head}url)`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(range.from + head.length, range.from + head.length + 3),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

function create(parent, options) {
  const {
    doc = '', dark = false, onChange = () => {}, onScroll = () => {}, onPasteImage = null, labels = {},
  } = options || {};
  const themeSlot = new Compartment();
  let isDark = dark;

  const formatKeymap = keymap.of([
    { key: 'Mod-b', run: v => wrap(v, '**', '**') },
    { key: 'Mod-i', run: v => wrap(v, '*', '*') },
    { key: 'Mod-k', run: v => insertLink(v, false, labels.linkText || 'text') },
  ]);

  const pasteHandler = EditorView.domEventHandlers({
    paste(event) {
      if (!onPasteImage) return false;
      const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      if (files.length === 0) return false;
      event.preventDefault();
      files.forEach(file => onPasteImage(file));
      return true;
    },
  });

  const extensions = () => [
    formatKeymap,
    pasteHandler,
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    baseTheme,
    themeSlot.of(isDark ? oneDark : lightTheme),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChange();
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: extensions() }),
  });
  view.scrollDOM.addEventListener('scroll', () => onScroll());

  return {
    getText: () => view.state.doc.toString(),

    /** 打开另一个文件：重置内容、撤销历史和滚动位置 */
    setDoc(text) {
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
      view.scrollDOM.scrollTop = 0;
    },

    /** 同一文件被外部修改后重新载入：保留光标和滚动位置 */
    replaceDoc(text) {
      const scrollTop = view.scrollDOM.scrollTop;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
      });
      view.scrollDOM.scrollTop = scrollTop;
    },

    setDark(value) {
      if (value === isDark) return;
      isDark = value;
      view.dispatch({ effects: themeSlot.reconfigure(isDark ? oneDark : lightTheme) });
    },

    focus: () => view.focus(),
    refresh: () => view.requestMeasure(),

    /** 视口顶部所在的行号（从 1 开始，带小数，用于预览同步滚动） */
    topLine() {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
      const line = view.state.doc.lineAt(block.from).number;
      const fraction = block.height > 0 ? (view.scrollDOM.scrollTop - block.top) / block.height : 0;
      return line + Math.min(Math.max(fraction, 0), 1);
    },

    /** 滚动到指定行（从 1 开始，带小数），不移动光标 */
    scrollToLine(line) {
      const doc = view.state.doc;
      const number = Math.min(Math.max(Math.floor(line), 1), doc.lines);
      const block = view.lineBlockAt(doc.line(number).from);
      const fraction = Math.min(Math.max(line - number, 0), 1);
      view.scrollDOM.scrollTop = block.top + block.height * fraction;
    },

    /** 工具栏格式化命令 */
    format(command) {
      switch (command) {
        case 'bold': return wrap(view, '**', '**');
        case 'italic': return wrap(view, '*', '*');
        case 'strike': return wrap(view, '~~', '~~');
        case 'code': return wrap(view, '`', '`');
        case 'heading': return cycleHeading(view);
        case 'ul': case 'ol': case 'task': case 'quote': return toggleLines(view, command);
        case 'link': return insertLink(view, false, labels.linkText || 'text');
        case 'image': return insertLink(view, true, labels.imageAlt || 'image');
        case 'codeblock': return insertBlock(view, '```\n\n```', 4);
        case 'hr': return insertBlock(view, '---');
        case 'table': {
          const h = labels.headerCell || 'Header';
          const c = labels.cell || 'Cell';
          const table = `| ${h} | ${h} |\n| --- | --- |\n| ${c} | ${c} |`;
          return insertBlock(view, table, 2, 2 + h.length);
        }
        default: return false;
      }
    },

    /** 在光标处插入文字（粘贴图片后插入 Markdown 图片语法） */
    insertText(text) {
      const range = view.state.selection.main;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: EditorSelection.cursor(range.from + text.length),
        scrollIntoView: true,
        userEvent: 'input',
      });
      view.focus();
    },

    gotoLine(lineNumber) {
      const line = view.state.doc.line(Math.min(Math.max(lineNumber, 1), view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 8 }),
      });
      view.focus();
    },
  };
}

window.SmartEditor = { create };
