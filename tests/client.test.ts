import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tile } from '../src/Tile.js'
import { meldTiles, tileName } from '../src/tiles.js'

test('all 34 tile types and red fives have Korean accessible names', () => {
  for (const [suit, name] of [['m', '만'], ['p', '통'], ['s', '삭']]) {
    for (let rank = 1; rank <= 9; rank++) assert.equal(tileName(`${suit}${rank}`), `${rank}${name}`)
    assert.equal(tileName(`${suit}0`), `적 5${name}`)
  }
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => tileName(`z${i + 1}`)), ['동', '남', '서', '북', '백', '발', '중'])
  assert.equal(tileName('_'), '뒷면')
})

test('meld display preserves red fives and all four kan tiles while removing direction markers', () => {
  assert.deepEqual(meldTiles('m12-3'), ['m1', 'm2', 'm3'])
  assert.deepEqual(meldTiles('p055+'), ['p0', 'p5', 'p5'])
  assert.deepEqual(meldTiles('s555=0'), ['s5', 's5', 's5', 's0'])
  assert.deepEqual(meldTiles('z1111'), ['z1', 'z1', 'z1', 'z1'])
})

test('tile visuals render every face with an accessible label and no external assets', () => {
  const tiles = ['_', ...['m', 'p', 's'].flatMap(suit => Array.from({ length: 10 }, (_, i) => suit + i)),
    ...Array.from({ length: 7 }, (_, i) => `z${i + 1}`)]
  for (const code of tiles) {
    const html = renderToStaticMarkup(createElement(Tile, { code }))
    assert.ok(html.includes(`aria-label="${tileName(code)}"`))
    assert.ok(html.includes('role="img"'))
    assert.ok(!html.includes('https://'))
    assert.ok(!html.includes('<button'))
  }
})

test('discard button is labeled, disabled outside legal actions, and marks drawn tiles', () => {
  const html = renderToStaticMarkup(createElement(Tile, {
    code: 'm0', onClick: () => {}, disabled: true, badge: '쯔모',
  }))
  assert.match(html, /<button/)
  assert.match(html, /disabled=""/)
  assert.match(html, /aria-label="적 5만 버리기"/)
  assert.match(html, /쯔모/)
})
