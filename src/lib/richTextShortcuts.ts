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
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing) return;
      // The typed letter (right on Dvorak or AZERTY); on a non-Latin layout,
      // e.g. Cyrillic, the key's place on a US keyboard, as browsers do.
      const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase();
      const command = COMMANDS[letter];
      if (!command || !(e.target instanceof HTMLElement) || !e.target.isContentEditable) return;
      e.preventDefault();
      document.execCommand(command, false);
    },
    true
  );
}
