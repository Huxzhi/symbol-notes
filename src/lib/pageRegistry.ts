// Register new page types here — TabBar and App router pick them up automatically.
export interface PageDef {
  id: string
  label: string
}

export const PAGES: PageDef[] = [
  { id: 'calendar', label: '日历' },
  // { id: 'graph',    label: '图谱' },
]

export const PAGE_MAP: Record<string, PageDef> = Object.fromEntries(
  PAGES.map(p => [p.id, p]),
)
