/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_DIRECTUS_URL: string;
  readonly DIRECTUS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
