declare module 'asciichart' {
  interface PlotOptions {
    height?: number;
    width?: number;
    offset?: number;
    padding?: string;
    format?: (x: number) => string;
  }

  function plot(series: number[] | number[][], options?: PlotOptions): string;

  export default { plot };
  export { plot };
}
