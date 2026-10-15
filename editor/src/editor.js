// CodeMirror 6 打包入口，构建为 src/SmartMdReader/assets/vendor/editor.js，暴露 window.SmartEditor
import { EditorState, Compartment } from '@codemirror/state';
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

function create(parent, options) {
  const { doc = '', dark = false, onChange = () => {}, onScroll = () => {} } = options || {};
  const themeSlot = new Compartment();
  let isDark = dark;

  const extensions = () => [
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
