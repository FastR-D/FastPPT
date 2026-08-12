const TEXT_PRIORITY_MIN = 1

/**
 * @typedef {{
 *   minSize: number
 *   maxSize: number
 *   priority?: number
 * }} PriorityTextSizeItemInput
 * @typedef {{
 *   minSize: number
 *   maxSize: number
 *   priority: number
 * }} PriorityTextSizeItem
 */

/**
 * @param {string} message
 */
function failTextPriorityFit(message) {
  throw new Error(`[Text] ${message}`)
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @param {PriorityTextSizeItem[]} items
 */
function compareCandidatesByPriority(left, right, items) {
  const order = items
    .map((item, index) => ({ index, priority: item.priority }))
    .sort((leftItem, rightItem) => leftItem.priority - rightItem.priority || leftItem.index - rightItem.index)

  for (const { index } of order) {
    if (left[index] !== right[index])
      return right[index] - left[index]
  }

  return right.reduce((sum, size) => sum + size, 0) - left.reduce((sum, size) => sum + size, 0)
}

/**
 * @param {number[]} candidate
 * @param {PriorityTextSizeItem[]} items
 */
function satisfiesPriority(candidate, items) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < items.length; rightIndex += 1) {
      if (leftIndex === rightIndex)
        continue

      const priorityGap = items[rightIndex].priority - items[leftIndex].priority
      if (priorityGap <= 0)
        continue

      if (candidate[leftIndex] - candidate[rightIndex] < priorityGap)
        return false
    }
  }

  return true
}

/**
 * @param {number[]} candidate
 * @param {PriorityTextSizeItem[]} items
 */
function satisfiesAssignedPriority(candidate, items) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    if (!Number.isInteger(candidate[leftIndex]))
      continue

    for (let rightIndex = 0; rightIndex < items.length; rightIndex += 1) {
      if (leftIndex === rightIndex || !Number.isInteger(candidate[rightIndex]))
        continue

      const priorityGap = items[rightIndex].priority - items[leftIndex].priority
      if (priorityGap <= 0)
        continue

      if (candidate[leftIndex] - candidate[rightIndex] < priorityGap)
        return false
    }
  }

  return true
}

/**
 * @param {PriorityTextSizeItemInput[]} items
 * @returns {PriorityTextSizeItem[]}
 */
function normalizePriorityFitItems(items) {
  return items.map((item, index) => {
    const minSize = Number(item.minSize),
      maxSize = Number(item.maxSize),
      priority = Number(item.priority ?? TEXT_PRIORITY_MIN)

    if (!Number.isInteger(minSize) || !Number.isInteger(maxSize) || minSize > maxSize)
      failTextPriorityFit(`item ${index + 1} has invalid size range.`)

    if (!Number.isInteger(priority) || priority < TEXT_PRIORITY_MIN)
      failTextPriorityFit(`item ${index + 1} has invalid priority.`)

    return {
      minSize,
      maxSize,
      priority,
    }
  })
}

/**
 * @param {PriorityTextSizeItem[]} normalizedItems
 * @returns {Generator<number[]>}
 */
function createPriorityTextSizeCandidatesFromNormalized(normalizedItems) {
  const order = normalizedItems
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.priority - right.item.priority || left.index - right.index)

  /**
   * @param {number} orderIndex
   * @param {number[]} candidate
   * @returns {Generator<number[]>}
   */
  function* visit(orderIndex, candidate) {
    if (orderIndex === order.length) {
      yield candidate.slice()
      return
    }

    const { item, index } = order[orderIndex]
    for (let size = item.maxSize; size >= item.minSize; size -= 1) {
      candidate[index] = size
      if (satisfiesAssignedPriority(candidate, normalizedItems))
        yield* visit(orderIndex + 1, candidate)
    }
  }

  return visit(0, [])
}

/**
 * @param {PriorityTextSizeItemInput[]} items
 * @returns {Generator<number[]>}
 */
export function createPriorityTextSizeCandidates(items) {
  return createPriorityTextSizeCandidatesFromNormalized(normalizePriorityFitItems(items))
}

/**
 * @param {PriorityTextSizeItemInput[]} items
 * @returns {number[][]}
 */
export function resolvePriorityTextSizeCandidates(items) {
  const normalizedItems = normalizePriorityFitItems(items)
  const candidates = [...createPriorityTextSizeCandidatesFromNormalized(normalizedItems)]

  if (!candidates.length)
    failTextPriorityFit('size ranges cannot satisfy priority hierarchy.')

  if (!candidates.every(candidate => satisfiesPriority(candidate, normalizedItems)))
    failTextPriorityFit('size ranges cannot satisfy priority hierarchy.')

  return candidates.sort((left, right) => compareCandidatesByPriority(left, right, normalizedItems))
}
