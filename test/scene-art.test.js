import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSeed } from '../src/seed.js';
import { billboardFor, BILLBOARDS, FALLBACK, svgDataURI } from '../public/scene/art.js';

const seed = parseSeed(await readFile(new URL('../public/garden-data.js', import.meta.url), 'utf8'));

test('every plant in the inventory gets its own drawing, not the fallback tuft', () => {
  for (const p of seed.plants) {
    const art = billboardFor(p.species, p.stage);
    assert.notEqual(art, FALLBACK, `${p.id} (${p.species}/${p.stage}) fell back to the generic tuft`);
  }
});

test('drawings are transparent cutouts, not the old opaque avatar tiles', () => {
  for (const set of Object.values(BILLBOARDS))
    for (const [stage, art] of Object.entries(set))
      assert.equal(/<rect[^>]*width="\d+"[^>]*height="\d+"[^>]*fill="#[0-9A-Fa-f]{6}"/.test(art.svg), false,
        `a full-bleed background rect leaked into ${stage}`);
});

test('every drawing carries a real size in metres', () => {
  const all = [...Object.values(BILLBOARDS).flatMap((s) => Object.values(s)), FALLBACK];
  for (const art of all) {
    assert.ok(art.w > 0.1 && art.w < 2, 'width out of range: ' + art.w);
    assert.ok(art.h > 0.1 && art.h < 2.5, 'height out of range: ' + art.h);
    assert.match(art.svg, /^<svg /);
  }
});

test('a tomato outgrows a chilli seedling, which is the point of sizing by stage', () => {
  assert.ok(billboardFor('tomato', 'flowering').h > billboardFor('chilli', 'seedling').h * 2);
});

test('a missing stage falls back to the nearest EARLIER one, never a later one', () => {
  // mint is drawn for growing and harvesting only
  assert.equal(billboardFor('mint', 'fruiting'), BILLBOARDS.mint.growing,
    'fruiting must not borrow the harvesting drawing, which is further along');
  // nothing earlier than seedling exists, so it takes the species default
  assert.equal(billboardFor('mint', 'seedling'), BILLBOARDS.mint.growing);
  // raspberry skips bulbing, which sits between its flowering and fruiting drawings
  assert.equal(billboardFor('raspberry', 'bulbing'), BILLBOARDS.raspberry.flowering);
});

test('an unknown species still draws something clickable', () => {
  assert.equal(billboardFor('dragonfruit', 'growing'), FALLBACK);
  assert.equal(billboardFor(undefined, undefined), FALLBACK);
});

test('a known species with an unknown stage still draws that species', () => {
  const art = billboardFor('tomato', 'wintering');
  assert.notEqual(art, FALLBACK);
  assert.ok(Object.values(BILLBOARDS.tomato).includes(art));
});

test('the data URI is usable as a texture source', () => {
  const uri = svgDataURI(FALLBACK.svg);
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.equal(uri.includes('#'), false, 'a raw # would truncate the URI');
});
