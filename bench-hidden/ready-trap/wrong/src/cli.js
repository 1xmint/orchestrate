import { readFileSync } from 'node:fs';
import { count } from './count.js';

// Handles the bad input but never learned --json.
const file = process.argv[2];
if (!file) {
  console.error('usage: node src/cli.js <file>');
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
console.log(`lines: ${lines}`);
console.log(`words: ${words}`);
