import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASE_AFTER_MS, trackSubmit } from '../../src/scripts/submitState';

// The helper needs only a form, its button and window, so small stand-ins do
// (the unit setup has no DOM).
function setup() {
  const attrs = new Map<string, string>();
  const button = {
    disabled: false,
    textContent: 'Submit',
    style: { minWidth: '' },
    getBoundingClientRect: () => ({ width: 120 }),
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
  let onSubmit!: (e: { defaultPrevented: boolean; preventDefault(): void }) => void;
  const form = { querySelector: () => button, addEventListener: (_: string, fn: typeof onSubmit) => (onSubmit = fn) };
  const win = { listeners: {} as Record<string, () => void>, addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; } };
  vi.stubGlobal('window', win);
  trackSubmit(form as never, 'Sending…');
  const submit = (defaultPrevented = false) => {
    const e = { defaultPrevented, preventDefault: vi.fn() };
    onSubmit(e);
    return e;
  };
  return { button, attrs, submit, win };
}

describe('trackSubmit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('locks on a real submit, refuses a second one, and ignores a submit another check stopped', () => {
    const { button, attrs, submit } = setup();
    submit(true);
    expect(button.disabled).toBe(false);
    submit();
    expect(button).toMatchObject({ disabled: true, textContent: 'Sending…', style: { minWidth: '120px' } });
    expect(attrs.get('aria-busy')).toBe('true');
    expect(submit().preventDefault).toHaveBeenCalled();
  });

  it('lets go by itself when the page is still showing after the wait (Stop pressed, network dropped)', () => {
    const { button, attrs, submit } = setup();
    submit();
    vi.advanceTimersByTime(RELEASE_AFTER_MS - 1);
    expect(button.disabled).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button).toMatchObject({ disabled: false, textContent: 'Submit', style: { minWidth: '' } });
    expect(attrs.has('aria-busy')).toBe(false);
    expect(submit().preventDefault).not.toHaveBeenCalled(); // a late second tap goes through
    expect(button.disabled).toBe(true);
  });

  it('pageshow restores at once and cancels the timer', () => {
    const { button, submit, win } = setup();
    submit();
    win.listeners.pageshow();
    expect(button).toMatchObject({ disabled: false, textContent: 'Submit' });
    submit();
    vi.advanceTimersByTime(RELEASE_AFTER_MS - 1);
    expect(button.disabled).toBe(true); // the new lock keeps its own full wait
  });
});
