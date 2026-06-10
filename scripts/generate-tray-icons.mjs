import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcTauriDir = join(rootDir, 'src-tauri');
const iconsDir = join(srcTauriDir, 'icons');

const trayIcons = [
  { input: 'tray-icon-dark.svg', output: 'tray-dark.png', label: 'Dark theme (white P)' },
  { input: 'tray-icon-light.svg', output: 'tray-light.png', label: 'Light theme (black P)' },
];

async function generateTrayIcons() {
  console.log('Generating tray icons...\n');
  
  for (const { input, output, label } of trayIcons) {
    const inputPath = join(srcTauriDir, input);
    const outputPath = join(iconsDir, output);
    
    try {
      const svgBuffer = readFileSync(inputPath);
      
      await sharp(svgBuffer)
        .resize(32, 32)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${output} (${label})`);
      console.log(`  Input:  ${inputPath}`);
      console.log(`  Output: ${outputPath}\n`);
    } catch (error) {
      console.error(`✗ Failed to generate ${output}:`, error.message);
      process.exit(1);
    }
  }
  
  console.log('✓ All tray icons generated successfully!');
}

generateTrayIcons();
