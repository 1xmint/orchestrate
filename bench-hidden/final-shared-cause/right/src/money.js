// Turns amount text such as "$12.50" or "$1,250.50" into a number.
export function parseMoney(text) {
  return parseFloat(text.trim().replace(/[$,]/g, ''));
}
