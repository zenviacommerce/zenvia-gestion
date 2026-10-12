import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inline-ios-apple-touch-icon',
      enforce: 'pre',
      transformIndexHtml(html: string) {
        // iOS 27.2's Home Screen installer can fail to fetch remote icons
        // even if they work in Safari's Share sheet. Embed the exact PNG
        // directly into HTML so that no additional network fetch is needed.
        const marker = '__ZENVIA_IOS_TOUCH_ICON_DATA__';
        if (!html.includes(marker)) throw new Error('Missing iOS app icon marker');
        const bytes = readFileSync(resolve(process.cwd(), 'public/zenvia-ios-home-180-v3.png'));
        if (bytes.length < 100 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new Error('iOS app icon is not a valid PNG');
        }
        return html.replace(marker, `data:image/png;base64,${bytes.toString('base64')}`);
      },
    },
  ],
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    // iPadOS/Safari can lag desktop browsers by several ECMAScript releases.
    // Keep the production bundle conservative so older supported iPads do not
    // fail before React mounts and leave a blank screen.
    target: ['es2018', 'safari13'],
    cssTarget: 'safari13',
  }
});
