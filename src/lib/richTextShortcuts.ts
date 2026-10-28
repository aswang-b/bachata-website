// Ctrl/⌘+B, I and U in the site's rich-text boxes (any contenteditable).
// Left to the browser, a key it also uses for its own shortcut (e.g. Ctrl+B
// for bookmarks) can do that instead of formatting, so the editors take
// these keys first (capture phase) and format themselves.
const COMMANDS: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };

let installed = false;

export function installRichTextShortcuts(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const command = COMMANDS[e.key.toLowerCase()];
      if (!command || !(e.target instanceof HTMLElement) || !e.target.isContentEditable) return;
      e.preventDefault();
      document.execCommand(command, false);
    },
    true
  );
}
