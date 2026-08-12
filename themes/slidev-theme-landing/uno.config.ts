import {
  defineConfig,
  presetIcons,
  presetWind3,
  type Preset,
} from "unocss";
import { presetPalette } from "unocss-preset-palette";

const landingColors = {
  blue: "#3b99d4",
  deepblue: "#002554",
  green: "#115740",
  pink: "#f8a3bc",
  sky: "#41b6e6",
  yellow: "#ffa300",
  purple: "#33058d",
  cyan: "#00797c",
  red: "#e10800",
  grey: "#c1c6c8",
};

export default defineConfig({
  presets: [
    presetWind3(),
    presetIcons({
      /* 选项 */
      prefix: "i-",
      extraProperties: {
        display: "inline-block",
        "vertical-align": "middle",
      },
    }),
    presetPalette({
      colors: {
        primary: landingColors.blue,
        secondary: landingColors.green,
        ...Object.fromEntries(
          Object.entries(landingColors).map(([k, v]) => [`whu-${k}`, v]),
        ),
      },
    }) as Preset,
  ],
  shortcuts: [
    {
      "bg-primary": "bg-[#3b99d4]",
      "page-number":
        "italic font-bold text-base font-[Times_New_Roman,serif] [font-variant-numeric:lining-nums] tracking-wide",
      "flex-center": "flex items-center justify-center",
    },
    [
      /^d-mark-(.*)$/,
      ([, c]) =>
        `relative z-1 inline font-bold bg-gradient-to-b from-transparent from-35% via-${c} via-35% via-${c} via-80% to-transparent to-80%`,
    ],
  ],
  theme: {
    colors: {
      primary: "#3b99d4",
      secondary: "#115740",
      whu: landingColors,
    },
  },
});
