declare module "picocolors" {
  interface Formatter {
    (value: string | number | boolean | null | undefined): string;
  }

  interface PicoColors {
    red: Formatter;
    green: Formatter;
    yellow: Formatter;
  }

  const picocolors: PicoColors;

  export default picocolors;
}
