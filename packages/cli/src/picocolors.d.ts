declare module "picocolors" {
  interface Formatter {
    (value: string | number | boolean | null | undefined): string;
  }

  interface PicoColors {
    red: Formatter;
    green: Formatter;
  }

  const picocolors: PicoColors;

  export default picocolors;
}
