import { markRowPaid } from '../lib/dancerPaid';

// Browser-only. The dashboard's Paid switches (Sign-Ups and Event
// Registration): one per dancer row, saving only that dancer's Paid, so the
// others on a group sign-up keep theirs (src/lib/dancerPaid.ts).

interface PaidRow {
  submissionId: string;
  dancerIndex: number | null;
  paid: boolean;
}

export interface PaidChange {
  submissionId: string;
  dancerIndex: number | null;
  paid: boolean;
}

// The switch's data attributes: its sign-up and dancer (none for a one-person sign-up).
export const paidSwitchData = (s: PaidRow) => `data-submission-id="${s.submissionId}" data-dancer-index="${s.dancerIndex ?? ''}"`;

// A Paid switch set back from code (its save failed) fires no change
// event, so this tells its row's phone layout to show the real state.
function revertedPaid(checkbox: HTMLInputElement) {
  checkbox.dispatchEvent(new Event('paid-reverted', { bubbles: true }));
}

// Saves a switched dancer through `save`; on success only that dancer's row
// in `rows` changes (then `onSaved`), on failure only that switch goes back.
export function bindPaidSwitches(boxes: Iterable<HTMLInputElement>, rows: PaidRow[], save: (change: PaidChange) => Promise<boolean>, onSaved?: () => void): void {
  for (const checkbox of boxes) {
    checkbox.addEventListener('change', async () => {
      const raw = checkbox.dataset.dancerIndex;
      const change: PaidChange = { submissionId: checkbox.dataset.submissionId!, dancerIndex: raw ? Number(raw) : null, paid: checkbox.checked };
      checkbox.disabled = true;
      const ok = await save(change).catch(() => false);
      if (ok) markRowPaid(rows, change.submissionId, change.dancerIndex, change.paid);
      else {
        checkbox.checked = !change.paid;
        revertedPaid(checkbox);
      }
      checkbox.disabled = false;
      if (ok) onSaved?.();
    });
  }
}
