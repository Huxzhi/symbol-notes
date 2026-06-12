import { createSignal } from 'solid-js'

// 请求在文件面板中定位并展开某文件夹。nonce 保证重复点击同一路径也能重新触发。
export const [revealTarget, setRevealTarget] = createSignal<{ path: string; nonce: number } | null>(null)

let n = 0
export function revealFolder(path: string): void {
  setRevealTarget({ path, nonce: ++n })
}
