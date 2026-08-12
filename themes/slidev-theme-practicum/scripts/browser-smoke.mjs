import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chromium } from 'playwright-chromium'
import {
  classifyBrowserConsoleMessage,
  createInFlightRequestTracker,
  createStaticDistServer,
  isSameOriginUrl,
} from './browser-smoke-runtime.mjs'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const DIST_DIR = resolve(PROJECT_ROOT, 'dist')
const REPRESENTATIVE_SLIDES = [1, 9, 15, 20, 32, 40, 41]
const VISUAL_ONLY_SLIDES = [17, 18]
const LIFECYCLE_EVENT = 'practicum:slide-lifecycle'
const LIFECYCLE_STATE_KEY = '__practicumBrowserLifecycle'
const THEME_MEDIA = [
  {
    label: 'декор',
    path: '/theme/decor/decor-1.svg',
  },
  {
    label: 'фотография',
    path: '/theme/photos/photo-1.webp',
  },
]

function formatDiagnostic(diagnostic) {
  return typeof diagnostic === 'string'
    ? diagnostic
    : JSON.stringify(diagnostic)
}

function assertNoDiagnostics(label, diagnostics) {
  assert.equal(
    diagnostics.length,
    0,
    `${label}:\n${diagnostics.map(formatDiagnostic).join('\n')}`,
  )
}

async function settleSlide(page) {
  await page.evaluate(async () => {
    await Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise(resolveTimeout => setTimeout(resolveTimeout, 3_000)),
    ])
    await new Promise((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
    })
  })
}

async function readLifecycleSnapshot(page) {
  return page.evaluate((stateKey) => {
    const state = window[stateKey]

    return {
      active: structuredClone(state?.active ?? {}),
      cleanedTokens: structuredClone(state?.cleanedTokens ?? {}),
      mounts: structuredClone(state?.mounts ?? {}),
      unmounts: structuredClone(state?.unmounts ?? {}),
    }
  }, LIFECYCLE_STATE_KEY)
}

function countFor(snapshot, collection, slideNumber) {
  return snapshot[collection][String(slideNumber)] ?? 0
}

function assertLifecycleTransition(before, after, slideNumber, previousSlideNumber) {
  const slideKey = String(slideNumber)
  assert.ok(
    countFor(after, 'mounts', slideNumber) > countFor(before, 'mounts', slideNumber),
    `слайд ${slideNumber}: компонент не смонтировался при переходе; `
    + `состояние=${JSON.stringify(after)}`,
  )
  assert.ok(
    (after.active[slideKey]?.length ?? 0) > 0,
    `слайд ${slideNumber}: после перехода нет активного маркера жизненного цикла`,
  )

  if (previousSlideNumber === undefined)
    return

  const previousKey = String(previousSlideNumber)
  const previousTokens = before.active[previousKey] ?? []
  assert.ok(
    previousTokens.length > 0,
    `слайд ${previousSlideNumber}: до перехода нет активного маркера жизненного цикла`,
  )
  assert.ok(
    countFor(after, 'unmounts', previousSlideNumber)
    > countFor(before, 'unmounts', previousSlideNumber),
    `слайд ${previousSlideNumber}: компонент не демонтировался при переходе; `
    + `до=${JSON.stringify(before)}, после=${JSON.stringify(after)}`,
  )
  assert.equal(
    after.active[previousKey]?.length ?? 0,
    0,
    `слайд ${previousSlideNumber}: маркер жизненного цикла остался активным после перехода`,
  )

  for (const token of previousTokens) {
    assert.equal(
      after.cleanedTokens[token],
      true,
      `слайд ${previousSlideNumber}: маркер очистки ${token} не установлен`,
    )
  }
}

async function assertStrongEmphasis(slide, slideNumber) {
  const strong = slide.locator('strong')
  const strongCount = await strong.count()

  assert.equal(
    strongCount,
    1,
    `слайд ${slideNumber}: ожидается один семантический strong, найдено ${strongCount}`,
  )
  assert.equal(
    await strong.evaluate(element => getComputedStyle(element).fontWeight),
    '600',
    `слайд ${slideNumber}: strong должен использовать YS Text Bold с весом 600`,
  )
}

async function assertClosingLayout(slide, slideNumber, expectedTextCount) {
  const grid = slide.locator('.Slide-Grid')
  const primary = grid.locator(':scope > .Slot').first()
  const [gridBox, primaryBox, placement, textCount] = await Promise.all([
    grid.boundingBox(),
    primary.boundingBox(),
    primary.evaluate((element) => {
      const style = getComputedStyle(element)

      return {
        columnEnd: style.gridColumnEnd,
        columnStart: style.gridColumnStart,
        rowEnd: style.gridRowEnd,
        rowStart: style.gridRowStart,
      }
    }),
    primary.locator(':scope > .Slot-Content > .Text').count(),
  ])

  assert.deepEqual(placement, {
    columnEnd: '12',
    columnStart: '2',
    rowEnd: '13',
    rowStart: '1',
  }, `слайд ${slideNumber}: primary использует неверную область сетки`)
  assert.ok(gridBox, `слайд ${slideNumber}: не найдена геометрия Slide-Grid`)
  assert.ok(primaryBox, `слайд ${slideNumber}: не найдена геометрия primary`)
  assert.ok(
    Math.abs(primaryBox.y - gridBox.y) <= 1,
    `слайд ${slideNumber}: primary не начинается с первой строки`,
  )
  assert.ok(
    Math.abs(primaryBox.y + primaryBox.height - gridBox.y - gridBox.height) <= 1,
    `слайд ${slideNumber}: primary не заканчивается на последней строке`,
  )
  assert.equal(
    textCount,
    expectedTextCount,
    `слайд ${slideNumber}: неожиданное количество текстовых элементов`,
  )
}

async function inspectSlide(
  page,
  origin,
  slideNumber,
  previousSlideNumber,
  waitForNetworkIdle,
) {
  const hashTarget = `${origin}/#/${slideNumber}`
  const beforeLifecycle = previousSlideNumber === undefined
    ? { active: {}, cleanedTokens: {}, mounts: {}, unmounts: {} }
    : await readLifecycleSnapshot(page)

  if (previousSlideNumber === undefined) {
    await page.goto(hashTarget, { waitUntil: 'domcontentloaded' })
  }
  else {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, `#/${slideNumber}`)
  }

  await page.waitForFunction(
    expectedHash => window.location.hash === expectedHash,
    `#/${slideNumber}`,
  )

  const slide = page.locator(`.slidev-page[data-slidev-no="${slideNumber}"]`)
  await slide.waitFor({ state: 'visible' })
  if (previousSlideNumber !== undefined) {
    await page
      .locator(`.slidev-page[data-slidev-no="${previousSlideNumber}"]`)
      .waitFor({ state: 'hidden' })
  }
  await settleSlide(page)
  await waitForNetworkIdle()

  const [result, afterLifecycle] = await Promise.all([
    slide.evaluate(element => ({
      heightOverflow: element.scrollHeight - element.clientHeight,
      text: element.textContent?.trim() ?? '',
      widthOverflow: element.scrollWidth - element.clientWidth,
    })),
    readLifecycleSnapshot(page),
  ])

  assert.ok(result.text.length > 0, `слайд ${slideNumber}: отсутствует текст`)
  assert.ok(
    result.widthOverflow <= 1,
    `слайд ${slideNumber}: горизонтальное переполнение ${result.widthOverflow}px`,
  )
  assert.ok(
    result.heightOverflow <= 1,
    `слайд ${slideNumber}: вертикальное переполнение ${result.heightOverflow}px`,
  )
  if (slideNumber === 32)
    await assertStrongEmphasis(slide, slideNumber)
  if (slideNumber === 40)
    await assertClosingLayout(slide, slideNumber, 1)
  if (slideNumber === 41)
    await assertClosingLayout(slide, slideNumber, 2)
  assertLifecycleTransition(
    beforeLifecycle,
    afterLifecycle,
    slideNumber,
    previousSlideNumber,
  )
}

async function loadThemeImage(page, origin, asset) {
  const url = `${origin}${asset.path}?browser-smoke=${encodeURIComponent(asset.label)}`
  const responsePromise = page.waitForResponse(response => response.url() === url)
  const imagePromise = page.evaluate(async (imageUrl) => {
    const image = new Image()
    image.src = imageUrl
    await image.decode()

    return {
      height: image.naturalHeight,
      width: image.naturalWidth,
    }
  }, url)

  const [response, dimensions] = await Promise.all([responsePromise, imagePromise])
  assert.equal(response.status(), 200, `${asset.label}: HTTP ${response.status()}`)
  assert.ok(dimensions.width > 0, `${asset.label}: изображение имеет нулевую ширину`)
  assert.ok(dimensions.height > 0, `${asset.label}: изображение имеет нулевую высоту`)
}

async function closeResources(browser, server) {
  const cleanupErrors = []

  if (browser) {
    try {
      await browser.close()
    }
    catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (server) {
    try {
      await server.close()
    }
    catch (error) {
      cleanupErrors.push(error)
    }
  }

  return cleanupErrors
}

export async function runBrowserSmoke() {
  let activeSlide = 'инициализация'
  let browser
  let inFlightTracker
  let server
  let runError
  const consoleErrors = []
  const failedRequests = []
  const failedResponses = []
  const pageErrors = []

  try {
    server = await createStaticDistServer(DIST_DIR)
    browser = await chromium.launch()
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: {
        height: 720,
        width: 1280,
      },
    })
    await context.addInitScript(({ eventName, stateKey }) => {
      const state = {
        active: {},
        cleanedTokens: {},
        mounts: {},
        unmounts: {},
      }
      window[stateKey] = state
      window.addEventListener(eventName, (event) => {
        const detail = event.detail ?? {}
        const phase = detail.phase
        const slide = String(detail.slide ?? '')
        const token = String(detail.token ?? '')

        if (!slide || !token || (phase !== 'mounted' && phase !== 'unmounted'))
          return

        state.active[slide] ??= []
        if (phase === 'mounted') {
          state.mounts[slide] = (state.mounts[slide] ?? 0) + 1
          if (!state.active[slide].includes(token))
            state.active[slide].push(token)
          return
        }

        state.unmounts[slide] = (state.unmounts[slide] ?? 0) + 1
        state.active[slide] = state.active[slide].filter(activeToken => activeToken !== token)
        state.cleanedTokens[token] = true
      })
    }, {
      eventName: LIFECYCLE_EVENT,
      stateKey: LIFECYCLE_STATE_KEY,
    })
    await context.grantPermissions(['screen-wake-lock'], { origin: server.origin })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    inFlightTracker = createInFlightRequestTracker({
      origin: server.origin,
    })

    page.on('pageerror', (error) => {
      pageErrors.push(`[${activeSlide}] ${error.stack || String(error)}`)
    })
    page.on('console', (message) => {
      const classification = classifyBrowserConsoleMessage(message.type(), message.text())
      if (classification === 'rejected') {
        consoleErrors.push({
          location: message.location(),
          slide: activeSlide,
          text: message.text(),
        })
      }
    })
    page.on('request', request => inFlightTracker.requestStarted(request))
    page.on('requestfinished', request => inFlightTracker.requestSettled(request))
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push({
          method: response.request().method(),
          slide: activeSlide,
          status: response.status(),
          url: response.url(),
        })
      }
    })
    page.on('requestfailed', (request) => {
      inFlightTracker.requestSettled(request)
      if (isSameOriginUrl(server.origin, request.url())) {
        failedRequests.push({
          error: request.failure()?.errorText ?? 'неизвестная ошибка',
          method: request.method(),
          slide: activeSlide,
          url: request.url(),
        })
      }
    })

    for (const [index, slideNumber] of REPRESENTATIVE_SLIDES.entries()) {
      activeSlide = `слайд ${slideNumber}`
      await inspectSlide(
        page,
        server.origin,
        slideNumber,
        REPRESENTATIVE_SLIDES[index - 1],
        () => inFlightTracker.waitForIdle(),
      )
    }

    for (const slideNumber of VISUAL_ONLY_SLIDES) {
      activeSlide = `слайд ${slideNumber}`
      await inspectSlide(
        page,
        server.origin,
        slideNumber,
        undefined,
        () => inFlightTracker.waitForIdle(),
      )
    }

    for (const asset of THEME_MEDIA) {
      activeSlide = `медиа: ${asset.label}`
      await loadThemeImage(page, server.origin, asset)
      await inFlightTracker.waitForIdle()
    }

    await inFlightTracker.waitForIdle()
    assertNoDiagnostics('ошибки страницы', pageErrors)
    assertNoDiagnostics('ошибки консоли', consoleErrors)
    assertNoDiagnostics('ответы HTTP со статусом >= 400', failedResponses)
    assertNoDiagnostics('неуспешные запросы того же источника', failedRequests)

    console.log(
      `Браузерная проверка: слайды=${REPRESENTATIVE_SLIDES.length + VISUAL_ONLY_SLIDES.length}, `
      + `ошибкиСтраницы=${pageErrors.length}, ошибкиКонсоли=${consoleErrors.length}, `
      + `ошибочныеОтветы=${failedResponses.length}, активныеЗапросы=${inFlightTracker.size}, `
      + `переполнение=0, медиа=${THEME_MEDIA.length}, переходыЖЦ=${REPRESENTATIVE_SLIDES.length - 1}`,
    )
  }
  catch (error) {
    runError = error
  }

  inFlightTracker?.dispose()
  const cleanupErrors = await closeResources(browser, server)
  if (runError && cleanupErrors.length > 0)
    throw new AggregateError([runError, ...cleanupErrors], 'Браузерная проверка и очистка завершились с ошибками')
  if (runError)
    throw runError
  if (cleanupErrors.length > 0)
    throw new AggregateError(cleanupErrors, 'Очистка браузерной проверки завершилась с ошибками')
}

await runBrowserSmoke()
