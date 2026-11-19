// Admin controls on the calendar. The event editor's code (./editor) is only
// downloaded once the page finds an admin session, so public visitors never
// load it; it is wired up before the first admin control (the Add button, the
// details panel's Edit) shows, so those work as soon as they appear. The
// Supabase client itself only comes down when a session might be stored
// (lib/sessionHint.ts).
import { checkAdminSessionIfStored } from '../../lib/sessionHint';
import { isPreviewingAsPublic } from '../../lib/previewMode';

export async function revealAdminControlsIfAdmin() {
  if (isPreviewingAsPublic()) return;

  const gate = await checkAdminSessionIfStored();
  if (gate.status !== 'admin') return;
  const { session } = gate;

  const { revealAdminControls, startAdminEditor } = await import('./editor/start');
  startAdminEditor();
  await revealAdminControls(session);
}
