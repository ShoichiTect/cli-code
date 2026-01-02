import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/integration/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/core/main.ts'],
		},
	},
});
