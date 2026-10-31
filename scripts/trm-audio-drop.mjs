import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { sanitizeSlug } from './validate-drive-findings.mjs';

const execFileAsync = promisify(execFile);

export const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac']);

export const isAudioFile = (filePath) => AUDIO_EXTS.has(path.extname(filePath).toLowerCase());

export async function hashFileStream(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

export async function whisperTranscribe(audioPath, env = process.env) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-whisper-'));
  const cmd = env.WHISPER_CLI_PATH || 'whisper';
  const model = env.WHISPER_MODEL || 'small';
  const isWin = process.platform === 'win32';
  try {
    await execFileAsync(cmd, [
      audioPath,
      '--model', model,
      '--output_format', 'txt',
      '--output_dir', outDir,
    ], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
      shell: isWin,
      windowsHide: true,
    });
    const txtName = `${path.parse(audioPath).name}.txt`;
    const txtPath = path.join(outDir, txtName);
    if (!fs.existsSync(txtPath)) {
      throw new Error(`Whisper produced no transcript file: ${txtName}`);
    }
    const text = fs.readFileSync(txtPath, 'utf8').trim();
    if (!text) throw new Error('empty transcript');
    return { transcript: text, engine: `whisper-${model}` };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const fenceFor = (text) => '`'.repeat(Math.max(3, ...(text.match(/`+/g) || []).map(r => r.length + 1)));

export function buildVoiceNote({ filename, audioHash, recordedAt, ingestedAt, transcript, engine }) {
  const fence = fenceFor(transcript);
  const snippet = transcript.replace(/\s+/g, ' ').slice(0, 160);
  return `---
title: ${JSON.stringify(`Voice Drop: ${path.parse(filename).name}`)}
created: ${recordedAt}
ingested: ${ingestedAt}
source: mobile_audio_drop
topic: conversations
status: drop
provenance_type: mobile_inbox_drop
original_filename: ${JSON.stringify(filename)}
audio_sha256: ${audioHash}
transcription_engine: ${JSON.stringify(engine)}
verification_status: inferred
not_primary_evidence: true
---

> ${snippet}

## Transcript

${fence}text
${transcript}
${fence}
`;
}

/**
 * Ingests one audio drop. Never moves the audio unless the note exists on disk.
 * Returns { status: 'ingested' | 'duplicate' | 'failed', notePath?, error? }.
 */
export async function ingestAudioDrop({ filePath, archiveDir, conversationsDir, logPath, transcribe = whisperTranscribe, sourceName = 'gdrive-mobile-inbox' }) {
  const filename = path.basename(filePath);
  const audioHash = await hashFileStream(filePath);
  const recordedAt = fs.statSync(filePath).mtime.toISOString();
  const noteDir = path.join(conversationsDir, recordedAt.slice(0, 10));
  const noteName = `voice-${sanitizeSlug(path.parse(filename).name)}-${audioHash.slice(0, 8)}.md`;
  const notePath = path.join(noteDir, noteName);

  let status = 'duplicate';
  if (!fs.existsSync(notePath)) {
    let result;
    try {
      result = await transcribe(filePath);
    } catch (err) {
      return { status: 'failed', error: err.message };
    }
    const ingestedAt = new Date().toISOString();
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(notePath, buildVoiceNote({ filename, audioHash, recordedAt, ingestedAt, ...result }), 'utf8');
    status = 'ingested';
  }

  if (logPath && fs.existsSync(logPath)) {
    fs.appendFileSync(logPath, `\n- [${new Date().toISOString()}] Ingested voice drop ${filename} (${sourceName}, sha256 ${audioHash.slice(0, 12)}) into conversations/${recordedAt.slice(0, 10)}/${noteName} (${status})`);
  }

  fs.mkdirSync(archiveDir, { recursive: true });
  const utcSuffix = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(filePath, path.join(archiveDir, `${filename}.${utcSuffix}`));
  return { status, notePath };
}
