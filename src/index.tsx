import { render } from 'solid-js/web'
import App from './App'
import { getCachedTheme } from './lib/themeCache'
import { applyTheme } from './lib/theme'
import './index.css'

// 首帧防闪烁：渲染前先读回上次生效主题并应用，使遮罩与背景首帧即正确着色。
// IDB 读取为个位数毫秒，期间 root 为空，无可见内容。
async function boot(): Promise<void> {
  const cached = await getCachedTheme()
  if (cached) applyTheme(cached)
  render(() => <App />, document.getElementById('root')!)
}

void boot()
