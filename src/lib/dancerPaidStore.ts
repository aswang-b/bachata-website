import { supabase } from './supabase';
import { withDancerPaid } from './dancerPaid';

// Saves one dancer's Paid (`dancers[i].paid`, see dancerPaid.ts) with the
// sign-up's own `paid` (every live dancer paid), in one update. The dancers
// list is only written back if nobody changed it since it was read (another
// tab's lock can move a dancer to the Recycling Bin, restore one, or empty the
// bin), retrying on a fresh copy otherwise, so that change is never undone.

export class DancerPaidError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function setDancerPaid(submissionId: string, dancerIndex: number | null, paid: boolean): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error: readError } = await supabase
      .from('intake_submissions')
      .select('dancers, paid')
      .eq('id', submissionId)
      .is('deleted_at', null)
      .maybeSingle();
    if (readError) throw new DancerPaidError('Failed to update.', 500);
    if (!row) throw new DancerPaidError('Sign-up not found.', 404);

    const change = withDancerPaid(row.dancers, Boolean(row.paid), dancerIndex, paid);
    if (!change.ok) {
      throw change.error === 'missing-index' ? new DancerPaidError('Missing dancerIndex.', 400) : new DancerPaidError('Dancer not found.', 404);
    }

    let query = supabase
      .from('intake_submissions')
      .update(change.dancers ? { dancers: change.dancers, paid: change.paid } : { paid: change.paid })
      .eq('id', submissionId)
      .is('deleted_at', null);
    if (change.dancers) query = query.eq('dancers', JSON.stringify(row.dancers)).eq('paid', Boolean(row.paid));
    const { data: written, error } = await query.select('id');
    if (error) throw new DancerPaidError('Failed to update.', 500);
    if (written && written.length > 0) return;
  }
  throw new DancerPaidError('This sign-up changed while saving. Please try again.', 409);
}
