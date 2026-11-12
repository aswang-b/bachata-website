// Admin controls on the calendar. The event editor's code (./editor) is only
// downloaded once the page finds an admin session, so public visitors never
// load it; it is wired up before the first admin control (the Add button, the
// details panel's Edit) shows, so those work as soon as they appear.
import { checkAdminSession } from '../../lib/adminSession';
import { isPreviewingAsPublic } from '../../lib/previewMode';

export async function revealAdminControlsIfAdmin() {
  if (isPreviewingAsPublic()) return;

  const gate = await checkAdminSession();
  if (gate.status !== 'admin') return;
  const { session } = gate;

  const { revealAdminControls, startAdminEditor } = await import('./editor/start');
  startAdminEditor();
  await revealAdminControls(session);
}
