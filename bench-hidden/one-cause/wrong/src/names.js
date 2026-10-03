import { parseRows } from './parse.js';

export function listNames(text) {
  return parseRows(text).map((r) => r.name).filter((n) => n && n.trim() !== '');
}
