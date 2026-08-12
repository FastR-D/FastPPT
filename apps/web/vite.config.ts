import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), UnoCSS()],
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // codemirror 为按需加载的懒 chunk(610 kB min / 209 kB gzip),
    // 不在首屏关键路径上,故阈值覆盖它,不做无意义的再拆分
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vue-vendor',
              test: /node_modules[\\/](vue|@vue|vue-router|pinia)[\\/]/,
              priority: 2,
            },
            {
              name: 'codemirror',
              test: /node_modules[\\/](codemirror|@codemirror|@lezer)[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
})
