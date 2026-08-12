---
theme: ./
---

# BRUTALIST SLIDES

A bold theme for bold talks

---

# Default Layout

Regular content slides with a **yellow accent** bar on headings.

- First point with some context
- Second point with **bold emphasis**
- Third point with `inline code`

---
layout: section
---

# SECTION BREAK

---
layout: statement
---

Ship it or it doesn't exist.

---
layout: fact
---

# 42%

of developers prefer dark mode presentations

---
layout: quote
---

> "Good design is as little design as possible."
>
> — Dieter Rams

---
layout: two-cols
---

# Left Side

Content on the left with a hard border divider.

- Point one
- Point two

::right::

# Right Side

Content on the right, clean and separated.

```js
const theme = 'nicodevs'
console.log(`Using ${theme}`)
```

---

# Code Example

```php
class Talk extends Slidev
{
    public function present(): void
    {
        $this->slides->each(fn ($slide) =>
            $slide->render()
        );
    }
}
```

---
layout: end
---

# THANK YOU

@nicodevs
