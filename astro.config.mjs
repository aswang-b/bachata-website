// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  site: 'https://dancewithb.fun',

  vite: {
    plugins: [tailwindcss()]
  },

  // The site has no Netlify edge functions; starting their local dev server
  // (which needs Deno) only fails and shows an error overlay in `astro dev`.
  adapter: netlify({ devFeatures: { edgeFunctions: false } })
});