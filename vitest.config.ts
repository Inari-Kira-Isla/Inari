import { defineConfig } from 'vitest/config';

// 純函式 + 引擎測試。唔跑瀏覽器,唔打 DB(gold set 自足)。
// deploy 唔受影響:Vercel build 只行 `astro build`,唔行 test。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
