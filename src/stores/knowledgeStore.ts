import { createStore } from 'solid-js/store'

export interface FileMetadata {
  path: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
}

export interface KnowledgeState {
  index: Record<string, FileMetadata>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  isIndexing: boolean
}

const [knowledgeStore, setKnowledgeStore] = createStore<KnowledgeState>({
  index: {},
  backlinkMap: {},
  tagMap: {},
  isIndexing: false,
})

export { knowledgeStore, setKnowledgeStore }
