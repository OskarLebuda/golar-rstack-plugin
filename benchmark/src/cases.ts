import fs from 'node:fs'
import path from 'node:path'

/**
 * How many modules each component reaches through.
 *
 * A component that imports only its own helper measures little beyond process
 * startup, because nothing forces the checker to walk a graph. Fanning out
 * across neighbours is what makes the type work dominate the run.
 */
const IMPORT_FANOUT = 3

export interface CaseSpec {
  /** Number of SFCs, matched one to one by a TypeScript module. */
  size: number
  /** How many components get a deliberate type error, for the correctness gate. */
  errors: number
}

export interface GeneratedCase extends CaseSpec {
  /** Directory holding the generated project. */
  dir: string
}

/**
 * Writes a TypeScript module carrying the types a component will exercise.
 *
 * The generics, discriminated union and conditional type are the point: plain
 * interfaces are cheap for every checker, so a fixture built from them measures
 * startup overhead rather than checking throughput.
 *
 * @param index Index of the module, used to keep every symbol distinct.
 * @returns The module source.
 */
function renderModule(index: number): string {
  return `export type Status${index} =
  | { kind: 'idle' }
  | { kind: 'loading', since: number }
  | { kind: 'ready', items: Item${index}[] }
  | { kind: 'failed', reason: string }

export interface Item${index} {
  id: number
  label: string
  tags: readonly string[]
  meta: Record<string, string | number | boolean>
}

export type Selected${index}<T extends Item${index}> = T extends { tags: readonly [infer First, ...infer _Rest] }
  ? { value: T, primaryTag: First }
  : { value: T, primaryTag: undefined }

export function make${index}(id: number): Item${index} {
  return { id, label: \`item-\${id}\`, tags: ['a', 'b'], meta: { seen: false } }
}

export function select${index}<T extends Item${index}>(value: T): Selected${index}<T> {
  return { value, primaryTag: value.tags[0] } as Selected${index}<T>
}

export function summarize${index}(status: Status${index}): string {
  switch (status.kind) {
    case 'idle':
      return 'idle'
    case 'loading':
      return \`loading since \${status.since}\`
    case 'ready':
      return status.items.map(item => item.label).join(', ')
    case 'failed':
      return status.reason
  }
}

export function total${index}(items: Item${index}[]): number {
  return items.reduce((sum, item) => sum + item.id, 0)
}
`
}

/**
 * Writes a single file component that uses the generated types.
 *
 * @param index Index of the component.
 * @param size Total number of components, so imports stay in range.
 * @param seedError Whether to include a deliberate type error.
 * @returns The SFC source.
 */
function renderComponent(index: number, size: number, seedError: boolean): string {
  const neighbours = Array.from(
    { length: IMPORT_FANOUT },
    (_, offset) => (index + offset + 1) % size,
  ).filter(neighbour => neighbour !== index)

  const imports = neighbours
    .map(n => `import { make${n}, summarize${n}, total${n} } from './util${n}'\nimport type { Item${n}, Status${n} } from './util${n}'`)
    .join('\n')

  const neighbourState = neighbours
    .map(n => `const status${n} = ref<Status${n}>({ kind: 'ready', items: [make${n}(1)] })
const sum${n} = computed(() => total${n}(status${n}.value.kind === 'ready' ? status${n}.value.items : []))
const text${n} = computed(() => summarize${n}(status${n}.value))`)
    .join('\n')

  // A number where a string is expected: one diagnostic, at a stable position,
  // that every checker under test reports identically.
  const bug = seedError ? `\nconst broken: string = total${index}(items.value)\n` : ''

  return `<script setup lang="ts" generic="T extends Item${index}">
import { computed, ref } from 'vue'
import { make${index}, select${index}, summarize${index}, total${index} } from './util${index}'
import type { Item${index}, Status${index} } from './util${index}'
${imports}

const props = defineProps<{
  seed: T
  status?: Status${index}
  formatter?: (item: Item${index}) => string
}>()

const emit = defineEmits<{
  picked: [item: Item${index}]
  cleared: []
}>()

const items = ref<Item${index}[]>([make${index}(1), make${index}(2)])
const chosen = computed(() => select${index}(props.seed))
const caption = computed(() => summarize${index}(props.status ?? { kind: 'idle' }))
const rendered = computed(() => items.value.map(props.formatter ?? (item => item.label)))
${neighbourState}
${bug}
function pick(item: Item${index}) {
  emit('picked', item)
}
</script>

<template>
  <section>
    <h2>{{ caption }} / {{ chosen.primaryTag ?? 'none' }}</h2>
    <ul>
      <li v-for="(line, i) in rendered" :key="i" @click="pick(items[i]!)">
        {{ line }}
      </li>
    </ul>
    <slot name="footer" :total="total${index}(items)" />
    <button @click="emit('cleared')">
      clear
    </button>
  </section>
</template>
`
}

/**
 * Generates a project of the requested size on disk.
 *
 * The project is rewritten from scratch every time, so a run never inherits
 * files, or a build cache, from a differently sized one.
 *
 * @param root Directory to hold generated cases.
 * @param spec Size of the case and how many errors to seed.
 * @returns The generated case, including where it landed.
 */
export function generateCase(root: string, spec: CaseSpec): GeneratedCase {
  const dir = path.join(root, spec.errors > 0 ? `size-${spec.size}-seeded` : `size-${spec.size}`)
  const src = path.join(dir, 'src')

  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(src, { recursive: true })

  for (let i = 0; i < spec.size; i++) {
    fs.writeFileSync(path.join(src, `util${i}.ts`), renderModule(i))
    fs.writeFileSync(path.join(src, `Comp${i}.vue`), renderComponent(i, spec.size, i < spec.errors))
  }

  fs.writeFileSync(path.join(src, 'env.d.ts'), `declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
`)

  const compilerOptions = {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ESNext', 'DOM'],
    strict: true,
    jsx: 'preserve',
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
  }

  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions, include: ['src'] }, null, 2)}\n`,
  )

  // The baseline: the same modules without a single SFC, so the difference
  // against the Vue-aware runs is the cost of understanding components.
  fs.writeFileSync(
    path.join(dir, 'tsconfig.ts-only.json'),
    `${JSON.stringify({ compilerOptions, include: ['src/**/*.ts'] }, null, 2)}\n`,
  )

  fs.writeFileSync(path.join(dir, 'golar.config.ts'), `import { defineConfig } from 'golar/unstable'
import '@golar/vue'

export default defineConfig({})
`)

  return { ...spec, dir }
}
