import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQuestion } from '../src/prompt.js';

test('question message quotes the selection and carries context', () => {
  const text = formatQuestion({
    question: '这里的 τ 是什么？',
    file: 'papers/moe.pdf',
    page: 4,
    selection: 'we rescale router logits by a temperature τ',
    context: { heading: '3.1 Gating', passage: 'To counter collapse, we rescale…', definitions: [{ term: 'τ', page: 1, snippet: 'let τ be the gate temperature' }] },
  });
  assert.ok(text.startsWith('> we rescale router logits'));
  assert.match(text, /这里的 τ 是什么？/);
  assert.match(text, /第 4 页/);
  assert.match(text, /3\.1 Gating/);
  assert.match(text, /“τ”在第 1 页首次出现：let τ be the gate temperature/);
  assert.match(text, /<\/paper-context>$/);
});

test('long fields are clipped', () => {
  const text = formatQuestion({ question: 'q', selection: 'x'.repeat(5000), context: { passage: 'y'.repeat(5000) } });
  assert.ok(text.length < 3000);
});
