import { defineConfig, presetIcons, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3(), presetIcons()],
  shortcuts: {
    'panel-surface':
      'min-h-0 bg-[var(--color-panel)] border-[var(--color-border)]',
    'status-dot': 'inline-block h-2 w-2 rounded-full',
  },
})
