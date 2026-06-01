import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { readFile, writeFile } from '../../services/fileIO'
import { setRuntimeStore } from '../../stores/runtimeStore'
import { settingsStore } from '../../stores/settingsStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  parseExcalidrawMd,
  serializeExcalidrawMd,
  type ExcalidrawData,
  type ExcalidrawMode,
} from './excalidrawFormat'

// Injected once per session — wraps Excalidraw CSS in @layer so unlayered app
// CSS always wins, preventing class name collisions (e.g. .interactive)
let excalidrawCssInjected = false
async function ensureExcalidrawCss() {
  if (excalidrawCssInjected) return
  excalidrawCssInjected = true
  const { default: css } = await import('@excalidraw/excalidraw/index.css?inline')
  const style = document.createElement('style')
  style.dataset.excalidrawCss = ''
  style.textContent = `@layer excalidraw { ${css} }`
  document.head.appendChild(style)
}

export function ExcalidrawViewer(props: ViewComponentProps) {
  const filePath = () => props.viewState.file as string | undefined

  let container!: HTMLDivElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reactRoot: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let excalidrawAPI: any = null
  let currentMode: ExcalidrawMode = 'parsed'
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false

  function setDirty(dirty: boolean) {
    localDirty = dirty
    if (props.isActive) {
      setRuntimeStore('leafInstances', props.leafId, (prev) => ({
        cmView: prev?.cmView ?? null,
        outLinks: prev?.outLinks ?? [],
        headings: prev?.headings ?? [],
        isDirty: dirty,
      }))
    }
  }

  function getSceneData(): ExcalidrawData | null {
    if (!excalidrawAPI) return null
    const s = excalidrawAPI.getAppState()
    return {
      type: 'excalidraw',
      version: 2,
      source: 'symbol-notes',
      elements: excalidrawAPI.getSceneElements(),
      appState: {
        // Obsidian-compatible fields
        gridSize: s.gridSize ?? null,
        viewBackgroundColor: s.viewBackgroundColor ?? '#1e1e2e',
        // Viewport persistence (Obsidian ignores unknown fields)
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        zoom: s.zoom,
        theme: s.theme ?? 'dark',
      },
      files: excalidrawAPI.getFiles() ?? {},
    }
  }

  async function doSave(): Promise<void> {
    const p = filePath()
    if (!p) return
    const data = getSceneData()
    if (!data) return
    await writeFile(p, serializeExcalidrawMd(data, currentMode), true)
    setDirty(false)
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void doSave()
    }, 1000)
  }

  onMount(async () => {
    const p = filePath()
    if (!p) return

    let data: ExcalidrawData
    let mode: ExcalidrawMode
    try {
      const content = await readFile(p)
      const parsed = parseExcalidrawMd(content)
      data = parsed.data
      mode = parsed.mode
    } catch (err) {
      container.textContent = `[绘图文件加载失败: ${err instanceof Error ? err.message : String(err)}]`
      return
    }

    currentMode = mode

    try {
      const [{ createRoot }, { createElement }, { Excalidraw, restoreElements }] = await Promise.all([
        import('react-dom/client'),
        import('react'),
        import('@excalidraw/excalidraw'),
        ensureExcalidrawCss(),
      ])
      const elements = restoreElements(data.elements as any, null)
      reactRoot = createRoot(container)
      reactRoot.render(
        createElement(Excalidraw as any, {
          excalidrawAPI: (api: any) => { excalidrawAPI = api },
          initialData: {
            elements,
            // Restore full appState; fall back to app theme for new files
            appState: {
              ...data.appState,
              theme: (data.appState.theme as string)
                ?? (settingsStore.theme === 'light' ? 'light' : 'dark'),
            },
            files: data.files,
          },
          // No controlled `theme` prop — Excalidraw manages it internally,
          // so the hamburger menu "Toggle dark mode" works and persists via getSceneData
          onChange: () => {
            setDirty(true)
            scheduleSave()
          },
        }),
      )
    } catch (err) {
      container.textContent = `[绘图组件加载失败: ${err instanceof Error ? err.message : String(err)}]`
    }
  })

  onCleanup(() => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    reactRoot?.unmount()
    reactRoot = null
    excalidrawAPI = null
  })

  // Ctrl+S
  onMount(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!props.isActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
        void doSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  // 切换 tab 时自动保存
  createEffect(
    on(
      () => props.isActive,
      (isActive, prevIsActive) => {
        if (prevIsActive && !isActive && localDirty) {
          if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
          void doSave()
        }
      },
    ),
  )

  return (
    <div
      class="flex flex-col flex-1 overflow-hidden"
      onDragStart={(e) => e.stopPropagation()}
      onDragEnd={(e) => e.stopPropagation()}
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => e.stopPropagation()}
    >
      <div ref={container} class="flex-1 min-h-0" />
    </div>
  )
}
