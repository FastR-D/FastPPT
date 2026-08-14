# Third-party font notices

The fonts bundled in `assets/fonts/` come from their respective projects. All are
free for commercial use; the license files are reproduced from each project.

| Family | File | Source | License |
| --- | --- | --- | --- |
| Inter | `inter-variable.ttf` | google/fonts | [OFL-1.1](https://openfontlicense.org) |
| Space Grotesk | `space-grotesk-variable.ttf` | google/fonts | OFL-1.1 |
| Fira Code | `fira-code-variable.ttf` | google/fonts | OFL-1.1 |
| JetBrains Mono | `jetbrains-mono-variable.ttf` | google/fonts | OFL-1.1 |
| Space Mono | `space-mono-regular.ttf` | google/fonts | OFL-1.1 |
| Nunito Sans | `nunito-sans-variable.ttf` | google/fonts | OFL-1.1 |
| Sofia Sans | `sofia-sans-variable.ttf` | google/fonts | OFL-1.1 |
| Lexend | `lexend-variable.ttf` | google/fonts | OFL-1.1 |
| Caveat | `caveat-variable.ttf` | google/fonts | OFL-1.1 |
| Shantell Sans | `shantell-sans-variable.ttf` | google/fonts | OFL-1.1 |
| Noto Sans SC | `noto-sans-sc-variable.ttf` | google/fonts | OFL-1.1 |
| Noto Serif SC | `noto-serif-sc-variable.ttf` | google/fonts | OFL-1.1 |
| LXGW WenKai (霞鹜文楷) | `lxgw-wenkai-regular.ttf` | [lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai) | OFL-1.1 |
| ZCOOL KuaiLe | `zcool-kuale-regular.ttf` | google/fonts | OFL-1.1 |
| MiSans | `misans-regular.ttf`, `misans-bold.ttf` and `misans/` web subsets | [misans npm](https://www.npmjs.com/package/misans) version 4.1 | Xiaomi [MiSans license](https://hyperos.mi.com/font/en/) |

MiSans browser previews use version 4.1 per-unicode-range WOFF2 subsets. The
complete Regular/Bold TTF files are merged from those same subsets, ensuring
English, numbers and Chinese use the same glyph version in PPTX exports.

Regenerate the binaries with:

```bash
pnpm --filter @fastppt/fonts fetch-fonts
```

MiSans embedding requires the Regular/Bold TTF files; a missing binary is reported as
an export warning instead of silently substituting another family.
