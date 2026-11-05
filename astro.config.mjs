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
    // client-side, and discovering it on first load serves a stale module.
    optimizeDeps: { include: ['qrcode'] }
  },

  // The site has no Netlify edge functions; starting their local dev server
  // (which needs Deno) only fails and shows an error overlay in `astro dev`.
  // (The type wants all three; the other two are the adapter's defaults.)
  adapter: netlify({ devFeatures: { edgeFunctions: false, images: true, environmentVariables: false } })
});