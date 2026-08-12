import { reactive, toValue, watchEffect } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useSlideContext } from '@slidev/client'

function createRegistry<T>() {
  const store = reactive<Record<number, T>>({})

  function publish(value: MaybeRefOrGetter<T>) {
    const page = toValue(useSlideContext().$page)
    watchEffect(() => {
      store[page] = toValue(value)
    })
  }

  return { store, publish }
}

export interface SlideLogos {
  ddrg?: 'color' | 'white'
  tud?: boolean
  footer?: boolean
}

const slideLogosReg = createRegistry<SlideLogos>()
export const slideLogos = slideLogosReg.store

export function useLogo(logos: MaybeRefOrGetter<SlideLogos>) {
  slideLogosReg.publish(logos)
}
