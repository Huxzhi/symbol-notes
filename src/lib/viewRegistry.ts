import { createSignal } from 'solid-js'
import type { Component } from 'solid-js'
import type { JSX } from 'solid-js'
import type { ViewComponentProps } from '../stores/types'

export interface FileViewDef {
  kind: 'file'
  type: string
  getDisplayText(path: string): string
  getIcon?(): JSX.Element
  canAcceptFile(ext: string): boolean
  component: Component<ViewComponentProps>
}

export interface PageViewDef {
  kind: 'page'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<ViewComponentProps>
}

export interface PanelViewDef {
  kind: 'panel'
  position: 'left' | 'right'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<ViewComponentProps>
  onLeafOpen?(leafId: string): void
  onLeafClose?(leafId: string): void
}

export type ViewDef = FileViewDef | PageViewDef | PanelViewDef

const [_registry, setRegistry] = createSignal(new Map<string, ViewDef>())

export function registerView(def: ViewDef): void {
  setRegistry(m => new Map(m).set(def.type, def))
}

export function unregisterView(type: string): void {
  setRegistry(m => { const n = new Map(m); n.delete(type); return n })
}

export function getView(type: string): ViewDef | undefined {
  return _registry().get(type)
}

export function getFileViewForExt(ext: string): FileViewDef | undefined {
  for (const def of _registry().values()) {
    if (def.kind === 'file' && def.canAcceptFile(ext)) return def as FileViewDef
  }
  return undefined
}

export function getLeftPanelViews(): PanelViewDef[] {
  return [..._registry().values()].filter((d): d is PanelViewDef => d.kind === 'panel' && d.position === 'left')
}

export function getRightPanelViews(): PanelViewDef[] {
  return [..._registry().values()].filter((d): d is PanelViewDef => d.kind === 'panel' && d.position === 'right')
}

export function _clearRegistryForTest(): void {
  setRegistry(new Map())
}
