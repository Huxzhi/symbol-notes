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
  let currentMode: ExcalidrawMode = 'parsed'
  let currentData: ExcalidrawData | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false
  // Excalidraw fires onChange once on mount with the restored initial state.
  // We skip that first call to avoid an immediate no-op save.
  let mountChangeSkipped = false

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

  async function doSave(): Promise<void> {
    const p = filePath()
    if (!p || !currentData) return
    await writeFile(p, serializeExcalidrawMd(currentData, currentMode), true)
    setDirty(false)
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void doSave()
    }, 1000)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleChange(elements: any[], appState: any, files: any) {
    if (!mountChangeSkipped) {
      mountChangeSkipped = true
      return
    }
    currentData = {
      type: 'excalidraw',
      version: 2,
      source: 'symbol-notes',
      elements,
      appState: {
        gridSize: appState.gridSize ?? null,
        viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
      },
      files: files ?? {},
    }
    setDirty(true)
    scheduleSave()
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

    currentData = data
    currentMode = mode

    try {
      const [{ createRoot }, { createElement }, { Excalidraw, restoreElements }] = await Promise.all([
        import('react-dom/client'),
        import('react'),
        import('@excalidraw/excalidraw'),
      ])
      // restoreElements normalises fractional indices — required when loading
      // files saved by Obsidian's Excalidraw plugin (0.18 validates strictly)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elements = restoreElements(data.elements as any, null)
      reactRoot = createRoot(container)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reactRoot.render(
        createElement(Excalidraw as any, {
          initialData: {
            elements,
            appState: data.appState,
            files: data.files,
          },
          onChange: handleChange,
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
  })

  // Ctrl+S — window 级别，isActive 时生效
  onMount(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!props.isActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimer !== null) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
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
          if (saveTimer !== null) {
            clearTimeout(saveTimer)
            saveTimer = null
          }
          void doSave()
        }
      },
    ),
  )

  return (
    <div class="flex-1 w-full overflow-hidden" style={{ height: '100%' }}>
      <div ref={container} class="w-full h-full" />
    </div>
  )
}
