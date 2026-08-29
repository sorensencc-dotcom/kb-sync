import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

export interface RenderMetrics {
  width: number;
  height: number;
  pixelCount: number;
  nonBackgroundFraction: number;
  darkFraction: number;
  colorVariance: number;
  consoleErrors: string[];
  blank: boolean;
  screenshotPath?: string;
}

export interface RenderOptions { screenshotPath?: string; minNonBackgroundFraction?: number; }

function luminance(r: number, g: number, b: number): number { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

export function measurePixels(buffer: Buffer, backgroundTolerance = 8) {
  const png = PNG.sync.read(buffer);
  const total = png.width * png.height;
  let nonBackground = 0; let dark = 0; let sum = 0; let sumSq = 0;
  const bg = [png.data[0], png.data[1], png.data[2]];
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    const distance = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
    if (distance > backgroundTolerance) nonBackground++;
    const y = luminance(r, g, b); if (y < 0.2) dark++;
    sum += y; sumSq += y * y;
  }
  const mean = sum / total;
  return { width: png.width, height: png.height, pixelCount: total, nonBackgroundFraction: nonBackground / total, darkFraction: dark / total, colorVariance: Math.max(0, sumSq / total - mean * mean) };
}

export async function verifyRender(filePath: string, options: RenderOptions = {}): Promise<RenderMetrics> {
  const absolute = path.resolve(filePath); const errors: string[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`file://${absolute.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
    const screenshot = await page.screenshot({ fullPage: true, path: options.screenshotPath });
    const metrics = measurePixels(screenshot);
    const threshold = options.minNonBackgroundFraction ?? 0.01;
    return { ...metrics, consoleErrors: errors, blank: metrics.nonBackgroundFraction < threshold || errors.length > 0, screenshotPath: options.screenshotPath };
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const file = process.argv[2]; if (!file) { console.error('Usage: render-quality.ts <html-file> [screenshot-path]'); process.exit(1); }
  verifyRender(file, { screenshotPath: process.argv[3] }).then(result => { console.log(JSON.stringify(result, null, 2)); if (result.blank) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
