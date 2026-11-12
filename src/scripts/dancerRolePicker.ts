// The Leader/Follower picker markup inside each dancer block of the sign-up form (classes only).
export const ROLE_PICKER_HTML = `
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-ink/80">Role<span class="text-accent"> *</span></span>
        <div class="flex gap-2">
          <button type="button" data-role="leader" aria-pressed="false" class="dancer-role-btn hit-44 relative flex-1 rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-ink/70 transition-colors">
            Leader
          </button>
          <button type="button" data-role="follower" aria-pressed="false" class="dancer-role-btn hit-44 relative flex-1 rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-ink/70 transition-colors">
            Follower
          </button>
        </div>
      </div>`;
