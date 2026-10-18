import { readFileSync } from 'node:fs';
import { count } from './count.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => a !== '--json');

if (!file) {
  console.error('usage: node src/cli.js [--json] <file>');
  process.exit(2);
}

let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`cannot read ${file}`);
  process.exit(2);
}

const { lines, words } = count(text);
if (json) console.log(JSON.stringify({ lines, words }));
else {
  console.log(`lines: ${lines}`);
  console.log(`words: ${words}`);
}
