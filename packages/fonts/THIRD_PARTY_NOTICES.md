# Third-party font notices

FastPPT uses MiSans and the OFL fonts below in its themes and editable PPTX
exports. The complete binaries and license texts are checked into this private
workspace package and copied together into the FastPPT CLI distribution.
Do not publish or redistribute MiSans as a standalone font package.

| Family | Files | License |
| --- | --- | --- |
| Inter | `inter-variable.ttf` | OFL-1.1 |
| Space Grotesk | `space-grotesk-variable.ttf` | OFL-1.1 |
| Fira Code | `fira-code-variable.ttf` | OFL-1.1 |
| JetBrains Mono | `jetbrains-mono-variable.ttf` | OFL-1.1 |
| Space Mono | `space-mono-regular.ttf` | OFL-1.1 |
| Nunito Sans | `nunito-sans-variable.ttf` | OFL-1.1 |
| Sofia Sans | `sofia-sans-variable.ttf` | OFL-1.1 |
| Lexend | `lexend-variable.ttf` | OFL-1.1 |
| Caveat | `caveat-variable.ttf` | OFL-1.1 |
| Shantell Sans | `shantell-sans-variable.ttf` | OFL-1.1 |
| Noto Sans SC | `noto-sans-sc-variable.ttf` | OFL-1.1 |
| Noto Serif SC | `noto-serif-sc-variable.ttf` | OFL-1.1 |
| LXGW WenKai | `lxgw-wenkai-regular.ttf` | OFL-1.1 |
| MiSans / MiSans Semibold | `misans-regular.ttf`, `misans-semibold.ttf`, `misans-bold.ttf` | Xiaomi MiSans license |

`assets/licenses/COPYRIGHTS.txt` preserves the OFL copyright notices from the
bundled fonts' name tables; `assets/licenses/OFL.txt` contains the full license.
The original name tables remain embedded in every binary.

The 13 OFL binaries are restored byte-for-byte from FastPPT commit
`62abbaef872bc8e1cb6f28f35439eaabbb512083`. MiSans uses the complete, unmodified
TTF files from `raw/Normal/ttf/` at `dsrkafuu/misans` commit
`caf1ccdb565f3cc47699e92937db7a677cbb877d` (the source commit of `misans@4.1.0`).
The fonts report version 4.003. Browser previews and PPTX embedding use the
same files. No web subsets are merged or regenerated.

MiSans copyright: Copyright © 2020-2023 Beijing Xiaomi Mobile Software Co.,Ltd.
All Rights Reserved. `assets/licenses/MiSans.txt` reproduces the license published
at <https://hyperos.mi.com/font/en/download/>. Its restrictions on adaptation and
standalone font redistribution apply; it is not covered by the npm wrapper's
Apache license or by the other fonts' OFL license.

`font-integrity.json` records the fixed sources and SHA-256 of every binary.
CI verifies these bytes before running the original tests and builds:

```sh
pnpm --filter @fastppt/fonts verify-fonts
```

An ordinary checkout supplies the full catalog without downloads, Python or
fontTools. To update a font, replace it with its upstream original, retain its
license and attribution, and update the corresponding integrity entry.
