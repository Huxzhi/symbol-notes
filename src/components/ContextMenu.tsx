import { For, Show, onMount, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Portal } from 'solid-js/web'
import { getMenuItems, type MenuItem } from '../lib/pluginRegistry'

type MenuState = { x: number; y: number; items: MenuItem[] } | null

const [state, setState] = createStore<{ menu: MenuState }>({ menu: null })

function closeMenu() {
  setState('menu', null)
}

export function ContextMenu() {
  onMount(() => {
    function onContextMenu(e: MouseEvent) {
      let el = e.target as HTMLElement | null
      while (el) {
        const ctx = el.dataset.ctx
        if (ctx) {
          const items = getMenuItems(ctx, el.dataset)
          if (items.length > 0) {
            e.preventDefault()
            const approxH = items.length * 28
            const approxW = 160
            setState('menu', {
              x: e.clientX + approxW > window.innerWidth ? e.clientX - approxW : e.clientX,
              y: e.clientY + approxH > window.innerHeight ? e.clientY - approxH : e.clientY,
              items,
            })
          }
          return
        }
        el = el.parentElement
      }
    }

    function onMouseDown(e: MouseEvent) {
      const menuEl = document.querySelector('[data-context-menu-root]')
      if (menuEl && !menuEl.contains(e.target as Node)) closeMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    })
  })

  return (
    <Show when={state.menu}>
      {(m) => (
        <Portal>
          <div
            data-context-menu-root
            class="fixed z-50 min-w-40 py-1 rounded border border-(--border) bg-(--bg-surface) shadow-lg"
            style={{ left: `${m().x}px`, top: `${m().y}px` }}
          >
            <For each={m().items}>
              {(item) =>
                'separator' in item ? (
                  <div class="my-1 border-t border-(--border)" />
                ) : (
                  <button
                    class="w-full text-left px-3 py-1 text-[11px] text-(--text-2) hover:bg-(--bg-hover) hover:text-(--text) disabled:opacity-40 disabled:pointer-events-none"
                    disabled={item.disabled}
                    onClick={() => {
                      item.action()
                      closeMenu()
                    }}
                  >
                    {item.label}
                  </button>
                )
              }
            </For>
          </div>
        </Portal>
      )}
    </Show>
  )
}
