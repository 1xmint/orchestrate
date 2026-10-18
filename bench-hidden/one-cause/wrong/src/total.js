import { parseRows } from './parse.js';

export function totalHours(text) {
  return parseRows(text).reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
}
