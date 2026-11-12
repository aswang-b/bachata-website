// The events the calendar shows: the public page's copy (with spots labels), or the admin feed (/api/admin/all-events) with capacities.
export interface SiteEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  // Where it is held (migration 0077); named only when away from home (lib/siteLocation.ts).
  city?: string | null;
  state?: string | null;
  event_type: string;
  color: string;
  visibility: 'public' | 'private' | 'test';
  start_time: string;
  end_time: string;
  // Its own zone (migration 0076): its day and times are shown in it (lib/eventClock.ts).
  time_zone?: string | null;
  google_recurring_event_id: string | null;
  price_whole_series: number | null;
  price_drop_in: number | null;
  price_student: number | null;
  image_url: string | null;
  flyer_url: string | null;
  registration_closed: boolean;
  price_whole_series_early_bird: number | null;
  price_drop_in_early_bird: number | null;
  price_student_early_bird: number | null;
  early_bird_until: string | null;
  price_whole_series_flash_sale: number | null;
  price_drop_in_flash_sale: number | null;
  price_student_flash_sale: number | null;
  flash_sale_until: string | null;
  show_early_bird_end?: boolean;
  show_flash_sale_end?: boolean;
  lesson_overview_title: string | null;
  lesson_overview_body: string | null;
  hide_lesson_overview: boolean;
  capacity?: number | null;
  show_capacity?: boolean;
  capacity_by_role?: boolean;
  leader_capacity?: number | null;
  follower_capacity?: number | null;
  // e.g. "5 spots remaining". For the public only when show_capacity (or
  // something is full); always for admins, with spots_admin_only when hidden.
  spots_label?: string | null;
  spots_admin_only?: boolean;
  // Public feed only: the panel offers "Ask about a spot" (lib/askAboutSpot.ts).
  ask_spot?: boolean;
  // Admin feed only: when the event was last edited (for the recent-color picks).
  updated_at?: string;
  weekNumber?: number | null;
}
