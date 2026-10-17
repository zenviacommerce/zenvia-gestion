import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],test:{environment:'jsdom',include:['tests/**/*.test.ts','tests/**/*.test.tsx'],restoreMocks:true,testTimeout:15000,environmentOptions:{jsdom:{url:'https://gestion.test/'}}}});
