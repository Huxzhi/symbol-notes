import { Show, For } from "solid-js";
import { modalStore } from "../stores/modalStore";
import type { ModalButton } from "../stores/modalStore";

const VARIANT: Record<NonNullable<ModalButton["variant"]>, string> = {
  primary: "border-(--accent) text-(--accent) hover:bg-(--accent)/10",
  danger: "border-[#e05252] text-[#e05252] hover:bg-[#e05252]/10",
  ghost: "border-(--border-2) text-(--text-3) hover:text-(--text)",
};

export function ConfirmModal() {
  return (
    <Show when={modalStore.open}>
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.55)" }}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl p-5 flex flex-col gap-4"
          style={{ "min-width": "300px", "max-width": "440px" }}
        >
          <div class="flex flex-col gap-1">
            <h2 class="text-[15px] font-semibold text-(--text)">
              {modalStore.title}
            </h2>
            <p class="text-[13px] text-(--text-2) leading-relaxed">
              {modalStore.message}
            </p>
          </div>
          <div class="flex justify-end gap-2 flex-wrap">
            <For each={modalStore.buttons}>
              {(btn) => (
                <button
                  class={`px-3 py-1.5 text-[13px] rounded border transition-colors ${VARIANT[btn.variant ?? "ghost"]}`}
                  onClick={btn.onClick}
                >
                  {btn.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
