import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

const reportName = process.argv[3]?.split('=')?.[1] ?? 'node';
const date = Date.now();
const reportFolder = `test-results/report-${date}`;

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'index',
    },
    target: 'node',
  },
  test: {
    api: {
      port: 3000,
    },
    ui: true,
    uiBase: '/',

    // coverage: {
    //   enabled: reportName === 'node',
    //   provider: 'istanbul',
    //   reportsDirectory: reportFolder + '/coverage',
    //   reporter: ['html'],
    //   reportOnFailure: true,
    // },
    // outputFile: reportFolder + '/index.html',
    // reporters: ['html', 'default'],
    // benchmark: {
    //   reporters: ["default", "json", "verbose"],
    //   outputFile: {
    //     json: reportFolder + "/bench/benchmark.json",
    //     verbose: reportFolder + "/bench/benchmark.txt",
    //     default: reportFolder + "/bench/benchmark.html",
    //   },
    // },
  },
});
