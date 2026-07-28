<script setup lang="ts">
import { ref } from 'vue'
import { double } from './math'

const count = ref(0)

// Type error inside an SFC. This is the case golar handles and plain tsc does not.
const label: string = double(count.value)
</script>

<template>
  <div>
    <p>{{ label }}</p>
    <button @click="count++">
      increment
    </button>
  </div>
</template>
