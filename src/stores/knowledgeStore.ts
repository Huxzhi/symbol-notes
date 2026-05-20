import { createStore } from 'solid-js/store'

export interface FileMetadata {
  path: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
}

export interface KnowledgeState {
  index: Record<string, FileMetadata>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
}

const [knowledgeStore, setKnowledgeStore] = createStore<KnowledgeState>({
  index: {},
  backlinkMap: {},
  tagMap: {},
})

export { knowledgeStore, setKnowledgeStore }
