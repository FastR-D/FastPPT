// uno.config.ts
import {defineConfig, presetWind4} from 'unocss'
import presetIcons from '@unocss/preset-icons'

export default defineConfig({
    presets: [
        presetIcons({
            scale: 1,
            // Enable offline usage with iconify-json if you’ve added the collections
            // e.g., `npm i -D @iconify-json/fa6-solid @iconify-json/fa6-regular`
            collections: {
                // You can leave this empty if using the default automatic fetch.
                // Adding collections is optional when iconify-json is installed.
            },
        }),
    ],
})
