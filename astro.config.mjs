// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  vite: {
    plugins: [tailwindcss()],
  },
});
