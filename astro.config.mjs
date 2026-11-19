// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  site: 'https://dancewithb.fun',

  vite: {
    plugins: [tailwindcss()],
    // Bundled for the browser up front: the door sign (/admin/qr) draws codes
    // client-side, and discovering it on first load serves a stale module. Same
    // for the Supabase client, which public pages import only when a session
    // might be stored (lib/sessionHint.ts): found that late, the re-bundle failed
    // here (OneDrive holds the folder) and the admin check never loaded.
    optimizeDeps: { include: ['qrcode', '@supabase/supabase-js'] },
    // The e2e suite's output (Playwright traces, screenshots, the email sink) is
    // written inside the project while its dev server runs. Vite ignores
    // Playwright's default test-results/ folder but not this one, so every trace
    // write was a file change for the dev server: ~26,000 in a full run, which
    // bogged it down (requests waited up to 20 s before reaching the site's code)
    // and, after any request that failed, made Astro reload every open page.
    server: { watch: { ignored: ['**/tests/e2e/.output/**'] } }
  },

  // The site has no Netlify edge functions; starting their local dev server
  // (which needs Deno) only fails and shows an error overlay in `astro dev`.
  // (The type wants all three; the other two are the adapter's defaults.)
  adapter: netlify({ devFeatures: { edgeFunctions: false, images: true, environmentVariables: false } })
});