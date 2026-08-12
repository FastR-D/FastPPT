# slidev-theme-nicodevs

A bold, brutalist [Slidev](https://sli.dev) theme. Dark by default, Space Grotesk for sans, JetBrains Mono for code, hard borders and yellow accents.

## Install

Add this line to your slides frontmatter:

```yaml
---
theme: nicodevs
---
```

Slidev will prompt to install the theme on first run. Or install it manually:

```bash
npm install slidev-theme-nicodevs
```

## Layouts

| Layout      | Use for                                  |
| ----------- | ---------------------------------------- |
| `default`   | Standard content slides                  |
| `cover`     | Title slide                              |
| `intro`     | Speaker / talk intro                     |
| `section`   | Section break                            |
| `statement` | Single-line statement                    |
| `fact`      | Big number or fact                       |
| `quote`     | Pull quote                               |
| `end`       | Closing slide                            |

See [`example.md`](./example.md) for a working demo of every layout.

## Local development

```bash
npm install
npm run dev      # opens example.md
npm run export   # PDF
```

## License

MIT — Nico Devs
