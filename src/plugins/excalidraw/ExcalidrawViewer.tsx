import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { readFile, writeFile } from '../../services/fileIO'
import { loadFromStorage } from '../../lib/localStorage'
import { setRuntimeStore, runtimeStore } from '../../stores/runtimeStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  parseExcalidrawMd,
  serializeExcalidrawMd,
  type ExcalidrawData,
  type ExcalidrawMode,
} from './excalidrawFormat'
import { EXCALIDRAW_DEFAULTS, type ExcalidrawPluginConfig, updateExcalidrawPluginConfig } from './index'

function getPluginConfig(): ExcalidrawPluginConfig {
  return {
    ...EXCALIDRAW_DEFAULTS,
    ...(loadFromStorage<Record<string, unknown>>(
      'sn-plugin-excalidraw', {}, (v) => typeof v === 'object' && v !== null,
    ) ?? {}),
  } as ExcalidrawPluginConfig
}

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
        gridSize: s.gridSize ?? null,
        viewBackgroundColor: s.viewBackgroundColor,
      },
      files: excalidrawAPI.getFiles() ?? {},
    }
  }

  async function doSave(): Promise<void> {
    const p = filePath()
    if (!p) return
    const data = getSceneData()
    if (!data) return
    // Persist global config (theme + grid) back to plugin settings so the
    // next file opened inherits the user's current Excalidraw preferences
    if (excalidrawAPI) {
      const s = excalidrawAPI.getAppState()
      updateExcalidrawPluginConfig({
        defaultTheme: (s.theme as 'dark' | 'light') ?? 'dark',
        gridSize: s.gridSize ?? 0,
      })
    }
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

  // Mirror EditorViewer: wait for rootHandle before loading — workspace restores
  // tabs from localStorage before the vault permission is granted, so onMount
  // alone would fire with rootHandle === null.
  createEffect(on(
    () => runtimeStore.rootHandle,
    async (rootHandle) => {
      if (!rootHandle || reactRoot) return
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
      const cfg = getPluginConfig()
      reactRoot = createRoot(container)
      reactRoot.render(
        createElement(Excalidraw as any, {
          excalidrawAPI: (api: any) => { excalidrawAPI = api },
          initialData: {
            elements,
            // File-saved values take priority; fall back to plugin config defaults
            appState: {
              gridSize: cfg.gridSize > 0 ? cfg.gridSize : null,
              viewBackgroundColor: cfg.viewBackgroundColor,
              theme: cfg.defaultTheme,
              ...data.appState,  // overrides with per-file saved state (if present)
            },
            files: data.files,
          },
          // No controlled `theme` prop — hamburger "Toggle dark mode" works freely
          onChange: () => {
            setDirty(true)
            scheduleSave()
          },
        }),
      )
    } catch (err) {
      container.textContent = `[绘图组件加载失败: ${err instanceof Error ? err.message : String(err)}]`
    }
    },
  ))

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
