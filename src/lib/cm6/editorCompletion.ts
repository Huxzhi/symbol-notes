import { autocompletion } from '@codemirror/autocomplete'
import { fieldCompletionSource, valueCompletionSource } from './listsField'
import { wikiLinkSource } from './wikiLinkComplete'

// 编辑器的统一补全:所有源必须放进同一个 autocompletion 的 override 数组里——
// 两个独立的 autocompletion({override}) 会触发 "Config merge conflict for field override"。
export const editorCompletion = autocompletion({
  override: [fieldCompletionSource, valueCompletionSource, wikiLinkSource],
  activateOnTyping: true,
})
