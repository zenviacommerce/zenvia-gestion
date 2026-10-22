// Opt-in investigative harness. Deliberately excluded from the default suite.
import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['reviews/orders-active-projection-compatibility.review.ts'],environment:'node',testTimeout:20000}});
