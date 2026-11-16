// Fonts served from public/fonts/ (no network at render time). Same families, weights,
// styles and Latin character range as @remotion/google-fonts loaded before, so text
// renders identically. Rendering waits (delayRender) until every face is loaded.
import { continueRender, delayRender, staticFile } from "remotion";

const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const FACES: { family: string; file: string; weight: string; style: string }[] = [
  { family: "Anton", file: "anton-400.woff2", weight: "400", style: "normal" },
  { family: "Instrument Serif", file: "instrument-serif-400.woff2", weight: "400", style: "normal" },
  { family: "Instrument Serif", file: "instrument-serif-400-italic.woff2", weight: "400", style: "italic" },
  { family: "Inter", file: "inter-500.woff2", weight: "500", style: "normal" },
  { family: "Inter", file: "inter-600.woff2", weight: "600", style: "normal" },
  // Variable font (one file, all weights 400-900); used by the palace title style.
  { family: "Bodoni Moda", file: "bodoni-moda.woff2", weight: "400 900", style: "normal" },
  { family: "Bodoni Moda", file: "bodoni-moda-italic.woff2", weight: "400 900", style: "italic" },
  // Variable fonts for the spa look: a fine, airy serif and a thin geometric sans.
  { family: "Cormorant Garamond", file: "cormorant-garamond.woff2", weight: "300 700", style: "normal" },
  { family: "Cormorant Garamond", file: "cormorant-garamond-italic.woff2", weight: "300 700", style: "italic" },
  { family: "Jost", file: "jost.woff2", weight: "100 900", style: "normal" },
  // Variable handwriting font (400-700) for the hand title style (Artistic Village).
  { family: "Caveat", file: "caveat.woff2", weight: "400 700", style: "normal" },
  // Brush calligraphy faces for the ink title style (Mae Kampong).
  { family: "Ma Shan Zheng", file: "ma-shan-zheng-400.woff2", weight: "400", style: "normal" },
  { family: "Yuji Syuku", file: "yuji-syuku-400.woff2", weight: "400", style: "normal" },
];

export const anton = "Anton";
export const serif = "Instrument Serif";
export const sans = "Inter";
export const bodoni = "Bodoni Moda";
export const cormorant = "Cormorant Garamond";
export const jost = "Jost";
export const caveat = "Caveat";
export const brush = "Ma Shan Zheng";
export const brushSerif = "Yuji Syuku";

if (typeof document !== "undefined") {
  const handle = delayRender("Loading local fonts");
  Promise.all(
    FACES.map(async (f) => {
      const face = new FontFace(f.family, `url(${staticFile(`fonts/${f.file}`)}) format('woff2')`, { weight: f.weight, style: f.style, unicodeRange: LATIN });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => continueRender(handle))
    .catch((e) => {
      throw new Error(`local fonts failed to load: ${e}`);
    });
}
