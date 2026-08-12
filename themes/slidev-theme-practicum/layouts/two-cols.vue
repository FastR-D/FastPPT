<template>
  <Slide>
    <Slot col="1 / 6" row="1 / -1" margin-top="4" label="two-cols-left">
      <slot />
    </Slot>

    <Slot col="7 / -1" row="1 / -1" margin-top="4" label="two-cols-right">
      <slot name="right" />
    </Slot>
  </Slide>
</template>
