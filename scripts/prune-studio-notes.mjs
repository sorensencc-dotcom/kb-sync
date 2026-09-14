import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const daysArg = args.find(a => a.startsWith('--days='));
const daysThreshold = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;
const notebookId = args.find(a => !a.startsWith('--')) || '679b8bab-2d87-42cb-a726-6dc54c83acc2';
const CUTOFF_DATE = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);

console.log(`Target Notebook : ${notebookId}`);
console.log(`Age Threshold   : ${daysThreshold} days (older than ${CUTOFF_DATE.toISOString()})`);
console.log(`Execution Mode  : ${isApply ? 'LIVE APPLY' : 'DRY RUN'}\n`);

function extractDateFromContent(content) {
  if (!content) return null;
  const match = content.match(/(?:created_at|date|document_date|generated_at):\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z?)?)["']?/i);
  if (match && match[1]) {
    const d = new Date(match[1]);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

try {
  const rawOutput = execSync(`nlm note list "${notebookId}" --json`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const data = JSON.parse(rawOutput);
  const notes = Array.isArray(data) ? data : (data.notes || []);

  console.log(`Total notes retrieved: ${notes.length}`);

  const candidates = [];
  for (const note of notes) {
    const title = (note.title || '').trim();
    const content = note.content || '';
    const hasCodeBlock = content.includes('```');
    const isCodeTitle = /code|sample|snippet|script|test|adapter|schema|implementation/i.test(title);

    if (!hasCodeBlock && !isCodeTitle) continue;

    const noteDate = (note.created_at && !isNaN(new Date(note.created_at).getTime()))
      ? new Date(note.created_at)
      : extractDateFromContent(content);

    const isOlder = noteDate ? (noteDate < CUTOFF_DATE) : false;

    candidates.push({
      id: note.id,
      title: title || '(Untitled Note)',
      date: noteDate ? noteDate.toISOString() : 'Unknown',
      isOlder
    });
  }

  const eligible = candidates.filter(c => c.isOlder);
  console.log(`Found ${eligible.length} code note(s) older than ${daysThreshold} days to prune.\n`);

  for (const item of eligible) {
    process.stdout.write(`- [${item.id}] ${item.title} (${item.date})`);
    if (isApply) {
      try {
        execSync(`nlm note delete "${notebookId}" "${item.id}" -y`, { stdio: 'pipe' });
        console.log(` -> DELETED`);
      } catch (delErr) {
        console.log(` -> ❌ DELETE FAILED: ${delErr.message}`);
      }
    } else {
      console.log(` -> [DRY-RUN] Will be deleted with --apply`);
    }
  }

  if (!isApply && eligible.length > 0) {
    console.log(`\nTo execute deletions, re-run with: node C:\\dev\\kb-sync\\scripts\\prune-studio-notes.mjs --apply`);
  }
} catch (err) {
  console.error(`Execution error: ${err.message}`);
}
