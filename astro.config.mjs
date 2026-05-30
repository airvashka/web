// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://sfr-motor.cz',
  output: 'static',  // default static, individual routes opt-in to SSR via `export const prerender = false`
  adapter: vercel(),
  trailingSlash: 'ignore',
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  image: {
    // Astro 5 native image optimization
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
