# Wikilink 自动补全 + 别名解析设计

日期:2026-06-11

## 目标

CM6 编辑器中输入 `[[` 后,自动弹出 CM6 自带候选框,从**所有文件名和别名**中快捷补全:

- 用 CM6 自带的模糊过滤;
- 前缀匹配优先,匹配项中**修改时间(mtime)靠后的排在最上面**;
- 选中别名时插入 `[[别名]]`,并让该链接能正确跳转(需打通别名解析)。

## 背景 / 现状

- `vaultStore.files` 是 `Record<path, FileMeta>`,`FileMeta` 含 `name`、`aliases: string[]`、`mtime`。
- Wikilink 链接目标在文档中**不带 `.md`**,解析时再补 `.md`(见 `EditorViewer.tsx:184`)。
- 已有补全先例:`src/lib/cm6/listsField.ts` 的 `taskFieldComplete`,用 `@codemirror/autocomplete` 的 `autocompletion({ override: [...] })`,接在 `EditorViewer.tsx` 的 extensions 数组里。
- **别名解析现状(关键)**:全仓库读取 `aliases` 的地方只有两处:
  1. `extractAliases`(scan.ts / index.ts)——仅写入 FileMeta。
  2. `pluginRegistry.ts:338` 的 `backlinks(path)`——尝试用 `${alias}.md` 当 key 聚合 `backlinkMap`。
  - 真正的链接解析 `resolveLink`(`backlinks.ts:18`)**完全不看 aliases**,只按文件名 stem 匹配。
  - 且第 2 处是**空转**:`[[别名]]` 经 `resolveLink` 失败后进 `unresolvedMap[别名]`(无 `.md`),不会以 `别名.md` 落进 `backlinkMap`。
  - 结论:双链导航/反链层面目前**没有真正接通别名**。本设计补上。

## 设计

### 1. 补全源 `src/lib/cm6/wikiLinkComplete.ts`(新文件)

- **触发**:`ctx.matchBefore(/\[\[([^\[\]\n|]*)$/)` —— 光标在 `[[` 之后、尚未遇到 `]` / `|` / 换行。
  `from` = `[[` 之后的位置(即捕获组起点)。`[[a|...` 之后不触发(留给竖线显示名,不补全)。
- **候选集合**:遍历 `vaultStore.files`,仅 `kind === 'file'` 且 path 以 `.md` 结尾,每个文件产出:
  - 文件名候选:`label` = 去掉 `.md` 的 basename;
  - 每个 alias 一个候选:`label` = 别名,`detail` = 文件名(便于区分同名别名)。
  - 每个候选带 `boost`,由 `mtime` 新旧映射成一个**小范围**数值(越新越大),让 CM6 的前缀/匹配质量评分占主导、mtime 作次级加权,实现「前缀优先、近期靠前」。boost 缩放比例作为可调常量,实现时用测试校准。
- **过滤/排序**:使用 **CM6 自带模糊过滤**(不设 `filter: false`)。设 `validFor: /^[^\[\]\n|]*$/`,让 CM6 在用户继续打字时直接复用并增量过滤同一候选集,无需每次按键重跑候选源。
- **apply**:插入 `label`,并在其后补 `]]`,光标落到 `]]` 之后;若插入点后面已是 `]]`,则不重复补。
- 导出 `wikiLinkComplete = autocompletion({ override: [wikiLinkCompletionSource] })`,与现有 `taskFieldComplete` 同风格。

### 2. 接线

`EditorViewer.tsx` 的 extensions 数组中加入 `wikiLinkComplete`(紧挨 `taskFieldComplete`)。

### 3. 别名解析(让 `[[别名]]` 端到端可用:跳转 + 反链)

一处改动、多处复用,统一走 `resolveLink`:

- `backlinks.ts` 新增 `buildAliasIndex(files): Map<aliasLower, path[]>`(别名小写为 key,值为拥有该别名的文件路径列表),并仿现有 `getStemIndex` / `invalidateStemIndex` 提供缓存 `getAliasIndex()` 与失效 `invalidateAliasIndex()`,与 stem 索引同生命周期(重建/重索引时一并失效)。
- `resolveLink(target, stemIndex, files, aliasIndex?)`:新增可选参 `aliasIndex`。stem 匹配失败时,查 alias 索引(**唯一命中**才返回真实 path,多义则不命中)。大小写不敏感(查表前 target 转小写)。
- 在所有 `resolveLink` 调用点传入 `getAliasIndex()`:
  - `EditorViewer.tsx:186`(点击跳转);
  - `pluginRegistry.ts:352`(插件 API `vault.resolveLink`);
  - `buildLinkMaps`(`backlinks.ts:39`,反链构建)—— 使 `[[别名]]` 以**真实路径**落进 `backlinkMap`,反链面板自动生效。
- 既然别名链接现在能正确进 `backlinkMap`,删除 `pluginRegistry.ts:338-339` 的 `${alias}.md` 空转聚合(现已不工作,改完也用不上)。

## 数据流

输入 `[[` → CM6 触发候选源 → 从响应式 `vaultStore.files` 构建文件名+别名候选(带 mtime boost) → CM6 模糊过滤/排序 → 候选框展示 → 选中插入 `[[名称]]` + 补 `]]` → 点击跳转时 `resolveLink` 经 stem 或 alias 索引命中真实文件 → 反链构建同样经 alias 索引,反链面板一致显示。

## 测试

- `src/lib/cm6/__tests__/wikiLinkComplete.test.ts`(用 `CompletionContext`,参照 `listsField.test.ts`):
  - 触发条件:`[[` 命中;`[[a|` 之后不触发;跨行不触发;非 `[[`(单 `[`)不触发。
  - 候选包含文件名候选与别名候选;别名候选带 `detail`=文件名。
  - boost 随 mtime:较新文件的候选 boost 更高(近期靠前)。
  - `apply`:插入名称后补 `]]` 且光标落在 `]]` 之后;后面已有 `]]` 时不重复补。
- `src/lib/__tests__/wikiLinkParser.test.ts` 或 backlinks 相关测试增补 alias 解析:
  - alias 唯一命中 → 返回真实 path;
  - alias 多义 → 不命中(返回 null);
  - 大小写不敏感命中;
  - stem 命中优先于 alias(stem 存在时不走 alias 回退)。

## 性能

候选集合每次触发从 `vaultStore.files` 现算(`Object.values` + flatMap + map)。几千文件量级通常 <5ms;`validFor` 让后续按键复用候选集,不重跑。先不做候选缓存(YAGNI),若日后卡顿再加版本号缓存。alias 索引按 `getStemIndex` 同款惰性缓存,避免每次解析重建。

## 不做(YAGNI)

- 不做候选项缩略图/预览。
- 不做跨 `|` 竖线后的「显示名」补全。
- 不做模糊匹配高亮以外的自定义排序 UI。
