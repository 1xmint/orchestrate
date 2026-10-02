import { readFileSync } from 'node:fs';
import { listBooks } from './books.js';
import { lateFee } from './fees.js';

const [cmd, days] = process.argv.slice(2);

if (cmd === 'list') {
  console.log(listBooks(readFileSync(new URL('../data/books.txt', import.meta.url), 'utf8')).join('\n'));
} else if (cmd === 'fee') {
  if (days === undefined || !/^\d+$/.test(days)) {
    console.log('usage: fee <days>');
    process.exitCode = 1;
  } else {
    console.log('$' + (lateFee(Number(days)) / 100).toFixed(2));
  }
} else {
  console.log('usage: list');
}
