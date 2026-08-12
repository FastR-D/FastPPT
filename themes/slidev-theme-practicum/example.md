---
theme: ./
title: Яндекс Практикум — справочная галерея
routerMode: hash
preload: false
layout: cover
variant: grid
mode: dark
tone: blue
themeConfig:
  deckTitle: 'Как делать слайды в стиле Практикума'
  debugGrid: false
---

<Slot role="primary" surface="dark" margin="4" gap="4">
  <Text as="h1" size="7">Как делать слайды в стиле Практикума</Text>
  <Text size="3" align="end" muted>
    Эта колода — самопример: каждый слайд показывает свою задачу, а исходник работает как готовый шаблон для копирования.
  </Text>
</Slot>

<Slot
  role="media"
  surface="color"
  tone="green"
  :decor="{ meaning: 'cover', tone: 'green', color: 'var(--theme-color-light-0)' }"
/>

<Slot
  role="media"
  surface="dark"
  :decor="{ meaning: 'cover', tone: 'green', color: 'var(--theme-color-green-0)' }"
/>

<Slot
  role="media"
  :decor="{ meaning: 'workspace', tone: 'blue', position: '50% 10%', zoom: 1.5 }"
/>

---
layout: cover
variant: grid
mode: dark
tone: blue
---

<Slot role="primary" surface="dark" margin="4" gap="4">
  <Text as="h1" size="7">Стандартный вход с триптихом справа</Text>
  <Text size="3" align="end" muted>
    Заголовок занимает левую половину, а три квадратных слота держат настроение раздела. Берите для большинства разделов: спокойно, но фирменно.
  </Text>
</Slot>

<Slot
  role="media"
  surface="color"
  tone="blue"
  :decor="{ meaning: 'cover', tone: 'blue', color: 'var(--theme-color-light-0)' }"
/>

<Slot
  role="media"
  :decor="{ meaning: 'workspace', tone: 'blue', position: '50% 44%', zoom: 1.06 }"
/>

<Slot
  role="media"
  surface="dark"
  :decor="{ meaning: 'cover', tone: 'blue', color: 'var(--theme-color-blue-0)' }"
/>

---
layout: cover
variant: grid-balanced
mode: light
tone: orange
---

<Slot role="primary" surface="dark" margin="4" gap="4">
  <Text as="h1" size="7">Несколько равноправных опор</Text>
  <Text size="3" align="end" muted>
    Высота нижнего блока выровнена с двумя верхними. Используйте, когда у темы нет одной центральной картинки и важно держать ритм.
  </Text>
</Slot>

<Slot
  role="media"
  surface="color"
  tone="orange"
  :decor="{ meaning: 'cover', tone: 'orange', zoom: 4, color: 'var(--theme-color-light-0)' }"
/>

<Slot
  role="media"
  :decor="{ meaning: 'home', tone: 'orange', position: '50% 0%', zoom: 1.2 }"
/>

<Slot
  role="media"
  surface="tint"
  tone="orange"
  :decor="{ id: 'decor-support-raster-02' }"
/>

---
layout: cover
variant: banner
mode: light
tone: orange
---

<Slot role="primary" surface="light" margin="4" gap="4">
  <Text as="h1" size="7">Когда нужен широкий вход</Text>
  <Text size="3">
    Заголовок на полную ширину сразу заявляет тему. Внизу — три равные опоры, которые держат визуальный ритм без конкуренции с заголовком.
  </Text>
</Slot>

<Slot
  role="media"
  surface="color"
  tone="orange"
  :decor="{ meaning: 'support', tone: 'orange', zoom: 1.3, color: 'var(--theme-color-light-0)' }"
/>

<Slot
  role="media"
  :decor="{ meaning: 'workspace', tone: 'blue', position: '50% 44%', zoom: 1.08 }"
/>

<Slot
  role="media"
  surface="dark"
  :decor="{ id: 'decor-cover-vertical-01', rotate: '90deg', zoom: 1.45, color: 'var(--theme-color-orange-0)' }"
/>

---
layout: cover
variant: signal
mode: dark
tone: blue
---

<Slot role="primary" surface="light" margin="4" gap="4">
  <Text as="h1" size="7">Сильный тезис просит контраста</Text>
  <Text size="3" align="end" muted>
    Слева — широкая зона текста, справа узкий тёмный столбец. Композиция останавливает внимание и задаёт темп раздела.
  </Text>
</Slot>

<Slot
  role="media"
  surface="light"
  :decor="{ meaning: 'signal', tone: 'blue', color: 'var(--theme-color-blue-0)' }"
/>

<Slot
  role="media"
  surface="color"
  tone="blue"
  :decor="{ meaning: 'support', tone: 'blue', position: '106%', zoom: 0.95, color: 'var(--theme-color-light-0)' }"
/>

<Slot
  role="media"
  :decor="{ meaning: 'outdoor', tone: 'blue', position: '52% 42%', zoom: 1.05 }"
/>

---
layout: cover
variant: split-media-triptych
mode: light
tone: green
---

<Slot role="primary" surface="dark" margin="4" gap="4">
  <Text as="h1" size="7">Когда заголовку нужен запас воздуха</Text>
  <Text size="3" align="end" muted>
    Текст занимает левые две трети до восьмой колонки, а триптих справа остаётся как смысловая поддержка. Берите, когда главное — длинная формулировка.
  </Text>
</Slot>

<Slot
  role="media"
  surface="color"
  tone="green"
  :decor="{ meaning: 'cover', tone: 'green', zoom: 3.5, color: 'var(--theme-color-light-0)' }"
/>

<Slot
  role="media"
  :decor="{ meaning: 'campus', tone: 'green', position: '50% 50%' }"
/>

<Slot
  role="media"
  surface="dark"
  :decor="{ meaning: 'support', tone: 'green', zoom: 1.5, color: 'var(--theme-color-green-0)' }"
/>

---
layout: collection
variant: agenda
mode: color
tone: orange
decor:
  meaning: agenda
  tone: orange
---

# Архетипы слайдов

- Обложка — пять входов в раздел
- Поясняющий слайд — иерархия и опоры
- Сообщение — пауза, цитата, финал
- Коллекция — оглавление, таймлайн, метрики
- Большие факты — заголовок и три числа
- Ручная сетка — нестандартный коллаж

---
layout: collection
variant: agenda
mode: color
tone: blue
decor:
  meaning: agenda
  tone: blue
---

# Параметры слайда

- Фон — светлый, тёмный, цветной
- Пять акцентных цветов
- Поверхность слота — карточка внутри
- Поля и ритм внутри слота
- Декор — картинка под смысл
- Шапка — показать или спрятать

---
layout: explainer
variant: title-supports
preload: false
---

# Сначала задача, потом макет

- Слайд — это смысловой кадр: один тезис, одно сравнение или одна метрика.
- Архетип говорит, как этот кадр устроен: например, «заголовок и три аргумента».
- Шаблон даёт готовые архетипы и просит выбрать форму, прежде чем писать текст.

---
layout: explainer
variant: definition
label: '#Определение'
---

# Архетип слайда

именованная схема расположения слотов внутри лейаута, под которую заранее подобран ритм текста, отступов и поверхностей

---
layout: explainer
variant: title-supports
---

<!--
Контракт explainer:title-supports:
- 1× заголовок `# …`
- 3+ пункта `-` верхнего уровня (поддержки справа)
-->

# Заголовок и три коротких аргумента

- Самая рабочая лошадка: одна мысль слева и три аргумента справа.
- Поддержки приглушены, чтобы заголовок оставался главным.
- Берите для правил, чек-листов и кратких объяснений.

---
layout: explainer
variant: title-supports-bottom-muted
---

<!--
Контракт explainer:title-supports-bottom-muted:
- 1× заголовок `# …`
- ровно 2 пункта `-` верхнего уровня (нижний 50/50)
- без абзацев и без 3+ пунктов
-->

# Заголовок и две приглушённые опоры

- Контекст или ограничение: «учитывайте, что» или «работает, если».
- Уточнение или вывод: «поэтому» или «в итоге это даёт».

---
layout: explainer
variant: title-supports-bottom-plain
---

<!--
Контракт explainer:title-supports-bottom-plain:
- 1× заголовок `# …`
- ровно 2 пункта `-` верхнего уровня (без приглушения нижних опор)
-->

# Когда нужны два самостоятельных абзаца

- Этот вариант снимает приглушение с нижних опор. Каждый абзац читается как самостоятельный текст: его не воспринимают как «второстепенный к заголовку», а ставят рядом по весу.
  - авава
  - ава
  авава
- Берите слайд, когда тезис распадается на два независимых направления: например, «что включить» и «чего избегать», «теория» и «практика», «причина» и «следствие». Третий блок не нужен — два аргумента уже задают сильную смысловую пару.

---
layout: explainer
variant: title-body
---

# Когда нужен один развёрнутый текст

Этот вариант нужен, когда мысль не разбирается тремя короткими пунктами. Слева остаётся заголовок, справа можно положить несколько абзацев, список и при необходимости подытожить выводом.

- Сначала называйте контекст и почему он важен.
- Затем показывайте порядок рассуждения или ограничение.
- В конце оставляйте вывод, который готовит следующий слайд.

---
layout: message
variant: centered
mode: light
preload: false
---

<!--
Контракт message:centered:
- только 1× заголовок `# …`
- без абзацев, списков и blockquote в теле слайда
-->

# Поставьте паузу: оставьте на слайде один тезис

---
layout: message
variant: quote
mode: light
person:
  name: Константин Константинопольский
  title: наставник
  avatar: /theme/photos/photo-30.webp
  avatar-position: '62% 42%'
  avatar-zoom: 1.18
---

> Цитата работает, когда внешний голос усиливает тезис.

---
layout: collection
variant: agenda
mode: color
tone: green
decor:
  meaning: agenda
  tone: green
---

# Слайд-агенда

- Задаёт тему
- Ведёт по шагам
- До 7 пунктов

---
layout: collection
variant: timeline
items:
  - year: '2021'
    body: Самая первая версия шаблонов
  - year: '2024'
    body: Текущая графическая система
  - year: '2026'
    body: Slidev-шаблоны для использования с ИИ
    active: true
---

# Эволюция шаблона

Подсветка одной даты подсказывает, где мы сейчас, остальные годы остаются спокойным контекстом

---
layout: collection
variant: timeline
items:
  - year: 'март'
    body: Согласовать задачу курса
  - year: 'апрель'
    body: Собрать черновик модулей
  - year: 'май'
    body: Проверить темп на занятии
  - year: 'июнь'
    body: Подготовить повторное использование
---

# План подготовки курса

Когда подсветки нет, все шаги читаются как равноценные — это календарный маршрут, а не «мы здесь»

---
layout: collection
variant: points
arrangement: trio
tone: green
preload: false
decor:
  meaning: rules
  tone: green
  fit: contain
  position: right top
  anchor: right top
  x: 20%
  y: 20%
  zoom: 2.6
---

# Зелёный тон: подтверждение

1. Показывайте готовность, прогресс или безопасный статус
2. Держите формулировки спокойными
3. Не используйте зелёный для тревожных сообщений

---
layout: collection
variant: points
arrangement: trio
tone: blue
decor:
  meaning: rules
  tone: blue
  fit: contain
  position: right top
  anchor: right top
  x: 20%
  y: 20%
  zoom: 2.6
---

# Синий тон: рабочий процесс

1. Объясняйте маршруты, инструкции и нейтральные состояния
2. Помогайте сравнивать варианты без давления
3. Сохраняйте цвет как фон для чтения

---
layout: collection
variant: points
arrangement: trio
tone: orange
decor:
  meaning: rules
  tone: orange
  fit: contain
  position: right top
  anchor: right top
  x: 20%
  y: 20%
  zoom: 2.6
---

# Оранжевый тон: акцент

1. Выносите важный поворот или предупреждение
2. Не окрашивайте им весь ряд одинаковых фактов
3. Оставляйте рядом достаточно воздуха

---
layout: collection
variant: metrics
arrangement: featured-media
decor:
  id: decor-rules-wide-01
  opacity: 0.85
media:
  src: /theme/photos/photo-5.webp
  fit: cover
  position: '48% 44%'
  zoom: 1.08
metrics:
  - value: '64%'
    body: главная метрика читается крупно как вывод
    featured: true
  - value: '18'
    body: вторая метрика даёт масштаб
  - value: '5'
    body: третья метрика подтверждает охват
---

---
layout: collection
variant: metrics
arrangement: featured-copy
media:
  src: /theme/photos/photo-5.webp
  fit: cover
  position: '48% 44%'
  zoom: 1.08
metrics:
  - value: '60%'
    body: главное число живёт во всю ширину карточки
    featured: true
  - value: '24%'
    body: контекст уходит вниз
  - value: '16%'
    body: деталь занимает минимум места
---

---
layout: collection
variant: metrics
arrangement: featured-copy-split-media
media:
  - src: /theme/photos/photo-5.webp
    fit: cover
    position: '48% 44%'
    zoom: 1.08
  - src: /theme/photos/photo-6.webp
    fit: cover
    position: '50% 40%'
    zoom: 1.04
---

- ×2
  - две фотографии бок о бок усиливают «до и после»
- 18
  - минут до подсказок
- 9
  - минут после подсказок

---
layout: collection
variant: facts-stacked
mode: dark
---

<!--
Контракт collection:facts-stacked:
- 1× заголовок `# …`
- опционально 1 абзац между заголовком и списком
- ровно 3 факта: у каждого `- значение` и вложенный `  - подпись`
- не используйте `- роль: текст` в одной строке
-->

# Три факта как вертикальная опора

Когда нужно отступить от равных карточек, этот архетип собирает заголовок и три факта без ручных координат.

- 33%
  - отдано каждому из чисел
- 4
  - уровня иерархии размеров текста
- иногда
  - факты могут быть короткими словами

---
layout: collection
variant: facts-duo
mode: light
tone: blue
---

<!--
Контракт collection:facts-duo:
- 1× заголовок `# …`, опционально абзац до списка
- ровно 2 факта с вложенной подписью (`  - …`)
-->

# Два факта как развилка выбора

Берите этот вариант, когда нужно поставить рядом два равных результата без ручной сетки.

- быстрее
  - сокращает ожидание обратной связи
- надёжнее
  - оставляет проверяемый след решения

---
layout: collection
variant: facts-trio
mode: light
tone: blue
---

<!--
Контракт collection:facts-trio:
- 1× заголовок `# …`, опционально абзац до списка
- ровно 3 факта с вложенной подписью
-->

# Заголовок поддержанный тремя одноранговыми фактами

Берите этот вариант, когда тезис подкрепляется тремя сопоставимыми числами и важна равная значимость

- 33%
  - отдано каждому из чисел
- 4
  - уровня иерархии размеров текста
- иногда
  - факты могут быть короткими словами

---
layout: collection
variant: facts-quartet
mode: light
tone: blue
---

<!--
Контракт collection:facts-quartet:
- 1× заголовок `# …`, опционально абзац до списка
- ровно 4 факта с вложенной подписью
-->

# Четыре факта в одной нижней полосе

Берите этот вариант, когда тезис держится на четырёх коротких, сопоставимых опорах.

- X
  - повторяемая операция
- Y
  - проверяемый артефакт
- Z
  - критерий качества
- W
  - условие остановки

---
layout: collection
variant: facts-featured
mode: light
tone: blue
---

# Главное число и две поддержки

Когда один факт несёт основную нагрузку, отдайте ему половину слайда — мелкие подтверждения уйдут к правому краю

- 50%
  - отдано главному числу
- 25%
  - каждому вспомогательному факту, возможно с более длинным описанием
- 2
  - вспомогательных факта

---
layout: explainer
variant: title-supports
mode: light
---

# Один текстовый слайд держит один вывод

- Заголовок формулирует мысль, которую зритель должен унести.
- Поддерживающий текст раскрывает только эту мысль, без второй темы внутри.
- Цвета и декор объясняйте на слайдах, где они действительно видны.

---
layout: none
mode: light
header: default
preload: false
---

<Slot area="2 / 1 / 6 / -1" gap="2">
  <Text size="6">Акцентный цвет — пять настроений</Text>
  <Text size="3" muted>
    Цвета фона и акцента работают **независимо**: можно держать графитовый фон с синими акцентами или красить весь слайд в выбранный цвет.
  </Text>
</Slot>

<Slot area="6 / 1 / 9 / 5" surface="color" tone="blue" margin="3">
  <Text size="4">1</Text>
  <Text size="4" align="end">синий</Text>
</Slot>

<Slot area="6 / 5 / 9 / 9" surface="color" tone="orange" margin="3">
  <Text size="4">2</Text>
  <Text size="4" align="end">оранжевый</Text>
</Slot>

<Slot area="6 / 9 / 9 / -1" surface="color" tone="green" margin="3">
  <Text size="4">3</Text>
  <Text size="4" align="end">зелёный</Text>
</Slot>

<Slot area="9 / 1 / -1 / 7" surface="color" tone="red" margin="3">
  <Text size="4">4</Text>
  <Text size="4" align="end">красный</Text>
</Slot>

<Slot area="9 / 7 / -1 / -1" surface="color" tone="yellow" margin="3">
  <Text size="4">5</Text>
  <Text size="4" align="end">жёлтый</Text>
</Slot>

---
layout: none
mode: light
header: default
---

<Slot area="2 / 1 / 6 / 7" surface="light" margin="4" gap="2">
  <Text size="5">Светлая поверхность</Text>
  <Text size="3">Нейтральная карточка: на тёмном слайде или в составной композиции держит спокойный тон.</Text>
</Slot>

<Slot area="2 / 7 / 6 / -1" surface="dark" margin="4" gap="2">
  <Text size="5">Тёмная поверхность</Text>
  <Text size="3" muted>Добавляет вес и держит контраст внутри светлого слайда.</Text>
</Slot>

<Slot area="6 / 1 / -1 / 7" surface="color" tone="orange" margin="4" gap="2">
  <Text size="5">Цветная поверхность</Text>
  <Text size="3">Слот целиком красится в текущий акцентный цвет — для смыслового выделения.</Text>
</Slot>

<Slot area="6 / 7 / -1 / -1" surface="tint" tone="blue" margin="4" gap="2">
  <Text size="5">Приглушённый оттенок</Text>
  <Text size="3">Бледная подложка под цвет акцента: читается как намёк, а не как акцент.</Text>
</Slot>

---
layout: explainer
variant: title-body
---

# Текстовый блок объясняет один контракт

Если слайд построен только на тексте, весь правый блок должен разбирать одну форму: что автор пишет в исходнике, как это читается и где заканчивается паттерн.

- Заголовок называет форму.
- Абзац раскрывает критерий выбора.
- Список фиксирует правила, а не новую тему.

---
layout: none
mode: light
header: default
---

<Slot area="2 / 1 / 5 / -1" gap="2">
  <Text size="6">Один и тот же цвет, разный смысл</Text>
  <Text size="3" muted>
    Размер и тон у слотов одинаковые, а смысл — разный. Каталог достаёт из своих веток разные картинки и слоты получают совсем непохожие изображения.
  </Text>
</Slot>

<Slot
  area="5 / 1 / 11 / 7"
  surface="light"
  :decor="{ meaning: 'workspace', tone: 'blue' }"
/>

<Slot
  area="5 / 7 / 11 / -1"
  surface="light"
  :decor="{ meaning: 'home', tone: 'blue' }"
/>

<Slot area="11 / 1 / -1 / 7" margin-top="2">
  <Text size="3" muted>смысл: рабочее место</Text>
</Slot>

<Slot area="11 / 7 / -1 / -1" margin-top="2">
  <Text size="3" muted>смысл: дом</Text>
</Slot>

---
layout: none
mode: light
header: default
---

<Slot area="2 / 1 / 5 / -1" gap="2">
  <Text size="6">Один смысл, разные настроения цвета</Text>
  <Text size="3" muted>
    Все три слота просят картинку «поддержка», а различается только цвет настроения. Каталог уводит в разные ветки: меняется и сам кадр, и его акцент.
  </Text>
</Slot>

<Slot
  area="5 / 1 / 11 / 5"
  surface="tint"
  tone="blue"
  :decor="{ meaning: 'support', tone: 'blue', color: 'var(--theme-color-blue-0)', opacity: 0.72 }"
/>

<Slot
  area="5 / 5 / 11 / 9"
  surface="tint"
  tone="orange"
  :decor="{ meaning: 'support', tone: 'orange', opacity: 0.9 }"
/>

<Slot
  area="5 / 9 / 11 / -1"
  surface="tint"
  tone="green"
  :decor="{ meaning: 'support', tone: 'green', color: 'var(--theme-color-green-0)', opacity: 0.72 }"
/>

<Slot area="11 / 1 / -1 / 5" margin-top="2">
  <Text size="3" muted>цвет: синий</Text>
</Slot>

<Slot area="11 / 5 / -1 / 9" margin-top="2">
  <Text size="3" muted>цвет: оранжевый</Text>
</Slot>

<Slot area="11 / 9 / -1 / -1" margin-top="2">
  <Text size="3" muted>цвет: зелёный</Text>
</Slot>

---
layout: explainer
variant: title-supports
---

# Когда нужен предсказуемый результат

- Закрепите конкретную картинку — и слайд всегда получит её, без сюрпризов от автоподбора.
- Свои картинки регистрируйте в каталоге темы: у каждой записи указан смысл и подходящие цвета.
- Если важно настроение, а не точный кадр — оставляйте автоподбор, он именно под это и сделан.

---
layout: explainer
variant: title-body
---

# Когда нужна ручная сетка

Если задача не укладывается ни в один типовой архетип, переходите на ручную сетку. Слайд даёт вам чистые 12 колонок и шапку, а решения о расположении вы принимаете сами.

- Каждому слоту дайте координаты в сетке — четыре числа от строки и колонки до их пары.
- В ручной сетке нет ролей — слоты различаются только координатами.
- Поверхности, поля и декор у слотов работают точно так же, как в готовых архетипах.

---
layout: none
mode: light
header: default
---

<Slot area="1 / 1 / 7 / 7" surface="light" margin="4">
  <Text size="6-7">Нестандартный коллаж</Text>
</Slot>

<Slot area="1 / 7 / 7 / -1" surface="light" margin="4">
  <Text size="5">Когда типовой слайд не выдерживает смысловую задачу, собирайте композицию из слотов вручную</Text>
</Slot>

<Slot area="7 / 1 / -1 / 7" surface="light" margin="4">
  <Text size="2-3">
    Текст, цвет и декоративное фото держат один визуальный тон. Главное — не смешивать архетипы внутри одного слайда.
  </Text>
</Slot>

<Slot area="7 / 7 / -1 / 10" surface="light">
  <Image src="/theme/photos/photo-5.webp" fit="cover" position="52% 40%" zoom="1.08" />
</Slot>

<Slot area="7 / 10 / -1 / -1" surface="color" tone="blue" margin="3" gap="2">
  <Text size="4-7">Связка</Text>
  <Text size="2-6" priority="2" muted>между текстом, цветом и декором</Text>
</Slot>

---
layout: message
variant: closing
mode: dark
tone: blue
logo: full
preload: false
---

<!--
Контракт message:closing:
- обязательно 1× заголовок `# …`
- можно добавить не более 1× абзаца под заголовком
-->

# Делайте меньше, но точнее…

---
layout: message
variant: closing
mode: dark
tone: blue
logo: full
preload: false
---

<!--
Контракт message:closing:
- обязательно 1× заголовок `# …`
- можно добавить не более 1× абзаца под заголовком
-->

# Делайте меньше, но точнее…

Оставьте только то, что ведёт к следующему действию
