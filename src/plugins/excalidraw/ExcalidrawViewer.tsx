import { createEffect, on, onCleanup, onMount, createMemo } from 'solid-js'
import { getPluginConfig as getPluginData } from '../../lib/pluginData'
import { vaultFs } from '../../vault'
import { fileActions } from '../../commands'
import { setLeafInstances } from '../../stores/workspaceStore'
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
    ...getPluginData('excalidraw'),
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
  let saveTimerPath: string | null = null   // path captured at schedule time
  let localDirty = false
  let loadedPath: string | null = null      // path currently loaded in excalidrawAPI

  function setDirty(dirty: boolean) {
    localDirty = dirty
    if (props.isActive) {
      setLeafInstances(props.leafId, (prev) => ({
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

  async function doSave(p: string): Promise<void> {
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
    await fileActions.saveFile(p, serializeExcalidrawMd(data, currentMode))
    setDirty(false)
  }

  function cancelPendingSave() {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    saveTimerPath = null
  }

  function scheduleSave() {
    cancelPendingSave()
    const p = filePath()
    if (!p) return
    saveTimerPath = p
    saveTimer = setTimeout(() => {
      saveTimer = null
      const savedPath = saveTimerPath
      saveTimerPath = null
      if (savedPath) void doSave(savedPath)
    }, 1000)
  }

  async function loadFile(p: string) {
    let data: ExcalidrawData
    let mode: ExcalidrawMode
    try {
      const content = await fileActions.readFile(p)
      const parsed = parseExcalidrawMd(content)
      data = parsed.data
      mode = parsed.mode
    } catch (err) {
      container.textContent = `[绘图文件加载失败: ${err instanceof Error ? err.message : String(err)}]`
      return
    }

    currentMode = mode
    loadedPath = p

    try {
      const [{ createRoot }, { createElement }, { Excalidraw, restoreElements }] = await Promise.all([
        import('react-dom/client'),
        import('react'),
        import('@excalidraw/excalidraw'),
        ensureExcalidrawCss(),
      ])
      const elements = restoreElements(data.elements as any, null)
      const cfg = getPluginConfig()

      if (!reactRoot) reactRoot = createRoot(container)
      reactRoot.render(
        createElement(Excalidraw as any, {
          key: p,
          excalidrawAPI: (api: any) => { excalidrawAPI = api },
          initialData: {
            elements,
            appState: {
              gridSize: cfg.gridSize > 0 ? cfg.gridSize : null,
              viewBackgroundColor: cfg.viewBackgroundColor,
              theme: cfg.defaultTheme,
              ...data.appState,
            },
            files: data.files,
          },
          onChange: () => {
            setDirty(true)
            scheduleSave()
          },
        }),
      )
    } catch (err) {
      container.textContent = `[绘图组件加载失败: ${err instanceof Error ? err.message : String(err)}]`
    }
  }

  // Wait for fs adapter before first load
  createEffect(on(
    () => vaultFs(),
    async (fs) => {
      if (!fs || reactRoot) return
      const p = filePath()
      if (!p) return
      await loadFile(p)
    },
  ))

  // Reload when filePath changes (same tab, different excalidraw file)
  createEffect(on(
    filePath,
    async (p, prevP) => {
      if (!p || p === prevP || !reactRoot) return
      // Save the previous file before switching
      if (localDirty && prevP && prevP === loadedPath) {
        cancelPendingSave()
        await doSave(prevP)
      } else {
        cancelPendingSave()
      }
      setDirty(false)
      await loadFile(p)
    },
  ))

  onCleanup(() => {
    cancelPendingSave()
    reactRoot?.unmount()
    reactRoot = null
    excalidrawAPI = null
    loadedPath = null
  })

  // Ctrl+S
  onMount(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!props.isActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        cancelPendingSave()
        const p = loadedPath
        if (p) void doSave(p)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  // 切换 tab 时自动保存
  createEffect(on(
    () => props.isActive,
    (isActive, prevIsActive) => {
      if (prevIsActive && !isActive && localDirty) {
        cancelPendingSave()
        const p = loadedPath
        if (p) void doSave(p)
      }
    },
  ))

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
