<script setup lang="ts">
import { ref } from 'vue'
import { double } from './math'

const count = ref(0)

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
