// Formats a question about a selected passage as one user message for the
// current dsh session. The reader collects the context (the passage around the
// selection, its section, where the selected symbols/terms first appear), so the
// agent can answer in one turn without searching the PDF itself.

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

/**
 * @param {{
 *   question: string,
 *   file?: string,
 *   page?: number,
 *   selection?: string,
 *   context?: { passage?: string, heading?: string,
 *               definitions?: Array<{ term: string, page: number, snippet: string }> }
 * }} input
 * @returns {string}
 */
export function formatQuestion(input) {
  const { question, file, page, selection, context = {} } = input;
  const where = [file ? `\`${clip(file, 200)}\`` : '', page ? `第 ${page} 页` : '', context.heading ? `「${clip(context.heading, 100)}」` : '']
    .filter(Boolean)
    .join(' · ');
  const lines = [];
  lines.push(`> ${clip(selection, 1200)}`);
  lines.push('');
  lines.push(clip(question, 1000));
  lines.push('');
  lines.push(`<paper-context>`);
  lines.push(`以上引用来自论文阅读器${where ? `（${where}）` : ''}。下面是阅读器附上的原文上下文，请优先依据它回答：`);
  if (context.passage) lines.push(`所在段落：${clip(context.passage, 800)}`);
  const defs = Array.isArray(context.definitions) ? context.definitions.slice(0, 3) : [];
  for (const d of defs) {
    if (d?.term && d?.snippet) lines.push(`“${clip(d.term, 40)}”在第 ${d.page} 页首次出现：${clip(d.snippet, 320)}`);
  }
  lines.push(
    '回答要求：用提问的语言回答，先给直接答案再简短解释；引用论文内容时注明页码，如“（第 4 页）”；原文没写的内容要明确说明，不要编造。',
  );
  lines.push(`</paper-context>`);
  return lines.join('\n');
}
