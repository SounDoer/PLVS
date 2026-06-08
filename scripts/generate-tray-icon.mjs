import sharp from "sharp";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dir, "../src-tauri/icons/tray.png");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <line x1="5" y1="2" x2="5" y2="18" stroke="black" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M5 2 Q15.5 2 15.5 7 Q15.5 12 5 12" stroke="black" stroke-width="1.5" fill="none" stroke-linecap="round"/>
</svg>`;

await sharp(Buffer.from(svg))
  .resize(44, 44)
  .png()
  .toFile(outPath);

console.log(`Written: ${outPath}`);
