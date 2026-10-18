// Turns CSV text into a list of rows. The first line holds the column names;
// each row is an object keyed by those names. Line breaks may be \n or \r\n,
// and blank lines (such as the one after a final line break) are skipped.
export function parseRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l !== '');
  if (!lines.length) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((name, i) => { row[name] = cells[i]; });
    return row;
  });
}
