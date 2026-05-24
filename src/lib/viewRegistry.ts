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

export type ViewDef = FileViewDef | PageViewDef

const registry = new Map<string, ViewDef>()

export function registerView(def: ViewDef): void {
  registry.set(def.type, def)
}

export function getView(type: string): ViewDef | undefined {
  return registry.get(type)
}

export function getFileViewForExt(ext: string): FileViewDef | undefined {
  for (const def of registry.values()) {
    if (def.kind === 'file' && def.canAcceptFile(ext)) return def as FileViewDef
  }
  return undefined
}

export function _clearRegistryForTest(): void {
  registry.clear()
}
