import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';
import { isAudioFile, buildVoiceNote } from '../scripts/trm-audio-drop.mjs';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-audio-test-'));
  const driveRoot = path.join(tmp, 'TRM-Research');
  const inbox = path.join(driveRoot, 'mobile-inbox');
  const conversationsDir = path.join(tmp, 'conversations');
  const logPath = path.join(tmp, 'Log.md');
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(logPath, '# Log\n');
  const run = (transcribe) => ingestDriveFindings({
    driveRoot, mobileInboxDir: inbox, conversationsDir, logPath, repoRoot: tmp, debounceMs: 0, transcribe
  });
  return { driveRoot, inbox, conversationsDir, logPath, run };
}

const archived = (driveRoot) => {
  const dir = path.join(driveRoot, '04_archive', 'mobile-inbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
const notes = (conversationsDir) => fs.existsSync(conversationsDir)
  ? fs.readdirSync(conversationsDir, { recursive: true }).filter(f => f.endsWith('.md')) : [];

test('isAudioFile matches supported extensions case-insensitively', () => {
  for (const f of ['a.m4a', 'a.MP3', 'a.wav', 'a.aac', 'a.ogg', 'a.flac']) assert.equal(isAudioFile(f), true, f);
  assert.equal(isAudioFile('a.md'), false);
});

test('voice drop becomes a conversation note, audio is archived, log is appended', async () => {
  const s = setup();
  fs.writeFileSync(path.join(s.inbox, 'Recording.m4a'), 'fake-audio-1');
  const res = await s.run(async () => ({ transcript: 'hello world', engine: 'mock' }));
  assert.equal(res.mobileIngestedCount, 1);
  const [note] = notes(s.conversationsDir);
  const body = fs.readFileSync(path.join(s.conversationsDir, note), 'utf8');
  assert.match(body, /audio_sha256: [0-9a-f]{64}/);
  assert.match(body, /hello world/);
  assert.equal(fs.existsSync(path.join(s.inbox, 'Recording.m4a')), false);
  assert.equal(archived(s.driveRoot).length, 1);
  assert.match(fs.readFileSync(s.logPath, 'utf8'), /Ingested voice drop Recording\.m4a/);
});

test('transcription failure leaves audio in inbox and writes no note', async () => {
  const s = setup();
  fs.writeFileSync(path.join(s.inbox, 'Recording.m4a'), 'fake-audio-2');
  const res = await s.run(async () => { throw new Error('whisper offline'); });
  assert.equal(res.mobileIngestedCount, 0);
  assert.equal(fs.existsSync(path.join(s.inbox, 'Recording.m4a')), true);
  assert.equal(notes(s.conversationsDir).length, 0);
  assert.equal(archived(s.driveRoot).length, 0);
});

test('same filename with different content keeps both recordings', async () => {
  const s = setup();
  const t = async () => ({ transcript: 'x', engine: 'mock' });
  fs.writeFileSync(path.join(s.inbox, 'Recording.m4a'), 'first');
  await s.run(t);
  fs.writeFileSync(path.join(s.inbox, 'Recording.m4a'), 'second');
  await s.run(t);
  assert.equal(archived(s.driveRoot).length, 2);
  assert.equal(notes(s.conversationsDir).length, 2);
});

test('re-dropped identical audio skips transcription and still archives', async () => {
  const s = setup();
  let calls = 0;
  const t = async () => { calls++; return { transcript: 'x', engine: 'mock' }; };
  fs.writeFileSync(path.join(s.inbox, 'a.m4a'), 'same');
  await s.run(t);
  const mtime = fs.statSync(path.join(s.driveRoot, '04_archive', 'mobile-inbox', archived(s.driveRoot)[0])).mtime;
  fs.writeFileSync(path.join(s.inbox, 'a.m4a'), 'same');
  fs.utimesSync(path.join(s.inbox, 'a.m4a'), mtime, mtime);
  await s.run(t);
  assert.equal(calls, 1);
  assert.equal(notes(s.conversationsDir).length, 1);
  assert.equal(archived(s.driveRoot).length, 2);
});

test('buildVoiceNote survives quotes in filename and backtick fences in transcript', () => {
  const out = buildVoiceNote({
    filename: 'a"b.m4a', audioHash: 'f'.repeat(64), recordedAt: 'r', ingestedAt: 'i',
    transcript: 'code ```js\nx\n``` end', engine: 'mock'
  });
  assert.match(out, /original_filename: "a\\"b\.m4a"/);
  assert.match(out, /\n````text\ncode ```js/);
});
