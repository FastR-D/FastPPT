import { extractColorMap, resolveColorMap } from './color-mapping.js'
export { readPptxRuleEvidence } from './rule-evidence.js'
export type { PptxRuleSlideEvidence } from './rule-evidence.js'
import { extractTheme, extractThemeOverride } from './theme.js'
import {
  extractBackground,
  resolveBackground,
  resolveBackgroundAppearance,
} from './backgrounds.js'
import {
  resolvePlaceholderChain,
  resolvePlaceholderGeometry,
} from './inheritance.js'
import { extractObjects, extractPartTextStyles } from './objects.js'
import { resolveObjectText } from './text-inheritance.js'
import { resolveObjectGeometry } from './geometry.js'
import { extractNotesText } from './notes.js'
import { resolveSourceColor, resolveThemeColors } from './color-resolution.js'
import { mergeThemeDefinition } from './color-resolution.js'
import {
  relationships,
  relationshipPart,
  tags,
  DRAWING_NS,
} from './relationships.js'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import {
  ImportAnalysisV1Schema,
  type ImportAnalysisV1,
} from '@fastppt/presentation-ir'

function values(xml: string, tag: string, attribute: string): string[] {
  return tags(xml, tag, DRAWING_NS)
    .map((entry) => entry[attribute]?.trim())
    .filter((value): value is string => Boolean(value))
}

export async function analyzePptx(
  input: Uint8Array,
): Promise<ImportAnalysisV1> {
  const sourceHash = createHash('sha256').update(input).digest('hex')
  const zip = await JSZip.loadAsync(input)
  const read = async (name: string): Promise<string> =>
    zip.file(name) ? zip.file(name)!.async('text') : ''
  const diagnostics: string[] = []
  const rootRelations = relationships(await read('_rels/.rels'), '')
  const roots = rootRelations.filter(
    (entry) => entry.type === 'officeDocument' && !entry.external,
  )
  if (roots.length > 1) throw new Error('Ambiguous presentation package root')
  const presentationPart = roots[0]?.target ?? 'ppt/presentation.xml'
  if (!roots.length)
    diagnostics.push(
      'Missing officeDocument package relationship; conventional presentation path used as recovery.',
    )
  if (!zip.file(presentationPart))
    throw new Error(`Missing presentation part: ${presentationPart}`)
  const presentation = await read(presentationPart)
  const presentationRels = relationships(
    await read(relationshipPart(presentationPart)),
    presentationPart,
  )
  const sizes = tags(presentation, 'sldSz')
  if (sizes.length > 1)
    throw new Error('Multiple presentation canvas definitions')
  const size = sizes[0]
  const canvas = size
    ? {
        widthEmu: Number(size.cx),
        heightEmu: Number(size.cy),
        part: presentationPart,
        provenance: 'extracted',
      }
    : undefined
  if (
    canvas &&
    ![canvas.widthEmu, canvas.heightEmu].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error('Invalid presentation canvas dimensions')
  if (!canvas)
    diagnostics.push(
      'Presentation canvas dimensions are absent; generated candidates may use a default canvas.',
    )
  const slideIds = tags(presentation, 'sldId')
  const slides = slideIds.map((entry) => {
    const id = entry['r:id']
    const relation = presentationRels.find(
      (item) => item.id === id && item.type === 'slide' && !item.external,
    )
    if (!relation || !zip.file(relation.target))
      throw new Error(`Missing slide relationship or part: ${id ?? 'unknown'}`)
    return relation.target
  })
  if (!slides.length)
    diagnostics.push(
      'Presentation page order is unavailable; orphan slide files are not treated as ordered pages.',
    )
  const linkedPart = async (
    source: string,
    type: string,
    required = true,
  ): Promise<string | undefined> => {
    const candidates = relationships(
      await read(relationshipPart(source)),
      source,
    ).filter((item) => item.type === type && !item.external)
    if (candidates.length > 1)
      throw new Error(`Ambiguous ${type} relationship in ${source}`)
    const target = candidates[0]?.target
    if (target && !zip.file(target))
      throw new Error(`Missing related part: ${target}`)
    if (!target && required)
      diagnostics.push(`Missing ${type} relationship in ${source}`)
    return target
  }
  const slideRelationships = await Promise.all(
    slides.map(async (part, index) => {
      const notes = await linkedPart(part, 'notesSlide', false)
      const layout = await linkedPart(part, 'slideLayout')
      const master = layout
        ? await linkedPart(layout, 'slideMaster')
        : undefined
      const theme = master ? await linkedPart(master, 'theme') : undefined
      return {
        index: index + 1,
        part,
        layout,
        master,
        theme,
        ...(notes ? { notes } : {}),
        provenance: 'extracted',
      }
    }),
  )
  const registeredMasters = tags(presentation, 'sldMasterId').map((entry) => {
    const relation = presentationRels.find(
      (item) =>
        item.id === entry['r:id'] &&
        item.type === 'slideMaster' &&
        !item.external,
    )
    if (!relation || !zip.file(relation.target))
      throw new Error(
        `Missing registered master: ${entry['r:id'] ?? 'unknown'}`,
      )
    return relation.target
  })
  const masters = [
    ...new Set([
      ...registeredMasters,
      ...slideRelationships
        .map((slide) => slide.master)
        .filter((part): part is string => Boolean(part)),
    ]),
  ]
  const registeredLayouts = await Promise.all(
    masters.map(async (master) => {
      const relations = relationships(
        await read(relationshipPart(master)),
        master,
      )
      return tags(await read(master), 'sldLayoutId').map((entry) => {
        const relation = relations.find(
          (item) =>
            item.id === entry['r:id'] &&
            item.type === 'slideLayout' &&
            !item.external,
        )
        if (!relation || !zip.file(relation.target))
          throw new Error(`Missing registered layout in ${master}`)
        return relation.target
      })
    }),
  )
  const layouts = [
    ...new Set([
      ...registeredLayouts.flat(),
      ...slideRelationships
        .map((slide) => slide.layout)
        .filter((part): part is string => Boolean(part)),
    ]),
  ]
  const masterRelationships = await Promise.all(
    masters.map(async (part, index) => ({
      part,
      layouts: registeredLayouts[index] ?? [],
      theme: await linkedPart(part, 'theme'),
      provenance: 'extracted',
    })),
  )
  const themeParts = [
    ...new Set(
      masterRelationships
        .map((master) => master.theme)
        .filter((part): part is string => Boolean(part)),
    ),
  ]
  const themes = await Promise.all(themeParts.map(read))
  const themeDefinitions = themes.map((xml, index) =>
    extractTheme(xml, themeParts[index]!),
  )
  const noteParts = [
    ...new Set(
      slideRelationships
        .map((slide) => slide.notes)
        .filter((part): part is string => Boolean(part)),
    ),
  ]
  const notes = noteParts.length
  const noteTexts = await Promise.all(
    noteParts.map(async (part) => extractNotesText(await read(part), part)),
  )
  const animations = (await Promise.all(slides.map(read))).some(
    (xml) => tags(xml, 'timing').length > 0,
  )
  const colors = [
    ...new Set(themes.flatMap((theme) => values(theme, 'srgbClr', 'val'))),
  ]
  const fonts = [
    ...new Set(
      themes.flatMap((theme) => [
        ...values(theme, 'latin', 'typeface'),
        ...values(theme, 'ea', 'typeface'),
      ]),
    ),
  ]
  const objectParts = [...new Set([...masters, ...layouts, ...slides])]
  type ExtractedThemeOverride = ReturnType<typeof extractTheme> & {
    overridePart: string
  }
  const themeOverrides = (
    await Promise.all(
      objectParts.map(async (part) => {
        const sourceXml = await read(part)
        const embedded = extractThemeOverride(sourceXml, part)
        if (embedded) return { part, theme: { ...embedded, part } }
        const overrideRelations = relationships(
          await read(relationshipPart(part)),
          part,
        ).filter(
          (relation) => relation.type === 'themeOverride' && !relation.external,
        )
        if (overrideRelations.length > 1)
          throw new Error(`Ambiguous theme override relationship in ${part}`)
        const target = overrideRelations[0]?.target
        if (!target || !zip.file(target)) return undefined
        const override = extractThemeOverride(await read(target), target)
        return override
          ? { part, theme: { ...override, part: target } }
          : undefined
      }),
    )
  ).filter(
    (override): override is { part: string; theme: ExtractedThemeOverride } =>
      override !== undefined,
  )
  const overrideFor = (parts: Array<string | undefined>) => {
    const part = parts.find(
      (candidate) =>
        candidate &&
        themeOverrides.some((override) => override.part === candidate),
    )
    return part
      ? themeOverrides.find((override) => override.part === part)?.theme
      : undefined
  }
  const localColorMaps = (
    await Promise.all(
      objectParts.map(async (part) => extractColorMap(await read(part), part)),
    )
  ).filter((map) => map !== undefined)
  const resolvedColorMaps = slideRelationships.map((slide) =>
    resolveColorMap(slide.part, localColorMaps, slide.layout, slide.master),
  )
  const resolvedThemeColors = themeDefinitions.map((theme) =>
    resolveThemeColors(theme),
  )
  const resolvedSlideThemeColors = slideRelationships.map((slide, index) => {
    const theme = themeDefinitions.find(
      (definition) => definition.part === slide.theme,
    )
    if (!theme) {
      return {
        part: slide.part,
        status: 'unspecified' as const,
        provenance: 'derived' as const,
      }
    }
    const colorMap = resolvedColorMaps[index]?.mapping ?? {}
    const effectiveTheme = mergeThemeDefinition(
      theme,
      overrideFor([slide.part, slide.layout, slide.master]),
    )
    const resolved = resolveThemeColors(effectiveTheme, colorMap)
    return {
      part: slide.part,
      themePart: theme.part,
      ...(effectiveTheme !== theme
        ? {
            themeOverridePart: overrideFor([
              slide.part,
              slide.layout,
              slide.master,
            ])?.part,
          }
        : {}),
      colors: resolved.colors,
      unresolved: resolved.unresolved,
      ...(resolved.colorMap ? { colorMap: resolved.colorMap } : {}),
      status: 'resolved' as const,
      provenance: 'derived' as const,
    }
  })
  const localBackgrounds = (
    await Promise.all(
      objectParts.map(async (part) =>
        extractBackground(await read(part), part),
      ),
    )
  ).filter((background) => background !== undefined)
  const resolvedBackgrounds = slideRelationships.map((slide) =>
    resolveBackground(slide.part, localBackgrounds, slide.layout, slide.master),
  )
  const resolvedBackgroundAppearances = slideRelationships.map(
    (slide, index) => {
      const theme = themeDefinitions.find(
        (definition) => definition.part === slide.theme,
      )
      const effectiveTheme = theme
        ? mergeThemeDefinition(
            theme,
            overrideFor([slide.part, slide.layout, slide.master]),
          )
        : undefined
      return resolveBackgroundAppearance(
        slide.part,
        localBackgrounds,
        effectiveTheme,
        resolvedColorMaps[index]?.mapping ?? {},
        slide.layout,
        slide.master,
      )
    },
  )
  const sourceObjects = await Promise.all(
    objectParts.map(async (part) => ({
      part,
      objects: extractObjects(await read(part), part),
    })),
  )
  const imageResources = (
    await Promise.all(
      sourceObjects.map(async ({ part, objects }) => {
        const relations = relationships(
          await read(relationshipPart(part)),
          part,
        )
        return objects.flatMap((object) =>
          (object.image?.references ?? []).map((reference) => {
            const relation = relations.find(
              (item) =>
                item.id === reference.relationshipId && item.type === 'image',
            )
            const available = Boolean(
              relation && !relation.external && zip.file(relation.target),
            )
            if (relation?.external)
              diagnostics.push(
                `External image resource is unverified: ${part}#${object.shapeId ?? object.order}`,
              )
            else if (!available)
              diagnostics.push(
                `Missing image resource for ${part}#${object.shapeId ?? object.order}: ${reference.relationshipId}`,
              )
            return {
              part,
              shapeId: object.shapeId,
              ...reference,
              target: relation?.target,
              external: relation?.external ?? false,
              available,
              status: relation?.external
                ? 'external-unverified'
                : available
                  ? 'embedded'
                  : 'missing',
              crop: object.image?.crop,
              provenance: 'extracted',
            }
          }),
        )
      }),
    )
  ).flat()
  const objectsFor = (part?: string) =>
    sourceObjects.find((source) => source.part === part)?.objects ?? []
  const objectGeometry = sourceObjects.map(({ part, objects }) => ({
    part,
    objects: objects.map((object) => resolveObjectGeometry(object, objects)),
  }))
  const layoutGeometry = await Promise.all(
    layouts.map(async (part) => {
      const master = await linkedPart(part, 'slideMaster')
      return {
        part,
        ...(master ? { master } : {}),
        placeholders: objectsFor(part)
          .filter((object) => object.placeholder)
          .map((object) =>
            resolvePlaceholderGeometry(
              object,
              [],
              objectsFor(master),
              'layout',
              objectsFor(part),
            ),
          ),
      }
    }),
  )
  const slideGeometry = slideRelationships.map((slide) => ({
    part: slide.part,
    placeholders: objectsFor(slide.part)
      .filter((object) => object.placeholder)
      .map((object) =>
        resolvePlaceholderGeometry(
          object,
          objectsFor(slide.layout),
          objectsFor(slide.master),
          'slide',
          objectsFor(slide.part),
        ),
      ),
  }))
  const resolvedGeometry = [...layoutGeometry, ...slideGeometry]
  // Resolve colors and fonts in the owning part's relationship context. A
  // second master must never inherit the first slide's brand by accident.
  const resolvedPartThemes = sourceObjects.map(({ part }) => {
    const slide = slideRelationships.find((entry) => entry.part === part)
    const layout = layoutGeometry.find((entry) => entry.part === part)
    const masterPart =
      slide?.master ??
      layout?.master ??
      (masters.includes(part) ? part : undefined)
    const layoutPart = slide?.layout ?? (layout ? part : undefined)
    const themePart = masterRelationships.find(
      (entry) => entry.part === masterPart,
    )?.theme
    const base = themeDefinitions.find((entry) => entry.part === themePart)
    const override = overrideFor([part, layoutPart, masterPart])
    const theme = base ? mergeThemeDefinition(base, override) : undefined
    const colorMap =
      resolveColorMap(part, localColorMaps, layoutPart, masterPart).mapping ??
      {}
    return {
      part,
      ...(masterPart ? { masterPart } : {}),
      ...(themePart ? { themePart } : {}),
      ...(override ? { themeOverridePart: override.part } : {}),
      ...(theme
        ? { theme, colors: resolveThemeColors(theme, colorMap).colors }
        : {}),
      colorMap,
      provenance: 'derived' as const,
    }
  })
  const resolvedObjectColors = sourceObjects.map(({ part, objects }) => {
    const context = resolvedPartThemes.find((entry) => entry.part === part)!
    const resolve = (
      color: Parameters<typeof resolveSourceColor>[0] | undefined,
    ) =>
      color
        ? resolveSourceColor(color, {
            theme: context.theme ?? { part, colors: [] },
            colorMap: context.colorMap,
            sourcePart: part,
          })
        : undefined
    return {
      part,
      objects: objects.map((object) => ({
        shapeId: object.shapeId,
        order: object.order,
        fill: resolve(object.appearance?.fill?.color),
        line: resolve(object.appearance?.line?.fill?.color),
        paragraphs: object.text?.paragraphs.map((paragraph) => ({
          runs: paragraph.runs.map((run) => ({
            color: resolve(run.style?.fill?.color),
          })),
        })),
        provenance: 'derived' as const,
      })),
    }
  })
  const sourceTextStyles = [
    extractPartTextStyles(presentation, presentationPart),
    ...(await Promise.all(
      masters.map(async (part) =>
        extractPartTextStyles(await read(part), part),
      ),
    )),
  ]
  const resolvedObjectText = sourceObjects.map(({ part, objects }) => {
    const context = resolvedPartThemes.find((entry) => entry.part === part)!
    const slide = slideRelationships.find((entry) => entry.part === part)
    return {
      part,
      objects: objects
        .filter((object) => object.text || object.placeholder)
        .map((object) => {
          const inherited =
            context.masterPart === part || !object.placeholder
              ? { chain: [object], issues: [] }
              : resolvePlaceholderChain(
                  object,
                  objectsFor(slide?.layout),
                  objectsFor(context.masterPart),
                  slide ? 'slide' : 'layout',
                )
          return resolveObjectText({
            object,
            chain: inherited.chain,
            chainIssues: inherited.issues,
            presentation: sourceTextStyles[0]!,
            master: sourceTextStyles.find(
              (entry) => entry.part === context.masterPart,
            ),
            theme: context.theme,
            colorMap: context.colorMap,
          })
        }),
    }
  })
  const resolvedPartBackgroundAppearances = resolvedPartThemes.map((context) =>
    resolveBackgroundAppearance(
      context.part,
      localBackgrounds,
      context.theme,
      context.colorMap,
    ),
  )
  diagnostics.push(
    ...resolvedGeometry.flatMap((part) =>
      part.placeholders.flatMap((placeholder) => placeholder.issues),
    ),
  )
  const layoutDetails = layouts.map((name) => {
    const objects =
      sourceObjects.find((source) => source.part === name)?.objects ?? []
    const placeholders = objects
      .filter((object) => object.placeholder)
      .map((object) => ({
        ...object.placeholder,
        name: object.name,
        shapeId: object.shapeId,
        transform: object.transform,
        part: name,
      }))
    return { id: name, placeholders, objects }
  })
  const candidateLayouts = layoutDetails.map((detail) => {
    const parentPart = layoutGeometry.find(
      (entry) => entry.part === detail.id,
    )?.master
    const master = masterRelationships.find(
      (entry) => entry.part === parentPart,
    )
    const geometry = resolvedGeometry.find((entry) => entry.part === detail.id)
    const placeholderEntries = detail.placeholders
    const resolvedPlaceholders = geometry?.placeholders ?? []
    const geometryComplete =
      placeholderEntries.length === 0
        ? ('complete' as const)
        : resolvedPlaceholders.length === placeholderEntries.length &&
            resolvedPlaceholders.every((entry) => entry.complete)
          ? ('complete' as const)
          : resolvedPlaceholders.some((entry) => entry.complete)
            ? ('partial' as const)
            : ('unresolved' as const)
    const placeholderIssues = resolvedPlaceholders.flatMap(
      (entry) => entry.issues,
    )
    const fixedObjects = [...detail.objects, ...objectsFor(parentPart)].filter(
      (object) => !object.placeholder && object.kind !== 'grpSp',
    )
    const fixedIssues = fixedObjects.flatMap((object) => {
      const geometry = resolveObjectGeometry(object, objectsFor(object.part))
      return [
        ...geometry.issues,
        ...(geometry.status === 'resolved' && !geometry.axisAligned
          ? [
              `Fixed object requires matrix projection: ${object.part}#${object.shapeId ?? object.order}`,
            ]
          : []),
        ...(object.kind !== 'sp'
          ? [
              `Fixed object requires ${object.kind} materialization: ${object.part}#${object.shapeId ?? object.order}`,
            ]
          : []),
        ...(object.unsupported ?? []).map(
          (issue) =>
            `${object.part}#${object.shapeId ?? object.order}: ${issue}`,
        ),
      ]
    })
    const fixedObjectsComplete =
      fixedObjects.length === 0
        ? ('complete' as const)
        : fixedIssues.length === 0
          ? ('complete' as const)
          : ('partial' as const)
    const styleObjects = detail.objects.filter((object) =>
      Boolean(object.placeholder || object.text),
    )
    const styles =
      styleObjects.length === 0 ? ('unresolved' as const) : ('partial' as const)
    const semanticEvidence = [
      ...(master
        ? [{ kind: 'master-link', value: master.part, sourcePart: detail.id }]
        : []),
      ...(master?.theme
        ? [{ kind: 'theme-link', value: master.theme, sourcePart: master.part }]
        : []),
      ...placeholderEntries.map((placeholder) => ({
        kind: 'placeholder',
        value: placeholder.type,
        sourcePart: detail.id,
        ...(placeholder.shapeId ? { shapeId: placeholder.shapeId } : {}),
      })),
      ...(fixedObjects.length
        ? [
            {
              kind: 'fixed-object-count',
              value: String(fixedObjects.length),
              sourcePart: detail.id,
            },
          ]
        : []),
    ]
    const completeness = {
      geometry: geometryComplete,
      placeholders: geometryComplete,
      fixedObjects: fixedObjectsComplete,
      styles,
    }
    return {
      id: detail.id,
      name:
        detail.id
          .split('/')
          .pop()
          ?.replace(/\.xml$/, '') ?? detail.id,
      source: {
        part: detail.id,
        ...(master ? { master: master.part } : {}),
        ...(master?.theme ? { theme: master.theme } : {}),
        provenance: 'extracted' as const,
      },
      semanticEvidence,
      completeness,
      issues: [...placeholderIssues, ...fixedIssues],
      provenance: 'derived' as const,
    }
  })
  return ImportAnalysisV1Schema.parse({
    version: 1,
    sourceHash,
    ...(resolvedObjectText.some(part => part.objects.some(object => [...object.levels, ...object.paragraphs].some(paragraph => paragraph.children.tabLst?.children.some(tab => tab.attributes.algn === 'dec'))))
      ? { decimalTabConvention: { status: 'unknown', reason: 'drawingml-has-no-decimal-separator' } } : {}),
    sourceGraph: {
      presentationPart,
      slides: slideRelationships,
      masters: masterRelationships,
    },
    extractedFeatures: {
      canvas,
      localColorMaps,
      resolvedColorMaps,
      themeDefinitions,
      themeOverrides,
      resolvedThemeColors,
      resolvedSlideThemeColors,
      localBackgrounds,
      resolvedBackgrounds,
      resolvedBackgroundAppearances,
      imageResources,
      noteTexts,
      resolvedGeometry,
      objectGeometry,
      resolvedPartThemes,
      resolvedObjectColors,
      sourceTextStyles,
      resolvedObjectText,
      resolvedPartBackgroundAppearances,
      sourceObjects,
      colors,
      fonts,
      masters: masters.length,
      slides: slides.length,
      layouts: layoutDetails,
      notes,
      animations,
      presentationBytes: presentation.length,
      presentationPart,
      masterParts: masters,
      masterRelationships,
      slideRelationships,
      themeParts,
      noteParts,
    },
    candidateLayouts,
    unsupportedOoxml: [
      ...diagnostics,
      ...(animations ? ['object animation timing requires manual review'] : []),
      ...(notes ? [] : ['speaker notes are absent']),
    ],
    userOverrides: {},
  })
}
export { verifyPptxRenderEvidence, pptxRenderEnvironmentDigest, type VerifyPptxRenderEvidenceInput } from './render-evidence.js'
