import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin/cli.ts'],
  format: 'esm',
  sourcemap: true,
  outdir: 'dist',
  clean: true,
  splitting: true,
  tsconfig: './tsconfig.json',
});
