---
theme: ./
layout: default
pattern: grid
label: MadVue 2026
headline: VUE REAL-TIME APPS
subtitle: A talk by Nico Devs
stamp:
  url: https://vuejs.org/images/logo.png
  position: tr
---

---
layout: default
pattern: dots
label: Intro
headline: Hi, I'm Nico
subtitle: Brief speaker intro
stamp:
  emoji: 👋
  position: tr
---

---
layout: default
pattern: stripes
label: Section
headline: Time to Start Building
subtitle: Layouts & patterns
stamp:
  url: https://vuejs.org/images/logo.png
  position: tl
---

---
layout: default
pattern: gingham
label: Statement
headline: Alpha Bravo Charlie Delta
subtitle: But we ship anyway
stamp:
  url: https://vuejs.org/images/logo.png
  position: br
---

---
layout: default
pattern: grid
label: Fact
headline: 42%
subtitle: of slides are made on a deadline
stamp:
  url: https://vuejs.org/images/logo.png
  position: bl
---

---
layout: default
pattern: diagonal
label: Quote
quote: Good Design Is As Little Design As Possible
subtitle: — Dieter Rams
stamp:
  icon: mdi:format-quote-close
  position: tr
---

---
layout: default
label: Items
headline: What's in the Box
pattern: dots
stamp:
  url: https://vuejs.org/images/logo.png
  position: tr
items:
  - Cream chapter cards
  - Six craft-paper palettes
  - Seven repeating patterns
  - Optional polaroid stamp
  - Monokai code blocks
  - Auto-publish to npm
---

---
layout: default
pattern: grid
cards:
  - text: Server-Sent Events
    subtext: One-way push from server
    label: mdi:broadcast
    color: '#5da9e9'
  - text: WebSockets
    subtext: Full-duplex over TCP
    label: mdi:lan-connect
    color: '#9b6dff'
  - text: WebRTC
    subtext: Peer-to-peer media & data
    label: mdi:video
    color: '#ff8a3d'
---

---
layout: default
pattern: dots
headline: Works in every browser
stickers:
  - icon: logos:chrome
    rotation: -6
  - icon: logos:firefox
    rotation: 4
  - icon: logos:microsoft-edge
    rotation: -3
  - icon: logos:safari
    rotation: 5
---

---
layout: default
pattern: grid
snippet: chat.vue
---

````md magic-move
```vue
<script setup>
const input = ref('')
</script>
```

```vue
<script setup>
const input = ref('')
const messages = ref([])
</script>
```

```vue
<script setup>
const input = ref('')
const messages = ref([])

const { data, send } = useWebSocket('ws://localhost:3000/_ws')
</script>
```

```vue
<script setup>
const input = ref('')
const messages = ref([])

const { data, send } = useWebSocket('ws://localhost:3000/_ws')
watch(data, (msg) => messages.value.push(msg))
</script>
```

```vue
<script setup>
const input = ref('')
const messages = ref([])

const { data, send } = useWebSocket('ws://localhost:3000/_ws')
watch(data, (msg) => messages.value.push(msg))

function submit() {
  send(input.value)
  messages.value.push(`Me: ${input.value}`)
  input.value = ''
}
</script>

<template>
  <input v-model="input" @keyup.enter="submit" />
  <div v-for="(msg, i) in messages" :key="i">{{ msg }}</div>
</template>
```
````

---
layout: default
pattern: stripes
label: End
headline: Lorem Ipsum Finale
subtitle: That's a wrap
stamp:
  url: https://vuejs.org/images/logo.png
  position: bl
---

---
layout: default
pattern: dots
---

# Default

Regular content slides ride on the same patterned background, with a cream card holding the content.

- First point with some context
- Second point with **bold emphasis**
- Third point with `inline code`

```ts
const theme = 'mumbo'
console.log(`Using ${theme}`)
```
