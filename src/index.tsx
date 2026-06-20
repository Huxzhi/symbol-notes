import { render } from 'solid-js/web'
import App from './App'
import { getMaskColors, setMaskColors } from './lib/themeCache'
import './index.css'

// 防闪：渲染前读回上次的遮罩颜色，使 loading 遮罩首帧即正确着色。
// 主题本体走 .symbol-notes/theme.json，扫描后才 hydrate。
async function boot(): Promise<void> {
  const mask = await getMaskColors()
  if (mask) setMaskColors(mask)
  render(() => <App />, document.getElementById('root')!)
}

void boot()
