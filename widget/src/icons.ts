import { svg, type SVGTemplateResult } from "lit";

/** Dolphin mark (research/design/dolphin.svg#dolphin), viewBox 0 0 191.9 115.1. The eye is an evenodd hole. */
export const DOLPHIN_D =
  "M185.9 86.6C184.5 80.9 180.5 74.5 176.2 69.7C177.5 60.7 173 50.6 161.4 42.1C147.5 34.5 132.2 30.4 120 30.6C118.3 22.3 111 11.9 97.1 6C102.9 15.8 103.1 23.8 100.9 33.9C85.4 39.4 63.6 51.5 49.2 65C45.1 69.9 40.2 73.3 37 75.7C27.1 73.6 15.2 74 6 78.2C18 79.7 26.7 82.3 32.3 85.2C33.9 92.1 38.8 101.5 42.8 109.1C42.2 97.9 41.8 87.4 43.5 80.8C58.4 73.6 80.3 71.2 102.2 67.8C109 67.8 115.8 68.3 121.1 68C118.3 74.7 112.9 82.1 106.9 87.8C115.5 84.4 124.2 77.8 133.1 69.8C146.2 70.4 161.2 73.9 173.1 80.1C178.2 83.1 181.7 85.1 185.9 86.6ZM170.5 62.1a2.7 2.7 0 1 0 .01 0Z";
/** Tail fluke (dolphin.svg#fluke), viewBox 0 0 100 100. */
export const FLUKE_D =
  "M46.5 86C46.6 76 46 66 44.6 58.5C33 57 17.5 48.5 9 29C20 34 33 36.5 42 38C46 38.8 48.5 41 50 44C51.5 41 54 38.8 58 38C67 36.5 80 34 91 29C82.5 48.5 67 57 55.4 58.5C54 66 53.4 76 53.5 86Z";
/** Ethereum diamond, viewBox 0 0 24 24. */
const ETH_D = "M12 2 5.5 12.3 12 16l6.5-3.7L12 2Zm0 15.3-6.5-3.7L12 22l6.5-8.4-6.5 3.7Z";

const stroke = (d: string, w = 2) =>
  svg`<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width=${w} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d}/></svg>`;

export const icons = {
  chevron: stroke("m6 9 6 6 6-6"),
  search: stroke("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.35-4.35"),
  close: stroke("M18 6 6 18M6 6l12 12"),
  arrowDown: stroke("M12 5v14M6 13l6 6 6-6", 2.6),
  external: stroke("M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5", 1.8),
  wallet: stroke("M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4m0 4v2a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6m18 7h-4a2 2 0 0 0 0 4h4v-4Z", 1.8),
  check: svg`<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M12 1.5 14.6 3.4l3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1L12 1.5Z"/><path d="m7.8 12.2 2.8 2.8 5.6-5.8" fill="none" stroke="var(--_bg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  eth: svg`<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d=${ETH_D}/></svg>`,
} satisfies Record<string, SVGTemplateResult>;

/** The dolphin as an inline mark (header, $FLIPPER avatar). */
export const dolphin = (fill = "currentColor") =>
  svg`<svg viewBox="0 0 191.9 115.1" width="100%" height="100%" aria-hidden="true"><path fill=${fill} fill-rule="evenodd" d=${DOLPHIN_D}/></svg>`;
