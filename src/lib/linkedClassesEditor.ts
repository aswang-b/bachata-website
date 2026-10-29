// The calendar editor's "Linked Classes/Events" section and its link picker
// (markup in calendar.astro). Links and rules save right away through
// /api/admin/event-links, not with the editor's Save button. See linkRules.ts
// for what the rules mean.

import { combinations, defaultReason, findConflicts, REASON_MAX_LENGTH, ruleFor, type LinkRule } from './linkRules';
import { escapeAttr } from './locationLink';
import { siteFormatter, zonedDateKey } from './siteTime';

export interface LinkableEvent {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  end_time: string;
  google_recurring_event_id: string | null;
  flyer_url: string | null;
}

interface SeriesLink {
  seriesKey: string;
  groupId: string;
}

export interface LinkedEditorHooks<E extends LinkableEvent> {
  events(): E[];
  // The occurrence being edited (null while adding), what a new one will be
  // linked to once saved, and the type picked in the editor.
  current(): { event: E | null; pendingLinkTo: string | null; eventType: 'class' | 'event' };
  authHeaders(): Promise<Record<string, string> | null>;
  // Show this occurrence of a linked series (its tab in the editor).
  openEvent(event: E): void;
  // Start a new class copied from this one (blank title and description), linked to it on save.
  newLinked(source: E): void;
  // Linking shared a flyer onto these series.
  flyerShared(flyerUrl: string, seriesKeys: string[]): void;
  // A link was added or removed (the editor's tabs follow).
  linksChanged(): void;
}

export const seriesKeyOf = (e: { id: string; google_recurring_event_id: string | null }) => e.google_recurring_event_id ?? e.id;

const timeFormatter = siteFormatter({ hour: 'numeric', minute: '2-digit' });
const dateFormatter = siteFormatter({ month: 'short', day: 'numeric' });
const weekdayFormatter = siteFormatter({ weekday: 'long' });
const esc = escapeAttr;

const RULE_CHOICES = ['both', 'exclusive', 'a-includes-b', 'b-includes-a'] as const;
type RuleChoiceValue = (typeof RULE_CHOICES)[number];

export function initLinkedEditor<E extends LinkableEvent>(hooks: LinkedEditorHooks<E>) {
  let links: SeriesLink[] = [];
  let rules: LinkRule[] = [];
  let loadError: string | null = null;

  const intro = document.getElementById('linked-intro')!;
  const list = document.getElementById('linked-list')!;
  const rulesBox = document.getElementById('linked-rules')!;
  const summaryBox = document.getElementById('linked-summary')!;
  const errorBox = document.getElementById('linked-error')!;
  const addBtn = document.getElementById('linked-add-btn') as HTMLButtonElement;
  const chooseOneBtn = document.getElementById('linked-choose-one-btn') as HTMLButtonElement;

  const picker = document.getElementById('link-picker')!;
  const pickerTitle = document.getElementById('link-picker-title')!;
  const pickerBrowse = document.getElementById('link-picker-browse')!;
  const pickerList = document.getElementById('link-picker-list')!;
  const pickerSearch = document.getElementById('link-picker-search') as HTMLInputElement;
  const pickerTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.link-picker-tab'));
  const pickerConfirm = document.getElementById('link-picker-confirm')!;
  const pickerConfirmText = document.getElementById('link-picker-confirm-text')!;
  const pickerConfirmBtn = document.getElementById('link-picker-confirm-btn') as HTMLButtonElement;
  let pickerTab: 'upcoming' | 'past' = 'upcoming';
  let pendingTarget: string | null = null;

  // ---- Series lookups ----
  function occurrencesOf(key: string): E[] {
    return hooks
      .events()
      .filter((e) => seriesKeyOf(e) === key)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  const titleOf = (key: string) => occurrencesOf(key)[0]?.title ?? 'A deleted class';

  // The class of a linked series to open next to `near`: the one on the same
  // day, else its next one, else its last.
  function occurrenceFor(key: string, near: E | null): E | undefined {
    const occ = occurrencesOf(key);
    const sameDay = near ? occ.find((o) => zonedDateKey(o.start_time) === zonedDateKey(near.start_time)) : undefined;
    return sameDay ?? occ.find((o) => Date.parse(o.end_time) >= Date.now()) ?? occ[occ.length - 1];
  }

  function seriesLabel(key: string): string {
    const occ = occurrencesOf(key);
    if (occ.length === 0) return '';
    const first = new Date(occ[0].start_time);
    const time = timeFormatter.format(first);
    if (occ.length === 1) return `${dateFormatter.format(first)}, ${time}`;
    const last = new Date(occ[occ.length - 1].start_time);
    return `${weekdayFormatter.format(first)}s, ${time} · ${occ.length} classes · ${dateFormatter.format(first)}–${dateFormatter.format(last)}`;
  }

  function groupKeys(key: string): string[] {
    const own = links.find((l) => l.seriesKey === key);
    if (!own) return [key];
    // Linked series with no occurrences left (deleted on Google) are skipped.
    return links.filter((l) => l.groupId === own.groupId && occurrencesOf(l.seriesKey).length > 0).map((l) => l.seriesKey);
  }

  const typeWord = () => (hooks.current().eventType === 'event' ? 'event' : 'class');

  // ---- Saving ----
  function showError(message: string | null) {
    errorBox.textContent = message ?? '';
    errorBox.classList.toggle('hidden', !message);
  }

  async function post(body: Record<string, unknown>): Promise<{ flyerUrl?: string | null } | null> {
    const headers = await hooks.authHeaders();
    if (!headers) return null;
    showError(null);
    try {
      const res = await fetch('/api/admin/event-links', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `The server returned ${res.status}.`);
      links = data.links ?? links;
      rules = data.rules ?? rules;
      hooks.linksChanged();
      return data;
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save.');
      return null;
    } finally {
      render();
    }
  }

  // ---- The section ----
  function render() {
    const { event, pendingLinkTo } = hooks.current();
    const word = typeWord();
    list.replaceChildren();
    rulesBox.replaceChildren();
    summaryBox.classList.add('hidden');
    summaryBox.classList.remove('flex');
    chooseOneBtn.classList.add('hidden');

    if (loadError) {
      intro.textContent = loadError;
      addBtn.classList.add('hidden');
      return;
    }
    if (!event) {
      addBtn.classList.add('hidden');
      intro.textContent = pendingLinkTo
        ? `This new ${word} will be linked with ${titleOf(pendingLinkTo)} (and share its flyer) when you save it.`
        : `Save this ${word} first, then link it to other classes or events sold off the same flyer.`;
      return;
    }

    addBtn.classList.remove('hidden');
    addBtn.textContent = `+ Link ${word}`;
    const key = seriesKeyOf(event);
    const keys = groupKeys(key);
    if (keys.length < 2) {
      intro.textContent = `Link classes or events sold off the same flyer: they share it, and you choose how they combine on the registration form. A series links as a whole. Changes here save right away.`;
      return;
    }
    intro.textContent = `Linked as whole series, sharing one flyer. Changes here save right away.`;

    for (const other of keys.filter((k) => k !== key)) {
      const li = document.createElement('li');
      li.className = 'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2';
      li.innerHTML = `
        <span class="min-w-0"><span class="block truncate text-sm font-semibold text-ink">${esc(titleOf(other))}</span><span class="block truncate text-xs text-muted">${esc(seriesLabel(other))}</span></span>
        <span class="flex gap-3">
          <button type="button" class="linked-open-btn text-xs font-semibold text-accent hover:underline" data-key="${esc(other)}">Open</button>
          <button type="button" class="linked-unlink-btn text-xs font-semibold text-red-600 hover:underline" data-key="${esc(other)}">Unlink</button>
        </span>`;
      list.append(li);
    }

    // One rule per linked pair, every pair in the set.
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) rulesBox.append(ruleRow(keys[i], keys[j]));
    }
    chooseOneBtn.classList.toggle('hidden', keys.length < 3);
    renderSummary(keys);
  }

  function ruleRow(a: string, b: string): HTMLElement {
    const rule = ruleFor(rules, a, b);
    const value: RuleChoiceValue = !rule ? 'both' : rule.kind === 'exclusive' ? 'exclusive' : rule.from === a ? 'a-includes-b' : 'b-includes-a';
    const [ta, tb] = [titleOf(a), titleOf(b)];
    const labels: Record<RuleChoiceValue, string> = {
      both: 'Can take both',
      exclusive: 'Cannot take both',
      'a-includes-b': `${ta} includes ${tb}`,
      'b-includes-a': `${tb} includes ${ta}`,
    };
    const row = document.createElement('div');
    row.className = 'linked-rule flex flex-col gap-1.5 rounded-xl bg-surface px-3 py-2';
    row.dataset.a = a;
    row.dataset.b = b;
    const placeholder = rule ? defaultReason(rule, titleOf) : '';
    row.innerHTML = `
      <label class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <span class="text-sm text-ink">${esc(ta)} <span class="text-muted">and</span> ${esc(tb)}</span>
        <select class="linked-rule-select rounded-lg border border-border bg-bg px-2 py-1.5 text-sm text-ink" aria-label="Rule for ${esc(ta)} and ${esc(tb)}">
          ${RULE_CHOICES.map((c) => `<option value="${c}"${c === value ? ' selected' : ''}>${esc(labels[c])}</option>`).join('')}
        </select>
      </label>
      ${
        rule
          ? `<label class="flex flex-col gap-1"><span class="text-xs text-muted">Note on the registration form (optional)</span>
              <input type="text" class="linked-rule-reason rounded-lg border border-border bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-muted/70" maxlength="${REASON_MAX_LENGTH}" value="${esc(rule.reason ?? '')}" placeholder="${esc(placeholder)}" /></label>`
          : ''
      }${
        rule?.kind === 'includes'
          ? `<label class="flex items-center gap-2 text-xs text-ink/80"><input type="checkbox" class="linked-rule-headcount h-4 w-4 rounded border-border"${rule.countHeadcount !== false ? ' checked' : ''} />
              Count ${esc(titleOf(rule.from))} sign-ups in ${esc(titleOf(rule.to))}'s headcount and spots</label>`
          : ''
      }`;
    return row;
  }

  function renderSummary(keys: string[]) {
    const combos = combinations(keys, rules);
    summaryBox.classList.remove('hidden');
    summaryBox.classList.add('flex');
    const names = (ks: string[]) => ks.map(titleOf).join(' + ');
    const pills = combos
      ? combos
          .map((c) => {
            const text = names(c.picked) + (c.included.length ? ` (includes ${names(c.included)})` : '');
            const tone = c.warned ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300';
            return `<li class="rounded-full px-2.5 py-1 text-xs font-semibold ${tone}">${esc(text)}${c.warned ? ' · warned' : ''}</li>`;
          })
          .join('')
      : '<li class="text-xs text-muted">Too many linked to list every combination.</li>';
    summaryBox.innerHTML = `<p class="text-xs font-semibold text-muted">What dancers can sign up for</p><ul class="flex flex-wrap gap-1.5">${pills}</ul>
      <p class="text-[11px] text-muted">Nothing is ever blocked: an included one is shown in the subtotal at $0 (never saved or charged on its own), and a warned combination shows a note before they submit.</p>`;
  }

  rulesBox.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.linked-rule');
    if (!row?.dataset.a || !row.dataset.b) return;
    const a = row.dataset.a;
    const b = row.dataset.b;
    const select = row.querySelector<HTMLSelectElement>('.linked-rule-select')!;
    const reason = row.querySelector<HTMLInputElement>('.linked-rule-reason')?.value ?? '';
    const value = select.value as RuleChoiceValue;
    const [keyA, keyB, choice] =
      value === 'b-includes-a' ? [b, a, 'includes'] : value === 'a-includes-b' ? [a, b, 'includes'] : [a, b, value];
    // Checked here too, so a contradiction is explained without a round trip.
    const next = rules.filter((r) => !((r.from === a && r.to === b) || (r.from === b && r.to === a)));
    if (choice !== 'both') next.push({ from: keyA, to: keyB, kind: choice === 'includes' ? 'includes' : 'exclusive', reason: null });
    const conflicts = findConflicts(groupKeys(a), next, titleOf);
    if (conflicts.length > 0) {
      render();
      showError(conflicts[0]);
      return;
    }
    // A changed rule starts over with the default note, counting headcount.
    const sameRule = !target.classList.contains('linked-rule-select');
    const countHeadcount = sameRule ? (row.querySelector<HTMLInputElement>('.linked-rule-headcount')?.checked ?? true) : true;
    post({ action: 'rule', keyA, keyB, choice, reason: sameRule ? reason : '', countHeadcount });
  });

  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
    if (!btn?.dataset.key) return;
    const key = btn.dataset.key;
    if (btn.classList.contains('linked-unlink-btn')) {
      if (!confirm(`Unlink ${titleOf(key)}? Its rules with the other linked classes are removed. It keeps the flyer.`)) return;
      await post({ action: 'unlink', seriesKey: key });
      return;
    }
    if (btn.classList.contains('linked-open-btn')) {
      const target = occurrenceFor(key, hooks.current().event);
      if (target) hooks.openEvent(target);
    }
  });

  chooseOneBtn.addEventListener('click', async () => {
    const event = hooks.current().event;
    if (!event) return;
    if (!confirm('Set every linked pair to "Cannot take both"? Dancers will see a note if they pick more than one.')) return;
    await post({ action: 'choose-one', seriesKey: seriesKeyOf(event) });
  });

  // ---- The picker ----
  function pickerOptions(): { key: string; title: string; label: string; upcoming: boolean; sortKey: string; linkedWith: number }[] {
    const { event, eventType } = hooks.current();
    if (!event) return [];
    const exclude = new Set(groupKeys(seriesKeyOf(event)));
    const bySeries = new Map<string, E[]>();
    for (const e of hooks.events()) {
      if ((e.event_type === 'event' ? 'event' : 'class') !== eventType) continue;
      const key = seriesKeyOf(e);
      if (exclude.has(key)) continue;
      bySeries.set(key, [...(bySeries.get(key) ?? []), e]);
    }
    const now = Date.now();
    return [...bySeries.entries()].map(([key, occ]) => {
      const next = occ.filter((o) => Date.parse(o.end_time) >= now).sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
      const last = occ.reduce((m, o) => (o.start_time > m ? o.start_time : m), occ[0].start_time);
      return {
        key,
        title: occ[0].title,
        label: seriesLabel(key),
        upcoming: Boolean(next),
        sortKey: next ? next.start_time : last,
        linkedWith: groupKeys(key).length - 1,
      };
    });
  }

  function renderPicker() {
    const query = pickerSearch.value.trim().toLowerCase();
    const word = typeWord();
    const options = pickerOptions()
      .filter((o) => o.upcoming === (pickerTab === 'upcoming') && (!query || o.title.toLowerCase().includes(query)))
      .sort((a, b) => (pickerTab === 'upcoming' ? a.sortKey.localeCompare(b.sortKey) : b.sortKey.localeCompare(a.sortKey)));
    const rowClass = 'link-picker-option flex w-full items-center justify-between gap-3 border-b border-border px-1 py-2.5 text-left hover:bg-surface';
    const newRow =
      pickerTab === 'upcoming'
        ? `<li><button type="button" class="${rowClass} font-semibold text-accent" data-new="1">+ New linked ${word} <span class="text-xs font-normal text-muted">(a copy with a blank title and description)</span></button></li>`
        : '';
    pickerList.innerHTML =
      newRow +
      (options.length
        ? options
            .map(
              (o) => `<li><button type="button" class="${rowClass}" data-key="${esc(o.key)}">
                <span class="min-w-0"><span class="block truncate text-sm font-semibold text-ink">${esc(o.title)}</span><span class="block truncate text-xs text-muted">${esc(o.label)}</span></span>
                ${o.linkedWith ? `<span class="shrink-0 text-xs text-muted">Linked with ${o.linkedWith}</span>` : ''}
              </button></li>`
            )
            .join('')
        : `<li class="py-4 text-center text-sm text-muted">${query ? 'Nothing matches that search.' : pickerTab === 'upcoming' ? `No other upcoming ${word === 'event' ? 'events' : 'classes'}.` : `No past ${word === 'event' ? 'events' : 'classes'}.`}</li>`);
  }

  function setPickerTab(tab: 'upcoming' | 'past') {
    pickerTab = tab;
    for (const t of pickerTabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    // Past classes are only listed once this tab is opened.
    renderPicker();
  }

  function showPickerStep(step: 'browse' | 'confirm') {
    pickerBrowse.classList.toggle('hidden', step !== 'browse');
    pickerBrowse.classList.toggle('flex', step === 'browse');
    pickerConfirm.classList.toggle('hidden', step !== 'confirm');
    pickerConfirm.classList.toggle('flex', step === 'confirm');
  }

  function openPicker() {
    pickerTitle.textContent = `Link ${typeWord() === 'event' ? 'an event' : 'a class'}`;
    pickerSearch.value = '';
    pendingTarget = null;
    showPickerStep('browse');
    picker.classList.remove('hidden');
    picker.classList.add('flex');
    setPickerTab('upcoming');
    pickerSearch.focus();
  }

  function closePicker() {
    picker.classList.add('hidden');
    picker.classList.remove('flex');
    addBtn.focus();
  }

  pickerTabs.forEach((t) => t.addEventListener('click', () => setPickerTab(t.dataset.tab === 'past' ? 'past' : 'upcoming')));
  pickerSearch.addEventListener('input', renderPicker);
  addBtn.addEventListener('click', openPicker);
  document.getElementById('link-picker-close')!.addEventListener('click', closePicker);
  document.getElementById('link-picker-back')!.addEventListener('click', () => showPickerStep('browse'));
  picker.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePicker();
    }
  });

  pickerList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.link-picker-option');
    const event = hooks.current().event;
    if (!btn || !event) return;
    if (btn.dataset.new) {
      closePicker();
      hooks.newLinked(event);
      return;
    }
    const target = btn.dataset.key!;
    pendingTarget = target;
    const others = groupKeys(target).filter((k) => k !== target);
    const flyerNote = event.flyer_url
      ? `It will use this ${typeWord()}'s flyer.`
      : occurrencesOf(target)[0]?.flyer_url
        ? `This ${typeWord()} has no flyer yet, so both will use ${titleOf(target)}'s.`
        : '';
    pickerConfirmText.textContent = others.length
      ? `${titleOf(target)} is already linked with ${others.map(titleOf).join(', ')}. All of them will be linked with ${event.title} and share one flyer. ${flyerNote}`
      : `Link ${titleOf(target)} with ${event.title}? Every class in both series is linked. ${flyerNote}`;
    showPickerStep('confirm');
    pickerConfirmBtn.focus();
  });

  pickerConfirmBtn.addEventListener('click', async () => {
    const event = hooks.current().event;
    if (!event || !pendingTarget) return;
    pickerConfirmBtn.disabled = true;
    const data = await post({ action: 'link', sourceKey: seriesKeyOf(event), targetKey: pendingTarget });
    pickerConfirmBtn.disabled = false;
    if (!data) {
      showPickerStep('browse');
      closePicker();
      return;
    }
    if (data.flyerUrl) hooks.flyerShared(data.flyerUrl, groupKeys(seriesKeyOf(event)));
    closePicker();
    render();
  });

  return {
    async load(headers: Record<string, string>) {
      try {
        const res = await fetch('/api/admin/event-links', { headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Failed to load linked classes.');
        links = data.links ?? [];
        rules = data.rules ?? [];
        loadError = null;
      } catch (err) {
        loadError = `Linked classes couldn't be loaded (${err instanceof Error ? err.message : 'unknown error'}). Reload the page to try again.`;
      }
    },
    render() {
      showError(null);
      render();
    },
    // The series linked with `key` (itself included), for the editor's tabs.
    groupKeys,
    occurrenceFor,
    // The section's one-line summary in the editor menu.
    summary(): string {
      const { event, pendingLinkTo } = hooks.current();
      if (!event) return pendingLinkTo ? `With ${titleOf(pendingLinkTo)}` : 'Not linked';
      const keys = groupKeys(seriesKeyOf(event));
      if (keys.length < 2) return 'Not linked';
      const ruleCount = rules.filter((r) => keys.includes(r.from) && keys.includes(r.to)).length;
      return `Linked with ${keys.length - 1}${ruleCount ? ` · ${ruleCount} rule${ruleCount === 1 ? '' : 's'}` : ''}`;
    },
  };
}
