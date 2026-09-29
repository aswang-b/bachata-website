// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import netlify from '@astrojs/netlify';
import vercel from '@astrojs/vercel';

// The same branch deploys to both hosts: Vercel sets VERCEL during its builds,
// and everything else (Netlify, local) uses the Netlify adapter.
const adapter = process.env.VERCEL ? vercel() : netlify();

// https://astro.build/config
export default defineConfig({
  site: 'https://dancewithb.fun',

  vite: {
    plugins: [tailwindcss()]
  },

  adapter
});
