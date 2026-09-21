const args = process.argv.slice(2);
const mode = process.env.MOCK_NLM_MODE || 'empty';

if (mode === 'fail') {
  process.exit(1);
}

if (args.includes('delete') || args.includes('remove')) {
  process.exit(0);
}

if (mode === 'custom') {
  const data = process.env.MOCK_NLM_DATA ? JSON.parse(process.env.MOCK_NLM_DATA) : [];
  console.log(JSON.stringify(data));
  process.exit(0);
}

console.log(JSON.stringify([]));
