import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRender } from '../src/render-quality.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function fixture(body: string) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-visual-')); const file = path.join(dir, 'fixture.html'); await fs.writeFile(file, `<style>body{margin:0;background:#f2ece2} .chart{height:300px;background:linear-gradient(90deg,#c4501a,#2c2420);color:white}</style>${body}`); return file; }

test('passes a rendered dashboard with color variance', async () => { const result = await verifyRender(await fixture('<main class="chart">Mermaid chart</main>')); assert.equal(result.blank, false); assert.ok(result.nonBackgroundFraction > 0.01); assert.ok(result.colorVariance > 0); assert.equal(result.consoleErrors.length, 0); });
test('flags a blank HTML screen', async () => { const result = await verifyRender(await fixture('')); assert.equal(result.blank, true); assert.ok(result.nonBackgroundFraction < 0.01); });
