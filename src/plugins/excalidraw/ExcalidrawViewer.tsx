import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { readFile, writeFile } from '../../services/fileIO'
import { setRuntimeStore } from '../../stores/runtimeStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  parseExcalidrawMd,
  serializeExcalidrawMd,
  type ExcalidrawData,
  type ExcalidrawMode,
} from './excalidrawFormat'

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
    const appState = excalidrawAPI.getAppState()
    return {
      type: 'excalidraw',
      version: 2,
      source: 'symbol-notes',
      elements: excalidrawAPI.getSceneElements(),
      appState: {
        gridSize: appState.gridSize ?? null,
        viewBackgroundColor: appState.viewBackgroundColor ?? '#1e1e2e',
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
        import('@excalidraw/excalidraw/index.css'),
      ])
      const elements = restoreElements(data.elements as any, null)
      reactRoot = createRoot(container)
      reactRoot.render(
        createElement(Excalidraw as any, {
          // Use API ref to read scene data on save — avoids the onChange-on-mount skip hack
          excalidrawAPI: (api: any) => { excalidrawAPI = api },
          initialData: {
            elements,
            appState: { ...data.appState, theme: 'dark' },
            files: data.files,
          },
          // onChange only marks dirty + schedules save; actual data read at save time
          onChange: () => {
            setDirty(true)
            scheduleSave()
          },
          theme: 'dark',
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
