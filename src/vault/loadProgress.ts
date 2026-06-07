import { createSignal } from 'solid-js'

export type LoadPhase = 'idle' | 'scanning' | 'parsing' | 'done'

export interface LoadSnapshot {
  visible: boolean
  phase: LoadPhase
  detected: number
  parsed: number
}

const SHOW_DELAY_MS = 300
const SAMPLE_MS = 500

let detectedRaw = 0
let parsedRaw = 0
let currentSession: object | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let sampleTimer: ReturnType<typeof setInterval> | null = null

const [snapshot, setSnapshot] = createSignal<LoadSnapshot>({
  visible: false,
  phase: 'idle',
  detected: 0,
  parsed: 0,
})

/** Reactive accessor for the current load progress snapshot. */
export const loadProgress = snapshot

export function incDetected(): void {
  detectedRaw++
}

export function incParsed(): void {
  parsedRaw++
}

function sample(): void {
  setSnapshot((s) => ({ ...s, detected: detectedRaw, parsed: parsedRaw }))
}

function clearTimers(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (sampleTimer !== null) {
    clearInterval(sampleTimer)
    sampleTimer = null
  }
}

export function beginLoadProgress(session: object): void {
  currentSession = session
  detectedRaw = 0
  parsedRaw = 0
  clearTimers()
  setSnapshot({ visible: false, phase: 'scanning', detected: 0, parsed: 0 })
  showTimer = setTimeout(() => {
    if (currentSession !== session) return
    setSnapshot((s) => ({ ...s, visible: true }))
  }, SHOW_DELAY_MS)
  sampleTimer = setInterval(sample, SAMPLE_MS)
}

export function setLoadPhase(session: object, phase: LoadPhase): void {
  if (currentSession !== session) return
  setSnapshot((s) => ({ ...s, phase }))
}

export function endLoadProgress(session: object): void {
  if (currentSession !== session) return
  clearTimers()
  setSnapshot({
    visible: false,
    phase: 'done',
    detected: detectedRaw,
    parsed: parsedRaw,
  })
  currentSession = null
}
