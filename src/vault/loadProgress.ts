import { createSignal } from 'solid-js'

export type LoadPhase = 'idle' | 'scanning' | 'parsing' | 'building' | 'done'

export interface LoadSnapshot {
  visible: boolean
  phase: LoadPhase
  detected: number
  parsed: number
  /** Total markdown files to parse in phase 2 (0 until known). */
  parsedTotal: number
}

const SHOW_DELAY_MS = 300
/** Fraction of the remaining gap closed per frame (count-up easing). */
const EASE_FACTOR = 0.18

let detectedRaw = 0
let parsedRaw = 0
let currentSession: object | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let frameId: number | null = null

const [snapshot, setSnapshot] = createSignal<LoadSnapshot>({
  visible: false,
  phase: 'idle',
  detected: 0,
  parsed: 0,
  parsedTotal: 0,
})

/** Reactive accessor for the current load progress snapshot. */
export const loadProgress = snapshot

export function incDetected(): void {
  detectedRaw++
}

export function incParsed(): void {
  parsedRaw++
}

/** Move `current` one eased step toward `target` (count-up animation). */
export function easeCount(current: number, target: number): number {
  if (current >= target) return target
  return current + Math.max(1, Math.ceil((target - current) * EASE_FACTOR))
}

function requestFrame(cb: () => void): number {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(() => cb())
  }
  return setTimeout(cb, 16) as unknown as number
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id)
  else clearTimeout(id)
}

function tick(): void {
  const cur = snapshot()
  const nextDetected = easeCount(cur.detected, detectedRaw)
  const nextParsed = easeCount(cur.parsed, parsedRaw)
  if (nextDetected !== cur.detected || nextParsed !== cur.parsed) {
    setSnapshot((s) => ({ ...s, detected: nextDetected, parsed: nextParsed }))
  }
  frameId = requestFrame(tick)
}

function stopTimers(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (frameId !== null) {
    cancelFrame(frameId)
    frameId = null
  }
}

export function beginLoadProgress(session: object): void {
  currentSession = session
  detectedRaw = 0
  parsedRaw = 0
  stopTimers()
  setSnapshot({
    visible: false,
    phase: 'scanning',
    detected: 0,
    parsed: 0,
    parsedTotal: 0,
  })
  showTimer = setTimeout(() => {
    if (currentSession !== session) return
    setSnapshot((s) => ({ ...s, visible: true }))
  }, SHOW_DELAY_MS)
  frameId = requestFrame(tick)
}

export function setLoadPhase(session: object, phase: LoadPhase): void {
  if (currentSession !== session) return
  setSnapshot((s) => ({ ...s, phase }))
}

/** Record how many markdown files phase 2 will parse (for the "M / N" display). */
export function setParseTotal(session: object, total: number): void {
  if (currentSession !== session) return
  setSnapshot((s) => ({ ...s, parsedTotal: total }))
}

/** 扫描完成：撤掉全屏遮挡（解析进度改走 toast）。 */
export function endScanOverlay(session: object): void {
  if (currentSession !== session) return
  stopTimers()
  setSnapshot((s) => ({ ...s, visible: false }))
}

export function endLoadProgress(session: object): void {
  if (currentSession !== session) return
  stopTimers()
  setSnapshot((s) => ({
    ...s,
    visible: false,
    phase: 'done',
    detected: detectedRaw,
    parsed: parsedRaw,
  }))
  currentSession = null
}
