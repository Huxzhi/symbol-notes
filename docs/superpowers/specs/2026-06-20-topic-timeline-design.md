# 主题时间线（Topic Timeline）设计

日期：2026-06-20
状态：设计已确认，待写实现计划

## 背景与动机

应用已有双向链接 + 知识图谱能力，但缺少「关系可视化」。常见的力导向节点-连线图（两个球一条线）阅读性差、容易糊成毛线。用户想要一种更有**叙事感**的方式，看「一个主题/项目是怎么一步步长出来的」，并顺带把相关笔记里的内容（尤其图片）聚合起来。

经探索对比四个方向（主题时间线 / 活动热力图 / 内容墙 / 邻接矩阵），用户选定**主题时间线**：它一口气覆盖了「修改过程」与「内容汇总」两个诉求，且最贴合"项目演进"的直觉。

## 现实约束（重要）

项目**没有笔记历史版本**。`leafHistory.ts` 是标签页导航历史，与笔记内容版本无关。每篇笔记从 `FileMeta` 能拿到的时间信息只有：

- `created`（YYYY-MM-DD，创建日，恒非空）
- `updated`（YYYY-MM-DD 或 null，最后更新日）
- `mtime`（最后修改时间戳）

也就是**最多两个时间点**，不是逐次编辑的流水。因此「某时刻加了哪条双链」这类事件，用现有数据**推不出来**——我们只知道一篇笔记*当前*链到哪些，不知道这条链*哪天加的*。

**决策**：v1 用现有数据落地；但渲染数据按「事件流」抽象设计，将来若接入快照日志（每次保存记录链接集 + hash），可作为新事件源 append 进来，渲染层不需重写。

## 目标

- 以某篇笔记为中心，把相关笔记沿时间轴铺开，呈现"项目演进"的叙事。
- 卡片顺带聚合内容（首图缩略、首段摘要、标签、链接数），覆盖"图片/内容汇总"诉求。
- 纯前端、零新增后端假设；复用现有 `vaultStore` 索引，不新建跨文件索引。

## 非目标（v1 不做）

- 标签入口、文件夹入口（抽象预留，留待 v1.1）。
- 快照/历史日志（结构预留，留待后续）。
- 多泳道、连线智能布线、跨主题对比。

## 设计

### 1. 形态与落点

新插件 `src/plugins/timeline/`，通过 `definePlugin` 注册一个 **`page` 视图**（非 panel）。理由：时间线需要纵向铺开的空间，且属"回顾/探索"性质，不是常驻侧栏。

入口（v1）：

- 笔记右键菜单 →「在时间线中查看」（以这篇为焦点）。
- 命令面板 / Ribbon 图标 → 打开后选一个焦点笔记。

插件只经 `PluginContext`（`ctx.vault` / `ctx.workspace`）协作，不直接 `setVaultStore`，不跨插件 import。注册的视图/菜单/ribbon 由 registry 在禁用时自动注销。

### 2. 选区抽象 + v1 入口

核心抽象：`Selection = (上下文) => string[]`（一组文件路径）。三种圈定方式（以笔记为中心 / 按标签 / 按文件夹）本质都是这个抽象的不同产生器。

v1 只实现**「以一篇笔记为中心」**产生器：

- 取焦点笔记的 `outLinks`（经现有链接解析得到目标路径）+ `backlinkMap[焦点]`。
- **1 跳邻域**（直接链接 + 反链）。1 跳是刻意的，避免整个 vault 顺链渗入糊成一片。
- 卡片上提供「展开邻居」按钮，按需把某个邻居再扩 1 跳。

标签（`tagMap`）/文件夹入口是同抽象的另两个产生器，v1.1 顺手加，不写死。

### 3. 数据来源 → 事件流

每篇笔记从 `FileMeta` 派生为 `TimelineEvent`：

```ts
type TimelineEvent = {
  path: string
  date: string             // 排序锚点 = created
  span?: [string, string]  // [created, updated]，画"生命期"；updated 为 null 时无 span
  title: string
  tags: string[]
  linkCount: number        // 该笔记在选区内的关联数
  thumbnail?: string       // 首图（若选做缩略，见开放项）
  snippet?: string         // 首段摘要
  kind: 'note'             // 预留：未来快照日志 → 'edit' | 'link-added' …
}
```

`deriveEvents(paths, files)` 是纯函数，输出按 `date` 升序排序。**这一层即为未来快照日志预留的接口**——以后多一个事件源把 `kind:'edit'` 之类的事件 append 进来即可，渲染层不改。

### 4. 视觉布局

纵向时间脊（top → down）：

- 左侧时间刻度；每篇笔记一张卡片落在其 `created` 日；画一条淡色"生命期"线延伸到 `updated`（无 `updated` 则只有点）。
- 卡片内容：标题 + 首图缩略（开放项）+ 首段摘要 + 标签 chip + 链接数。
- 焦点笔记与邻居之间画连线，**表示当前链接状态，不标注"哪天加的"**（诚实于数据）。
- 点击卡片打开对应笔记（经 `ctx.workspace`）。

### 5. 模块边界 / 文件落点

遵循三层职责 + 纯函数拆测：

```
src/plugins/timeline/
  index.tsx                    // definePlugin：注册 page 视图 + 右键菜单 + ribbon
  TimelineView.tsx             // Solid 组件，纯渲染 + 交互
  selection.ts                 // buildSelection(focus, files, backlinkMap) 纯函数
  events.ts                    // deriveEvents(paths, files) 纯函数
  __tests__/selection.test.ts
  __tests__/events.test.ts
```

每个单元职责单一：`selection` 只圈路径、`events` 只派生并排序、`TimelineView` 只渲染。改其一不影响其余。

### 6. 测试

纯逻辑走 vitest（node 环境）：

- `selection`：1 跳邻域圈定正确；outLinks 经链接解析得到正确路径；含未解析链接时的降级；焦点自身包含/去重。
- `events`：按 created 排序；span 计算；`updated` 为 null 时降级为无 span；选区内 linkCount 统计。

组件交互不强测（符合项目现状，测试覆盖纯逻辑）。

### 7. 错误与边界处理

- 焦点笔记无任何链接/反链：只显示焦点单卡，提示"暂无关联笔记"。
- 选区中出现已删除/未解析路径：跳过，不阻断渲染。
- `created` 缺失：`FileMeta.created` 恒非空（frontmatter.created → mtime 兜底），无需额外处理。

## 待用户在实现前可再调的开放项

1. 首发只做"以笔记为中心"是否足够，还是希望标签入口同期上。
2. `page` 全屏视图 vs 跟随当前笔记的右侧 `panel`。（当前定 page）
3. 卡片是否带首图缩略（涉及读图，稍重）。

> 已在设计评审中向用户确认整体方向，用户答复"可以"。以上开放项可在写实现计划时进一步收敛。
