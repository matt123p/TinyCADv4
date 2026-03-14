import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const sourceSvgPath = path.join(rootDir, 'images', 'TC Icons.svg');
const outputDir = path.join(rootDir, 'assets', 'appx');
const assetsDir = path.join(rootDir, 'assets');
const forceOverwrite = process.argv.includes('--force');

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const iconPages = [
  {
    key: 'app',
    x: 0,
    y: 0,
    width: 682.66669,
    height: 682.66669,
    baseName: 'TinyCAD',
    icoKind: 'exe',
  },
  {
    key: 'file',
    x: 702.66667,
    y: 0,
    width: 682.66667,
    height: 682.66667,
    baseName: 'TinyCAD File',
    icoKind: 'file',
  },
  {
    key: 'lib',
    x: 1405.3333,
    y: 0,
    width: 682.66667,
    height: 682.66667,
    baseName: 'TinyCAD Lib',
    icoKind: 'file',
  },
];

const appxIcons = [
  { fileName: 'StoreLogo.png', width: 50, height: 50 },
  { fileName: 'Square44x44Logo.png', width: 44, height: 44 },
  { fileName: 'Square150x150Logo.png', width: 150, height: 150 },
  { fileName: 'SmallTile.png', width: 71, height: 71 },
  { fileName: 'Wide310x150Logo.png', width: 310, height: 150 },
  { fileName: 'LargeTile.png', width: 310, height: 310 },
  ...[16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256].flatMap((size) => [
    { fileName: `Square44x44Logo.targetsize-${size}.png`, width: size, height: size },
    { fileName: `Square44x44Logo.targetsize-${size}_altform-unplated.png`, width: size, height: size },
    { fileName: `Square44x44Logo.targetsize-${size}_altform-lightunplated.png`, width: size, height: size },
  ]),
];

const desktopIconOutputs = [
  { extension: 'png', size: 256 },
  { extension: 'ico', size: 1024 },
  { extension: 'icns', size: 1024 },
];

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const setSvgRootAttribute = (svg, attribute, value) => svg.replace(
  new RegExp(`${attribute}="[^"]*"`),
  `${attribute}="${value}"`,
);

const renderCache = new Map();

const getRenderedIcon = async (page, size) => {
  const cacheKey = `${page.key}:${size}`;
  const density = Math.max(144, Math.min(size, 1024));

  if (!renderCache.has(cacheKey)) {
    const rendered = sharp(Buffer.from(getPageSvg(page)), { density })
      .resize({
        width: size,
        height: size,
        fit: 'contain',
        background: transparent,
      })
      .png()
      .toBuffer();
    renderCache.set(cacheKey, rendered);
  }

  return renderCache.get(cacheKey);
};

const writeAppxIcon = async (page, { fileName, width, height }) => {
  const outputPath = path.join(outputDir, fileName);
  if (!forceOverwrite && await fileExists(outputPath)) {
    return 'skipped';
  }

  const iconSize = Math.min(width, height);
  const iconBuffer = await getRenderedIcon(page, iconSize);

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: transparent,
    },
  })
    .composite([{ input: iconBuffer, gravity: 'center' }])
    .png()
    .toFile(outputPath);

  return 'generated';
};

const writeBufferIfNeeded = async (filePath, content) => {
  if (!forceOverwrite && await fileExists(filePath)) {
    return 'skipped';
  }

  await fs.writeFile(filePath, content);
  return 'generated';
};

const writeDesktopIconSet = async (page) => {
  const results = [];

  for (const output of desktopIconOutputs) {
    const filePath = path.join(assetsDir, `${page.baseName}.${output.extension}`);

    if (output.extension === 'png') {
      const pngBuffer = await getRenderedIcon(page, output.size);
      results.push(await writeBufferIfNeeded(filePath, pngBuffer));
      continue;
    }

    const sourcePng = await getRenderedIcon(page, output.size);
    png2icons.clearCache();

    if (output.extension === 'ico') {
      const icoBuffer = page.icoKind === 'exe'
        ? png2icons.createICO(sourcePng, png2icons.BICUBIC, 0, false, true)
        : png2icons.createICO(sourcePng, png2icons.BICUBIC, 0, false, false);

      if (!icoBuffer) {
        throw new Error(`Failed to generate ICO for ${page.baseName}`);
      }

      results.push(await writeBufferIfNeeded(filePath, icoBuffer));
      continue;
    }

    const icnsBuffer = png2icons.createICNS(sourcePng, png2icons.BICUBIC, 0);
    if (!icnsBuffer) {
      throw new Error(`Failed to generate ICNS for ${page.baseName}`);
    }

    results.push(await writeBufferIfNeeded(filePath, icnsBuffer));
  }

  return results;
};

await fs.mkdir(outputDir, { recursive: true });

if (!await fileExists(sourceSvgPath)) {
  throw new Error(`Missing source SVG: ${sourceSvgPath}`);
}

const sourceSvg = await fs.readFile(sourceSvgPath, 'utf8');
const sanitizedSvg = sourceSvg
  .replace(/<color-profile[\s\S]*?\/>/g, '')
  .replace(/\s+icc-color\([^;\"]*;?/g, '');

const pageSvgCache = new Map();

const getPageSvg = (page) => {
  if (!pageSvgCache.has(page.key)) {
    let pageSvg = sanitizedSvg;
    pageSvg = setSvgRootAttribute(pageSvg, 'width', page.width);
    pageSvg = setSvgRootAttribute(pageSvg, 'height', page.height);
    pageSvg = setSvgRootAttribute(pageSvg, 'viewBox', `${page.x} ${page.y} ${page.width} ${page.height}`);
    pageSvgCache.set(page.key, pageSvg);
  }

  return pageSvgCache.get(page.key);
};

let generatedCount = 0;
let skippedCount = 0;

for (const icon of appxIcons) {
  const result = await writeAppxIcon(iconPages[0], icon);
  if (result === 'generated') {
    generatedCount += 1;
  } else {
    skippedCount += 1;
  }
}

for (const page of iconPages) {
  const results = await writeDesktopIconSet(page);
  for (const result of results) {
    if (result === 'generated') {
      generatedCount += 1;
    } else {
      skippedCount += 1;
    }
  }
}

console.log(`Icon generation complete: ${generatedCount} generated, ${skippedCount} skipped.`);