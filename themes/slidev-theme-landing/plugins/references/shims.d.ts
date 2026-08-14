declare module '@citation-js/core' {
  interface BibliographyOptions {
    format: 'text'
    template: string
    lang: string
  }

  interface CitationInstance {
    format(kind: 'bibliography', options: BibliographyOptions): string
  }

  export const Cite: {
    async(input: string): Promise<CitationInstance>
  }
}
declare module '@citation-js/plugin-doi'
