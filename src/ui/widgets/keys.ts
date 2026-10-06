const NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** KeyboardEvent.code → short label. */
export function keyLabel(code: string): string {
  return NAMES[code] ?? code.replace(/^Key|^Digit/, '');
}
