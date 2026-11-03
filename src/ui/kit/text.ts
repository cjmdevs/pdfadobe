// UI wording helpers (B7). "3 marks", "1 mark": never "mark(s)".
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
