import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    environment: 'node',
    alias: { vscode: new URL('./src/test/vscode-stub.ts', import.meta.url).pathname }
  }
});
