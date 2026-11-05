import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, definitionsFor, headingBefore, locate, passageAround, termsIn } from '../reader/context.js';

const page1 =
  'Stable Token Routing for Sparse Mixture-of-Experts\nAbstract\nSparse Mixture-of-Experts (MoE) models route each token to a small subset of experts.\n' +
  '1 Introduction\nWe use the following notation throughout. Let z denote the router logits over the expert pool, let τ be the gate temperature. ' +
  'The initial temperature τ₀ is a hyperparameter, set to 2.0 unless stated otherwise.';
const page2 =
  '3 Method\n3.1 Temperature-scaled gating\nPrior sentence about collapse. To counter early collapse, we rescale router logits by a temperature τ that is annealed from τ₀ to 1 over the first 10% of training, which keeps the gate distribution close to uniform. ' +
  'A larger τ flattens the distribution. Another sentence follows here. And one more that should be cut.';
const pages = [page1, page2];
const sel = 'we rescale router logits by a temperature τ that is annealed from τ₀ to 1';

test('locate is whitespace-insensitive', () => {
  assert.ok(locate('a  b\nc d', 'b c') > 0);
  assert.equal(locate('abc', 'zzz'), -1);
});

test('passage keeps the sentence plus neighbours', () => {
  const p = passageAround(page2, sel);
  assert.match(p, /Prior sentence about collapse\./);
  assert.match(p, /A larger τ flattens/);
  assert.doesNotMatch(p, /should be cut/);
});

test('heading is the nearest section line before the selection', () => {
  assert.equal(headingBefore(pages, 2, sel), '3.1 Temperature-scaled gating');
});

test('terms pick up greek symbols and acronyms', () => {
  assert.deepEqual(termsIn('the MoE gate uses τ and τ₀ (see Fig 2)'), ['τ', 'τ₀', 'MoE']);
});

test('definitions point at earlier pages and merge nearby hits', () => {
  const defs = definitionsFor(pages, 2, sel);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].page, 1);
  assert.match(defs[0].term, /τ/);
  assert.match(defs[0].snippet, /gate temperature/);
  assert.doesNotMatch(defs[0].snippet, /^\S*rward/);
});

test('buildContext bundles everything', () => {
  const c = buildContext(pages, 2, sel);
  assert.equal(c.heading, '3.1 Temperature-scaled gating');
  assert.ok(c.passage.includes('rescale router logits'));
  assert.ok(c.overview.startsWith('Stable Token Routing'));
});

test('passage stops at section headings', () => {
  const page =
    'released under the Apache 2.0 license. Code: https://example.com\n1 Introduction\nIn this paper we present a model. It routes tokens to experts. More text here.\n2 Method\nNext section text.';
  const p = passageAround(page, 'It routes tokens to experts');
  assert.match(p, /In this paper we present a model\./);
  assert.doesNotMatch(p, /Apache|Introduction|Next section/);
});

test('definition snippet keeps the whole sentence', () => {
  const page1 =
    'Alice Bob Carol Dave Abstract We introduce Mixtral, a Sparse Mixture of Experts (SMoE) language model. For every token, at each layer, a router network selects two experts to process the current state and combine their outputs. Even though each token only sees two experts, the selected experts can be different at each timestep.';
  const page2 = 'The SMoE layer is applied independently per token.';
  const defs = definitionsFor([page1, page2], 2, 'The SMoE layer is applied');
  assert.equal(defs[0].page, 1);
  assert.match(defs[0].snippet, /^We introduce Mixtral|^Abstract We introduce|SMoE/);
  assert.match(defs[0].snippet, /router network selects two experts/);
});
