import { parseRows } from './parse.js';

export function countOpen(text) {
  return parseRows(text).filter((r) => String(r.status || '').trim() === 'open'
    || String(r['status\r'] || '').trim() === 'open').length;
}
