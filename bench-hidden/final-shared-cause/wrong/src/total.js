import { amounts } from './lines.js';
import { parseMoney } from './money.js';

export function total(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => parseMoney(l.split(';')[1].replace(/,/g, '')))
    .reduce((a, b) => a + b, 0);
}
