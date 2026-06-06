import { For } from "solid-js";
import {
  dismissToast,
  toastStore,
  type ToastLevel,
} from "../stores/toastStore";

const LEVEL: Record<ToastLevel, { border: string; icon: string }> = {
  info: { border: "var(--accent)", icon: "" },
  error: { border: "#e05252", icon: "!" },
  warn: { border: "#d4943a", icon: "△" },
};

export function ToastContainer() {
  return (
    <div
      class="fixed top-3 right-3 z-[9999] flex flex-col gap-2 pointer-events-none"
      style={{ "max-width": "300px", "min-width": "180px" }}
    >
      <For each={toastStore.items}>
        {(toast) => {
          const lv = LEVEL[toast.level];
          return (
            <div
              class="pointer-events-auto flex items-start gap-2 px-3 py-2 rounded text-[11px] leading-relaxed text-(--text) bg-(--bg-elevated) border border-(--border-2) shadow-lg"
              style={{
                "border-left": `3px solid ${lv.border}`,
                animation: "toast-in 0.18s ease-out",
              }}
              role="alert"
            >
              {lv.icon && (
                <span
                  class="shrink-0 font-bold mt-px text-[10px]"
                  style={{ color: lv.border }}
                >
                  {lv.icon}
                </span>
              )}
              <span class="flex-1 break-words">{toast.msg}</span>
              <button
                class="shrink-0 text-(--text-3) hover:text-(--text) text-[14px] leading-none mt-[-1px] transition-colors"
                onClick={() => dismissToast(toast.id)}
                title="关闭"
              >
                ×
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
