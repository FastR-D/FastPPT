# Slidev Theme - NMT (Unofficial)

A [Slidev](https://sli.dev/) theme based on the [The unnamed - VS Code theme](https://marketplace.visualstudio.com/items?itemName=eliostruyf.vscode-unnamed-theme) by [Elio Struyf](https://elio.dev).

> This (unofficial) theme is for use IT lecturers at North Metropolitan TAFE.
>
> We are restricting the customisation ability, but welcome feedback.

## Latest Update [![NPM version](https://img.shields.io/npm/v/slidev-theme-nmt?color=c12138&label=)](https://www.npmjs.com/package/slidev-theme-nmt)

- Add `Announcement` component ([Skip to Components section](#components))
- Update `ReadMe.md`
- Minor fixes to heading styles

## Usage

Add the following front-matter to your `slides.md`.

Start `Slidev` then it will prompt you to install the theme automatically.

```yaml
---
theme: nmt
---
```

## Layouts

The theme currently has the following layouts:

- `about-me`
- `center`
- `cover`
- `default`
- `end`
- `grid`
- `section`
- `two-cols`
- `two-cols-2-1`
- `image`
- `image-side`
- and the ones from Slidev itself

Have included the `Announcements` component in the theme, which can be 
used in any layout.

The `image` layout adapted from
- https://github.com/alexanderdavide/slidev-theme-academic 


### Cover

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/cover.png?raw=true)

#### Usage

```yaml
---
layout: cover
---
```

### About me

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/about-me.png?raw=true)

#### Usage

```yaml
---
layout: about-me

helloMsg: Your Presenter
name: Adrian Gould
position: left
company: "North Metropolitan TAFE"
jobRole: "ASL | HelpDesk Admin | ScreenCraft Admin"
subjects: "SaaS, API Dev, IoT"
msTeams: "Teams: adrian.gould@nmtafe.wa.edu.au"
website: "https://northmetrotafe.wa.edu.au"
github: "https://github.com/adygcode"
imageSrc: /ajg-designer.png
---
```

### Center

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/center.png?raw=true)

#### Usage

```yaml
---
layout: center
---
```

### Section

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/section.png?raw=true)

#### Usage

```yaml
---
layout: section
---
```

### Two columns

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/two-cols.png?raw=true)

#### Usage

```yaml
---
layout: two-cols
---

# Left

This shows on the left

::right::

# Right

This shows on the right
```

### Two columns 2-1

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/two-cols-2-1.png?raw=true)

#### Usage

```yaml
---
layout: two-cols-2-1
---

# Left

This shows on the left

::right::

# Right

This shows on the right
```

### Default

![](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/code.png?raw=true)

#### Usage

```yaml
---
layout: default
---
```

## Components

### Announcement component

A small component to add an announcement to a page.

> **Note**: Experiencing issues with adding as an external dependency 
> so moved code within theme. Separate package to be investigated further.

Used in the form:

```vue
<Announcement type="default" title="Default Note" inline compact >
    Just something to think about
</Announcement>
```

- Types:
    - `type="type_identifier"`
    - where `type_identifier` is one of:
        - `brainstorm`
        - `duration`
        - `idea`
        - `default`
        - `info`
        - `important`
        - `priority`
        - `warning`
        - `error`

- Options:
    - `compact` or `compact="true|false"`
        - a smaller sized version (**optional**, default `false`)
    - `title="..."` 
        - title text (`...`) shown before the slot content (**optional**)
    - `inline` or `inline="true|false"` 
        - allow multiple announcements on a line (**optional**, default `false`)
    - `width="fit|full"` 
        - resizes to `full` width or `fit` to content (**optional**, default `fit`)

#### Icon Override

It is possible to override the icons:

```vue
<Announcement type="info" title="Heads up">
    Custom icon via slot
    <template #icon>
        <i class="i-fa7-solid-user-ninja h-5 w-5 mt-0.5"></i>
    </template>
</Announcement>
```

![Components](https://github.com/AdyGCode/slidev-theme-nmt/blob/main/assets/announcements.png?raw=true)


### Parameters (`PARAMETERS`)

Replace the `PARAMETERS` with the option(s) you wish to employ.

The `PARAMETERS` are:

- `compact` or `compact="true|false"`
  - A smaller sized version 
  - **Optional**
  - **Default** `false` (also when omitted)
- `title="..."`
  - Title text (`...`) shown before the slot content 
  - **Optional**
- `inline` or `inline="true|false"`
  - Allow multiple announcements on a line
  - **Optional**
  - **Default** `false`  (also when omitted)
- `width="fit|full"`
  - Resizes the announcement to full or content width 
  - **Optional** 
  - **Default** `fit` (also when omitted)
  - Resizes to `full` width 
  - Or `fit` to content 


## Examples of Announcement Component

The variants are shown below:

### Default Note

![vivaldi_ud7iYfpT7l.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-default.png?raw=true)

```vue
<Announcement type="default" title="Default Note">
    Just something to think about
</Announcement>
```

### Idea

![vivaldi_o9dXLjuo1a.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-idea.png?raw=true)

```vue
<Announcement type="idea" title="Idea" >
    A useful idea could be identified using this variant
</Announcement>
```

### Brainstorm

![vivaldi_YItAahbh7Y.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-brainstorm.png?raw=true)

```vue
<Announcement type="brainstorm" title="Brainstorm" inline>
    Use to identify when brainstorming of ideas is an activity
</Announcement>
```

### Duration

![vivaldi_QhRet6gn7X.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-duration.png?raw=true)

```vue
<Announcement type="duration" title="Duration" >
    Use to identify how long a section could take
</Announcement>
```


### Error

![vivaldi_3mJ3v6YlCy.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-error.png?raw=true)

```vue
<Announcement type="error" title="Error" >
    Identify common errors, boo-boos and actual errors
</Announcement>
```

### Warning

![vivaldi_rVNJT6RFoH.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-warning.png?raw=true)

```vue
<Announcement type="warning" >
    Warn when an action could be dangerous, or should carefully be completed
</Announcement>
```

### Information

![vivaldi_nSxFPsnSoG.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-information.png?raw=true)

```vue
<Announcement type="info" >
    Information that could be useful for the current section
</Announcement>
```

### Important

![vivaldi_EDp0SqaIXh.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-important.png?raw=true)

```vue
<Announcement type="important" title="Important">
    When it is really important to complete an action
</Announcement>
```

### Priority

![vivaldi_fyGBubZXgz.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-priority.png?raw=true)

```vue
<Announcement type="priority" compact width="full">
    Do or Read this before you do anything else
</Announcement>
```

### Overriding icons

![vivaldi_6HFCXMNsjS.png](https://github.com/AdyGCode/slidev-addon-announcement/blob/main/assets/announcement-custom-icon.png?raw=true)

```vue
<Announcement type="info" title="Heads up">
    Custom icon via slot
    <template #icon>
        <i class="i-fa7-solid-user-ninja h-5 w-5 mt-0.5"></i>
    </template>
</Announcement>
```

## Requirements

Following packages are required for use:

- 'unocss'
- '@iconify-json/fa7-brands'
- '@iconify-json/fa7-regular'
- '@iconify-json/fa7-solid'
- '@unocss/preset-icons'

You may manually install these using:

### npm
```shell
npm i -D @unocss/preset-icons unocss
npm i -D @iconify-json/fa7-brands @iconify-json/fa7-regular 
npm i -D @iconify-json/fa7-solid
```

### pnpm
```shell
pnpm i -D @unocss/preset-icons unocss
pnpm i -D @iconify-json/fa7-brands @iconify-json/fa7-regular 
pnpm i -D @iconify-json/fa7-solid 
```



![Visits](https://visitorbadge.vercel.app//api/badge/0eb6e5bf-1c67-400f-a9b3-17f25997c209?style=for-the-badge&color=bd0000&labelColor=000000)
