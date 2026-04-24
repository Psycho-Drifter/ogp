import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^\.\.\/(.+)\.js$/,
        replacement: path.resolve(__dirname, 'src/$1'),
      },
      {
        find: /^\.\.\/(.+\.json)$/,
        replacement: path.resolve(__dirname, 'src/$1'),
      },
    ],
    extensions: ['.ts', '.tsx', '.js'],
  },
  test: {
    globals: true,
  },
});
