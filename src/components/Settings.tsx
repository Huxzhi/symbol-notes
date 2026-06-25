import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";
import { settingsActions, settingsStore } from "../stores/settingsStore";
import { vaultFs } from "../vault";
import { vaultConfigActions } from "../vault/lifecycle";
import { vaultConfigMeta } from "../vault/vaultConfig";
import { getRegisteredPlugins } from "../lib/pluginRegistry";
import { getSettingsTabs } from "../lib/pluginRegistry";
import {
  PRESET_THEMES,
  THEME_VARS,
  snapshotTheme,
  type ThemeMode,
} from "../lib/theme";

const BUILTIN_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "files", label: "文件" },
  { id: "vault", label: "Vault 配置" },
  { id: "shortcuts", label: "快捷键" },
  { id: "plugins", label: "插件" },
];

// <input type=color> 只接受 #rrggbb；非 hex（如 color-mix/rgb）回退到中性灰避免控件报错
function normalizeHex(v: string | undefined): string {
  const s = v?.trim() ?? "";
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const h = s.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return "#888888";
}

const SHORTCUTS = [
  { keys: "Ctrl / ⌘  S", desc: "保存文件" },
  { keys: "Ctrl / ⌘  Z", desc: "撤销" },
  { keys: "Ctrl / ⌘  Shift Z", desc: "重做" },
  { keys: "Ctrl / ⌘  B", desc: "加粗" },
  { keys: "Ctrl / ⌘  I", desc: "斜体" },
];

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      class="relative shrink-0"
      onClick={() => props.onChange(!props.checked)}
    >
      <div
        class={`w-9 h-5 rounded-full transition-colors cursor-pointer ${props.checked ? "bg-(--accent)" : "bg-(--bg-active)"}`}
      />
      <div
        class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform pointer-events-none ${props.checked ? "translate-x-4" : ""}`}
      />
    </div>
  );
}

export function Settings(props: { onClose(): void }) {
  const [section, setSection] = createSignal("appearance");
  const [draftCSS, setDraftCSS] = createSignal(settingsStore.customCSS);
  const [draftAutoTs, setDraftAutoTs] = createSignal(
    settingsStore.autoTimestamps,
  );
  const [draftShowOtherFiles, setDraftShowOtherFiles] = createSignal(
    settingsStore.showOtherFiles,
  );
  const [draftConfigPath, setDraftConfigPath] = createSignal(
    vaultConfigMeta().path,
  );
  const configStatusLabel = () => {
    if (!vaultFs()) return "未打开 vault";
    switch (vaultConfigMeta().status) {
      case "active":
        return "已启用";
      case "declined":
        return "已拒绝（仅内存，不落盘）";
      default:
        return "未启用";
    }
  };

  // 取消回滚：进入设置时快照已提交的主题态
  const themeSnapshot = {
    theme: settingsStore.theme,
    customThemes: JSON.parse(
      JSON.stringify(settingsStore.customThemes),
    ) as typeof settingsStore.customThemes,
  };

  const presetById = (id: string) => PRESET_THEMES.find((p) => p.id === id);
  const customById = (id: string) =>
    settingsStore.customThemes.find((c) => c.id === id);
  const selected = () => settingsStore.theme;
  const selectedCustom = () => customById(selected());

  const currentMode = (): ThemeMode => {
    const c = customById(selected());
    if (c) return c.mode;
    return presetById(selected())?.mode ?? "dark";
  };

  // 统一的卡片数据：预设用静态 swatch；自定义从 vars 推导
  type Card = { id: string; label: string; sub: string; swatch: string[] };
  const customSwatch = (vars: Record<string, string>) =>
    ["--bg-base", "--accent", "--link", "--text"].map((n) => vars[n] ?? "#888");
  const cardsFor = (mode: ThemeMode): Card[] => [
    ...PRESET_THEMES.filter((p) => p.mode === mode).map((p) => ({
      id: p.id,
      label: p.label,
      sub: p.sub,
      swatch: p.swatch,
    })),
    ...settingsStore.customThemes
      .filter((c) => c.mode === mode)
      .map((c) => ({
        id: c.id,
        label: c.name,
        sub: "自定义",
        swatch: customSwatch(c.vars),
      })),
  ];

  const newCustomTheme = () => {
    const id = settingsActions.addCustomTheme(
      selected(),
      currentMode(),
      snapshotTheme(),
    );
    settingsActions.setTheme(id);
  };

  const close = props.onClose;

  // 应用：提交非主题草稿后关闭（主题已实时写入并持久化）
  const apply = () => {
    settingsActions.setCustomCSS(draftCSS());
    settingsActions.setAutoTimestamps(draftAutoTs());
    settingsActions.setShowOtherFiles(draftShowOtherFiles());
    close();
  };

  // 取消：把主题态回滚到进入时的快照后关闭
  const cancel = () => {
    settingsActions.setCustomThemes(themeSnapshot.customThemes);
    settingsActions.setTheme(themeSnapshot.theme);
    close();
  };

  const pluginTabs = () => getSettingsTabs();
  const isPluginTab = () => pluginTabs().some((t) => t.pluginId === section());

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div class="bg-elevated border b-theme rounded-lg w-145 max-w-[92vw] max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-(--border)] shrink-0">
          <h2 class="text-[14px] font-semibold t-base">设置</h2>
          <button
            class="w-6 h-6 flex items-center justify-center rounded text-[13px] text-(--text-3) cursor-pointer transition-[background,color] duration-150 hover:bg-(--bg-hover) hover:text-(--text)"
            onClick={cancel}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div class="flex flex-1 overflow-hidden min-h-0">
          {/* Left nav */}
          <div class="w-28 shrink-0 border-r border-(--border) py-2 overflow-y-auto">
            <For each={BUILTIN_SECTIONS}>
              {(s) => (
                <button
                  class={`w-full text-left px-4 py-2 text-[12px] cursor-pointer transition-colors ${section() === s.id ? "text-(--accent) bg-(--accent-bg) font-medium" : "t-2 hover:bg-(--bg-hover)"}`}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              )}
            </For>

            <Show when={pluginTabs().length > 0}>
              <div class="text-[10px] t-4 px-4 pt-3 pb-1 uppercase tracking-widest">
                插件设置
              </div>
              <For each={pluginTabs()}>
                {(tab) => (
                  <button
                    class={`w-full text-left px-4 py-2 text-[12px] cursor-pointer transition-colors ${section() === tab.pluginId ? "text-(--accent) bg-(--accent-bg) font-medium" : "t-2 hover:bg-(--bg-hover)"}`}
                    onClick={() => setSection(tab.pluginId)}
                  >
                    {tab.name}
                  </button>
                )}
              </For>
            </Show>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto p-5 min-w-0">
            <Switch>
              <Match when={section() === "appearance"}>
                <For each={["light", "dark"] as ThemeMode[]}>
                  {(mode) => (
                    <>
                      <div class="text-[10px] t-3 mb-2.5 uppercase tracking-widest">
                        {mode === "light" ? "浅色" : "深色"}
                      </div>
                      <div class="flex flex-wrap gap-2 mb-4">
                        <For each={cardsFor(mode)}>
                          {(t) => (
                            <button
                              class={`w-[104px] rounded-lg border-2 p-3 cursor-pointer transition-colors text-center ${selected() === t.id ? "border-(--accent) bg-(--accent-bg)" : "border-(--border) hover:border-(--border-2)"}`}
                              onClick={() => settingsActions.setTheme(t.id)}
                            >
                              <div class="flex gap-1 mb-2 justify-center">
                                <For each={t.swatch}>
                                  {(c) => (
                                    <div
                                      class="w-4 h-4 rounded-full border border-white/10"
                                      style={{ background: c }}
                                    />
                                  )}
                                </For>
                              </div>
                              <div
                                class={`text-[12px] font-medium truncate ${selected() === t.id ? "text-(--accent)" : "t-base"}`}
                              >
                                {t.label}
                              </div>
                              <div class="text-[10px] t-3">{t.sub}</div>
                            </button>
                          )}
                        </For>
                        <Show when={mode === currentMode()}>
                          <button
                            class="w-[104px] rounded-lg border-2 border-dashed border-(--border-2) p-3 cursor-pointer text-(--text-3) hover:border-(--accent) hover:text-(--accent) transition-colors text-[12px]"
                            onClick={newCustomTheme}
                          >
                            + 新建自定义
                          </button>
                        </Show>
                      </div>
                    </>
                  )}
                </For>

                {/* 颜色编辑器：仅自定义主题可编辑 */}
                <Show when={selectedCustom()}>
                  {(theme) => (
                    <div class="mt-1 mb-5">
                      <div class="flex items-center gap-2 mb-3">
                        <input
                          class="flex-1 bg-(--bg-base) border border-(--border) rounded px-2 py-1 text-[12px] t-base outline-none focus:border-(--accent)"
                          value={theme().name}
                          onInput={(e) =>
                            settingsActions.renameCustomTheme(
                              theme().id,
                              e.currentTarget.value,
                            )
                          }
                        />
                        <button
                          class="px-2.5 py-1 text-[11px] rounded border border-(--border) text-(--text-3) hover:text-(--accent) hover:border-(--accent) transition-colors cursor-pointer"
                          onClick={() =>
                            settingsActions.deleteCustomTheme(theme().id)
                          }
                        >
                          删除
                        </button>
                      </div>
                      <For each={[...new Set(THEME_VARS.map((v) => v.group))]}>
                        {(group) => (
                          <div class="mb-3">
                            <div class="text-[10px] t-3 mb-1.5 uppercase tracking-widest">
                              {group}
                            </div>
                            <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              <For
                                each={THEME_VARS.filter(
                                  (v) => v.group === group,
                                )}
                              >
                                {(v) => (
                                  <div class="flex items-center gap-2">
                                    <input
                                      type="color"
                                      class="w-6 h-6 shrink-0 rounded cursor-pointer bg-transparent border border-(--border)"
                                      value={normalizeHex(theme().vars[v.name])}
                                      onInput={(e) =>
                                        settingsActions.updateCustomThemeVar(
                                          theme().id,
                                          v.name,
                                          e.currentTarget.value,
                                        )
                                      }
                                    />
                                    <span class="text-[11px] t-2 w-16 shrink-0">
                                      {v.label}
                                    </span>
                                    <input
                                      class="flex-1 min-w-0 bg-(--bg-base) border border-(--border) rounded px-1.5 py-0.5 text-[11px] t-base font-mono outline-none focus:border-(--accent)"
                                      value={theme().vars[v.name] ?? ""}
                                      onChange={(e) =>
                                        settingsActions.updateCustomThemeVar(
                                          theme().id,
                                          v.name,
                                          e.currentTarget.value,
                                        )
                                      }
                                    />
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>

                <div class="text-[10px] t-3 mb-2 uppercase tracking-widest">
                  自定义 CSS
                </div>
                <textarea
                  class="w-full h-36 bg-(--bg-base) border border-(--border)] rounded p-2.5 text-[12px] t-base font-mono resize-none outline-none transition-colors focus:border-(--accent)"
                  placeholder="/* 在此输入自定义 CSS */"
                  value={draftCSS()}
                  onInput={(e) => setDraftCSS(e.currentTarget.value)}
                  spellcheck={false}
                />
              </Match>

              <Match when={section() === "files"}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  自动时间戳
                </div>
                <label class="flex items-start gap-3 cursor-pointer select-none">
                  <div class="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      class="sr-only"
                      checked={draftAutoTs()}
                      onChange={(e) => setDraftAutoTs(e.currentTarget.checked)}
                    />
                    <div
                      class={`w-9 h-5 rounded-full transition-colors ${draftAutoTs() ? "bg-(--accent)" : "bg-(--bg-active)"}`}
                    />
                    <div
                      class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${draftAutoTs() ? "translate-x-4" : ""}`}
                    />
                  </div>
                  <div>
                    <div class="text-[13px] t-base font-medium">
                      启用自动时间戳
                    </div>
                    <div class="text-[11px] t-3 mt-1 leading-relaxed">
                      打开文件时若缺少{" "}
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        created
                      </code>{" "}
                      或
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        updated
                      </code>{" "}
                      字段则自动写入；每次保存时更新
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        updated
                      </code>{" "}
                      为当前时间。
                    </div>
                    <div class="text-[11px] t-3 mt-1">
                      格式：
                      <code class="bg-(--bg-hover) px-1 rounded text-[10px]">
                        YYYY-MM-DD HH:mm
                      </code>
                    </div>
                    <Show when={draftAutoTs()}>
                      <div class="text-[10px] t-3 mt-2 leading-relaxed border-l-2 border-(--border-2) pl-2">
                        注：浏览器 API 仅暴露文件的修改时间，
                        <code class="text-(--text-3)">created</code>{" "}
                        字段将以文件的最后修改时间作为初始值。
                      </div>
                    </Show>
                  </div>
                </label>
                <div class="mt-5 mb-3 text-[10px] t-3 uppercase tracking-widest">
                  文件树
                </div>
                <label class="flex items-start gap-3 cursor-pointer select-none">
                  <div class="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      class="sr-only"
                      checked={draftShowOtherFiles()}
                      onChange={(e) =>
                        setDraftShowOtherFiles(e.currentTarget.checked)
                      }
                    />
                    <div
                      class={`w-9 h-5 rounded-full transition-colors ${draftShowOtherFiles() ? "bg-(--accent)" : "bg-(--bg-active)"}`}
                    />
                    <div
                      class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${draftShowOtherFiles() ? "translate-x-4" : ""}`}
                    />
                  </div>
                  <div>
                    <div class="text-[13px] t-base font-medium">
                      显示附件文件
                    </div>
                    <div class="text-[11px] t-3 mt-1 leading-relaxed">
                      在文件树中显示图片、PDF 等非 Markdown 文件。关闭后仅显示{" "}
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        .md
                      </code>{" "}
                      文件。
                    </div>
                  </div>
                </label>
              </Match>

              <Match when={section() === "vault"}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  Vault 配置文件夹
                </div>
                <div class="text-[12px] t-base mb-2">
                  状态：<span class="t-2">{configStatusLabel()}</span>
                </div>
                <div class="text-[11px] t-3 mb-4 leading-relaxed">
                  布局与设置保存在 vault 顶层的隐藏文件夹中（默认{" "}
                  <code class="bg-(--bg-hover) px-1 rounded text-[10px]">
                    .symbol-notes
                  </code>
                  ）。点开头的文件夹不会出现在文件树中。
                </div>

                <div class="text-[10px] t-3 mb-1.5 uppercase tracking-widest">
                  相对路径
                </div>
                <div class="flex items-center gap-2 mb-4">
                  <input
                    class="flex-1 bg-(--bg-base) border border-(--border) rounded px-2 py-1 text-[12px] t-base font-mono outline-none focus:border-(--accent)"
                    value={draftConfigPath()}
                    disabled={!vaultFs()}
                    onInput={(e) => setDraftConfigPath(e.currentTarget.value)}
                  />
                  <button
                    class="px-3 py-1 text-[12px] rounded bg-(--accent) text-white cursor-pointer hover:bg-(--accent-2) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!vaultFs() || !draftConfigPath().trim()}
                    onClick={() =>
                      void vaultConfigActions.setPath(draftConfigPath().trim())
                    }
                  >
                    应用路径
                  </button>
                </div>

                <Show when={vaultFs() && vaultConfigMeta().status !== "active"}>
                  <button
                    class="px-3 py-1.5 text-[12px] rounded border border-(--border) t-2 cursor-pointer hover:border-(--accent) hover:text-(--accent) transition-colors"
                    onClick={() => void vaultConfigActions.enable()}
                  >
                    启用配置文件夹
                  </button>
                </Show>
              </Match>

              <Match when={section() === "shortcuts"}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  键盘快捷键
                </div>
                <div>
                  <For each={SHORTCUTS}>
                    {(s) => (
                      <div class="flex items-center justify-between py-2 border-b border-(--border)]">
                        <span class="text-[12px] t-base">{s.desc}</span>
                        <kbd class="text-[11px] t-2 bg-(--bg-hover) border border-(--border)] px-2 py-0.5 rounded font-mono">
                          {s.keys}
                        </kbd>
                      </div>
                    )}
                  </For>
                </div>
                <div class="text-[10px] t-3 mt-4">
                  自定义快捷键功能即将支持。
                </div>
              </Match>

              <Match when={section() === "plugins"}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  已安装插件
                </div>
                <div class="flex flex-col gap-1">
                  <For each={getRegisteredPlugins()}>
                    {(plugin) => (
                      <div class="flex items-center justify-between py-2.5 border-b border-(--border)]">
                        <div>
                          <div class="text-[13px] t-base font-medium">
                            {plugin.name}
                          </div>
                          <Show when={plugin.description}>
                            <div class="text-[11px] t-3 mt-0.5">
                              {plugin.description}
                            </div>
                          </Show>
                        </div>
                        <Show
                          when={!plugin.core}
                          fallback={<span class="text-[10px] t-4">核心</span>}
                        >
                          <Toggle
                            checked={
                              settingsStore.pluginStates[plugin.id] ??
                              plugin.defaultEnabled ??
                              true
                            }
                            onChange={(v) =>
                              settingsActions.setPluginState(plugin.id, v)
                            }
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                  <Show when={getRegisteredPlugins().length === 0}>
                    <div class="text-[11px] t-4 italic py-2">暂无插件</div>
                  </Show>
                </div>
              </Match>

              {/* Plugin settings tabs */}
              <For each={pluginTabs()}>
                {(tab) => (
                  <Match when={section() === tab.pluginId}>
                    <Dynamic
                      component={tab.component}
                      getConfig={tab.getConfig.bind(tab)}
                      setConfig={tab.setConfig.bind(tab)}
                    />
                  </Match>
                )}
              </For>
            </Switch>
          </div>
        </div>

        {/* Footer — hidden for plugin settings tabs (they save immediately) */}
        <Show when={!isPluginTab()}>
          <div class="flex justify-end gap-2 px-5 py-3 border-t border-(--border)] shrink-0">
            <button
              class="px-4 py-1.5 text-[12px] rounded border border-(--border)] text-(--text-3) cursor-pointer transition-[background,color] duration-150 hover:bg-(--bg-hover) hover:text-(--text)"
              onClick={cancel}
            >
              取消
            </button>
            <button
              class="px-4 py-1.5 text-[12px] rounded bg-(--accent) text-white cursor-pointer hover:bg-(--accent-2) transition-colors"
              onClick={apply}
            >
              应用
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
