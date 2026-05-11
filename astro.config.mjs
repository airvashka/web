// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://sfr-motor.cz',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  integrations: [sitemap()],
  image: {
    // Astro 5 native image optimization
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
