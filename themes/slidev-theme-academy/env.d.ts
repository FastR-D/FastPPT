/// <reference types="vite/client" />

declare module '*.css'
declare module 'plotly.js-dist' {
  export type PlotlyHTMLElement = HTMLElement

  export interface PlotlyStatic {
    newPlot(
      root: HTMLElement,
      data: unknown,
      layout?: unknown,
      config?: unknown,
    ): Promise<PlotlyHTMLElement>
    react(
      root: HTMLElement,
      data: unknown,
      layout: unknown,
      config: unknown,
    ): Promise<PlotlyHTMLElement>
    purge(root: HTMLElement): void
    Plots: {
      resize(root: HTMLElement): Promise<void>
    }
  }

  const Plotly: PlotlyStatic
  export default Plotly
}
