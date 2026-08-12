---
theme: ./
background: images/nmt-bg-red-top.svg

addons:
  - slidev-addon-sync
  
lineNumbers: true

#syncSettings:
#  server: http://127.0.0.1:8080
syncStates:
  poll:
    presenter: false
    init: false
  pollUsers:
    presenter: true
  # Add the following lines if you want to also sync slidev channels
  shared: [ "page", "clicks", "cursor", "lastUpdate" ]
  drawings: false
---

# Slidev - NMT

## Created by [Adrian Gould](https://github.com/adygcode)

&nbsp; Based on "The Unnamed" by [Elio Struyf](https://eliostruyf.com)

&nbsp; <small class="text-sm">An (unofficial) Slidev theme for Lecturers using Slidev for presentations
at [North Metropolitan TAFE](https://northmetrotafe.wa.edu.au), Perth WA, Australia.</small>


---
layout: about-me

helloMsg: Your Presenter
name: Adrian Gould
position: left
company: "North Metropolitan TAFE"
jobRole: "ASL | HelpDesk Admin | ScreenCraft Admin"
subjects: "SaaS, API Dev, IoT"
email: "adrian.gould@nmtafe.wa.edu.au"
msTeams: "Teams: adrian.gould@nmtafe.wa.edu.au"
website: "https://northmetrotafe.wa.edu.au"
github: "https://github.com/adygcode"
imageSrc: /images/ajg-designer.png
skills: "PHP, C++, Design"
facebook: "@Facebook name"
twitter: "@Twitter name"
instagram: "@Instagram name"
line1: "Line 1 - use line1, line2 and line3 for other details"
line2: "Line 2 - use line1, line2 and line3 for other details"
line3: "Line 3 - use line1, line2 and line3 for other details"
---


---
layout: cover
background: images/nmt-bg-red-top.svg
---

# Cover title

## Level 2 on Cover

Paragraph on the cover.


---
layout: section
background: images/nmt-bg-red-top.svg
---

# Section title with Subheading

## Subheading if needed

Short content

---
layout: center
---

# Center title  AaHhJjGgMmYy

Subtitle for the center layout


---
layout: figure
figureUrl: images/ajg-designer.png
figureCaption: Picture of Author
---


---
layout: figure-side
figureUrl: images/ajg-designer.png
figureCaption: Picture of Author
---

# Image on side

---
layout: two-cols
---

# Two Columns

::left::

## Left

This shows on the left 1/2

::right::

## Right

This shows on the right 1/2


---
layout: two-cols-2-1
---

# Two Columns 2:1

::left::


## Left

This shows on the left 2/3

::right::

## Right

This shows on the right 1/3


---
layout: grid
---

# 4 Section Grid

::tr::

## Top Right

```text
::tr::
```

::tl::

## Top Left

```text
::tl::
```

::br::

## Bottom Right

```text
::br::
```

::bl::

## Bottom Left

```text
::bl::
```

Here is some dummy content.

It is interesting to see how it reforms the page.



---

# Code with Highlighting

The code highlighting is powered by Shiki

```ts {1-6|8-12|all}
interface User {
    id: number
    firstName: string
    lastName: string
    role: string
}

function updateUser(id: number, update: Partial<User>) {
    const user = getUser(id)
    const newUser = {...user, ...update}
    saveUser(id, newUser)
}
```

---
layout: default
---

# Announcements

A small component to add an announcement to a page.

<Announcement type="default" title="Default" inline>
    Just something to think about
</Announcement>

<Announcement type="idea" title="Idea" inline>
    Propose an idea
</Announcement>

<Announcement type="brainstorm" title="Brainstorm" inline>
    We need ideas
</Announcement>

<Announcement type="error" title="Error" inline>
    Danger or probable BOO-BOO
</Announcement>

<Announcement type="warning" inline title="Warning">
    When errors MAY happen
</Announcement>

<Announcement type="info" inline title="Info">
    Sidebar information
</Announcement>

<Announcement type="duration" title="Duration" inline>
    How long it takes
</Announcement>

<Announcement type="important" title="Important">
Bring attention to an item
</Announcement>

<Announcement type="joke" title="Joke">
Bring attention to an item
</Announcement>

<Announcement type="priority" title="Priority" width="full">
Do this first
</Announcement>

<Announcement type="info" title="Heads up" class="bg-slate-800! color-slate-400!">
    Custom icon via slot
    <template #icon>
        <i class="i-fa-solid-user-ninja h-5 w-5 mt-0.5"></i>
    </template>
</Announcement>


---

# Table

| Title         | Description                          | Default       |
|---------------|--------------------------------------|---------------|
| `layout`      | The layout to use for the slide      | `default`     |
| `theme`       | The theme to use for the slide       | `the-unnamed` |
| `highlighter` | The highlighter to use for the slide | `shiki`       |
| `background`  | The background to use for the slide  | `none`        |

## Content underneath

Some content to place here

---

# Todo

- [ ] Add a todo list
- [ ] Add a todo list
- [x] Add a todo list

---

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

Text within this page

> **Info**: This is a note

---

# Poll Component

<Poll
displayResults="quiz"
question="What is your favorite color ?"
:answers="['Red', 'Green', 'Blue']"
/>

Smile-SA/slidev-component-poll: Poll component for Slidev. (2025).
GitHub. https://github.com/Smile-SA/slidev-component-poll?tab=readme-ov-file

Smile-SA/slidev-addon-sync. (2025). GitHub. https://github.com/Smile-SA/slidev-addon-sync

---

# What is Slidev?

Slidev is a slides maker and presenter designed for developers, consist of the following features

- 📝 **Text-based** - focus on the content with Markdown, and then style them later
- 🎨 **Themable** - theme can be shared and used with npm packages
- 🧑‍💻 **Developer Friendly** - code highlighting, live coding with autocompletion
- 🤹 **Interactive** - embedding Vue components to enhance your expressions
- 🎥 **Recording** - built-in recording and camera view
- 📤 **Portable** - export into PDF, PNGs, or even a hostable SPA
- 🛠 **Hackable** - anything possible on a webpage

<br>
<br>

Read more about [Why Slidev?](https://sli.dev/guide/why)


---

# Navigation

Hover on the bottom-left corner to see the navigation's controls panel

### Keyboard Shortcuts

|                                                      |                             |
|------------------------------------------------------|-----------------------------|
| <kbd>space</kbd> / <kbd>tab</kbd> / <kbd>right</kbd> | next animation or slide     |
| <kbd>left</kbd>  / <kbd>shift</kbd><kbd>space</kbd>  | previous animation or slide |
| <kbd>up</kbd>                                        | previous slide              |
| <kbd>down</kbd>                                      | next slide                  |

---
layout: center
class: "text-center"
---

# Learn More

[Documentations](https://sli.dev) / [GitHub Repo](https://github.com/slidevjs/slidev)


---
layout: end
transition: fade-out
level: 2
---

# Laisser les bon temps rouler <fa-solid-brain />

The end... for now
