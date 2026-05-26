export type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { separator: true }

type ItemFactory = (dataset: DOMStringMap) => MenuItem[]

const registry = new Map<string, ItemFactory>()

export function registerContextMenu(type: string, factory: ItemFactory): void {
  registry.set(type, factory)
}

export function getMenuItems(type: string, dataset: DOMStringMap): MenuItem[] {
  return registry.get(type)?.(dataset) ?? []
}

export function _resetForTest(): void {
  registry.clear()
}
