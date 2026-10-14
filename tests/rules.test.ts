import assert from 'node:assert/strict'
import test from 'node:test'
import { createSecureWall, handTiles, Majiang, type EngineMessage, type Summary } from '../server/engine.js'
import { chooseBot, TablePlayer, type Decision } from '../server/player.js'

const rule = Majiang.rule()
function fixture(hand: string, otherHands = ['', '', ''], options: { id?: number; dealer?: number; hand?: number } = {}) {
  let decisions: Decision[] = []
  const player = new TablePlayer({
    decide: (_player, choices) => { decisions = choices },
    changed: () => {},
    finished: () => {},
  })
  const feed = (message: EngineMessage) => {
    decisions = []
    player.action(message, () => {})
    return decisions
  }
  feed({ kaiju: { id: options.id ?? 0, rule, title: 'Test', player: ['A', 'B', 'C', 'D'], qijia: options.dealer ?? 0 } })
  feed({ qipai: {
    zhuangfeng: 0, jushu: options.hand ?? 0, changbang: 0, lizhibang: 0, defen: [25000, 25000, 25000, 25000],
    baopai: 'z7', shoupai: [hand, ...otherHands],
  } })
  return { player, feed }
}

test('secure wall: 136 physical tiles, 122 live draws, red fives, dead wall and kan dora', () => {
  const wall = createSecureWall(rule)
  assert.equal(wall._pai.length, 136)
  const allCounts = new Map<string, number>()
  for (const tile of wall._pai) {
    const normalized = tile.replace('0', '5')
    allCounts.set(normalized, (allCounts.get(normalized) ?? 0) + 1)
  }
  assert.equal(allCounts.size, 34)
  assert.ok([...allCounts.values()].every(count => count === 4))
  assert.deepEqual(wall._pai.filter(tile => tile[1] === '0').sort(), ['m0', 'p0', 's0'])
  assert.deepEqual(wall.baopai, [wall._pai[4]])
  assert.equal(wall.fubaopai, null)
  assert.deepEqual(wall._fubaopai, [wall._pai[9]])
  assert.equal(wall.paishu, 122)
  assert.equal(wall.baopai.length, 1)
  const live: string[] = []
  while (wall.paishu > 0) live.push(wall.zimo())
  assert.equal(live.length, 122)
  assert.throws(() => wall.zimo())
  const counts = new Map<string, number>()
  for (const tile of live) {
    const p = tile.replace('0', '5')
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  assert.ok([...counts.values()].every(n => n <= 4))
  assert.ok(live.filter(tile => tile[1] === '0').length <= 3)
  const kanWall = createSecureWall(rule)
  kanWall.gangzimo()
  assert.equal(kanWall.paishu, 121)
  kanWall.kaigang()
  assert.equal(kanWall.baopai.length, 2)
  kanWall.close()
  assert.equal(kanWall.fubaopai?.length, 2)
  const noUra = createSecureWall(Majiang.rule({ '裏ドラあり': false }))
  noUra.close()
  assert.equal(noUra.fubaopai, null)
})

test('tile serialization accounts for red fives exactly once and separates melds', () => {
  const hand = Majiang.Shoupai.fromString('m055p123s123z11,m777-')
  assert.deepEqual(handTiles(hand), ['m0', 'm5', 'm5', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'z1', 'z1'])
  assert.equal(hand._fulou[0], 'm777-')
  assert.equal(handTiles(Majiang.Shoupai.fromString('_____________')).length, 13)
})

test('a completed hand without yaku cannot ron or tsumo; dora alone is not a yaku', () => {
  const waiting = Majiang.Shoupai.fromString('m123p123s45z11,m789-')
  assert.equal(Majiang.Util.xiangting(waiting), 0)
  assert.equal(Majiang.Game.allow_hule(rule, waiting, 's6+', 0, 1, false, true), false)
  assert.equal(Majiang.Game.allow_hule(rule, waiting.clone().zimo('s6'), null, 0, 1), false)
  const score = Majiang.Util.hule(waiting, 's6+', {
    rule, zhuangfeng: 0, menfeng: 1, hupai: {}, baopai: ['m9'], jicun: { changbang: 0, lizhibang: 0 },
  })
  assert.equal(score.hupai, undefined)
  assert.equal(score.defen, 0)
})

test('engine scores a deterministic nondealer tsumo with fu, han and balanced payments', () => {
  const score = Majiang.Util.hule(Majiang.Shoupai.fromString('m123456p123s456z11'), null, {
    rule, zhuangfeng: 0, menfeng: 1, hupai: {}, baopai: [], jicun: { changbang: 0, lizhibang: 0 },
  })
  assert.equal(score.fu, 30)
  assert.equal(score.fanshu, 1)
  assert.equal(score.defen, 1100)
  assert.deepEqual(score.fenpei, [-500, 1100, -300, -300])
  assert.equal(score.fenpei!.reduce((sum, n) => sum + n, 0), 0)
})

test('seven pairs and thirteen orphans use full engine scoring', () => {
  for (const [hand, expected] of [['m1122p3344s5566z77', '七対子'], ['m19p19s19z1234567m1', '国士無双十三面']]) {
    const score = Majiang.Util.hule(Majiang.Shoupai.fromString(hand), null, {
      rule, zhuangfeng: 0, menfeng: 1, hupai: {}, baopai: [], jicun: { changbang: 0, lizhibang: 0 },
    })
    assert.ok(score.hupai?.some(yaku => yaku.name === expected), JSON.stringify(score))
  }
})

test('ron offer is captured before Player mutates temporary furiten after its callback', () => {
  const { player, feed } = fixture('m234456p22345s45')
  const first = feed({ dapai: { l: 1, p: 's6' } })
  assert.ok(first.some(d => d.choice.kind === 'ron'))
  assert.equal(player._neng_rong, false)
  assert.equal(chooseBot(player, first).choice.kind, 'ron')
  assert.ok(!feed({ dapai: { l: 2, p: 's3' } }).some(d => d.choice.kind === 'ron'))
  feed({ zimo: { l: 0, p: 'z1' } })
  feed({ dapai: { l: 0, p: 'z1_' } })
  assert.ok(feed({ dapai: { l: 3, p: 's6' } }).some(d => d.choice.kind === 'ron'))
})

test('self-discard furiten denies all waits, and passed ron after riichi stays furiten', () => {
  const own = fixture('m234456p22345s45')
  own.feed({ zimo: { l: 0, p: 's6' } })
  own.feed({ dapai: { l: 0, p: 's6_' } })
  assert.ok(!own.feed({ dapai: { l: 1, p: 's3' } }).some(d => d.choice.kind === 'ron'))
  const riichi = fixture('m234456p22345s45*')
  assert.ok(riichi.feed({ dapai: { l: 1, p: 's6' } }).some(d => d.choice.kind === 'ron'))
  const drawn = riichi.feed({ zimo: { l: 0, p: 'z1' } })
  assert.deepEqual(drawn.filter(d => d.choice.kind === 'discard').map(d => d.reply.dapai), ['z1_'])
  riichi.feed({ dapai: { l: 0, p: 'z1_' } })
  assert.ok(!riichi.feed({ dapai: { l: 2, p: 's3' } }).some(d => d.choice.kind === 'ron'))
})

test('chi direction, pon, open kan, closed kan, added kan, and kuikae come from Player helpers', () => {
  const left = fixture('m1233p123s456z111')
  assert.ok(left.feed({ dapai: { l: 3, p: 'm3' } }).some(d => d.choice.kind === 'chi'))
  const opposite = fixture('m1233p123s456z111')
  const choices = opposite.feed({ dapai: { l: 2, p: 'm3' } })
  assert.ok(!choices.some(d => d.choice.kind === 'chi'))
  assert.ok(choices.some(d => d.choice.kind === 'pon'))
  const open = fixture('m333p123s456z1122')
  assert.ok(open.feed({ dapai: { l: 1, p: 'm3' } }).some(d => d.reply.fulou === 'm3333+'))
  const closed = fixture('m333p123s456z1122')
  assert.ok(closed.feed({ zimo: { l: 0, p: 'm3' } }).some(d => d.reply.gang === 'm3333'))
  const added = fixture('m3p123s456z111,m333+')
  assert.ok(added.feed({ zimo: { l: 0, p: 'z2' } }).some(d => d.reply.gang === 'm333+3'))
  const called = fixture('m1233p123s456z111')
  called.feed({ dapai: { l: 3, p: 'm3' } })
  const after = called.feed({ fulou: { l: 0, m: 'm123-' } })
  assert.ok(after.length > 0)
  assert.ok(after.every(d => d.choice.kind === 'discard' && d.choice.tile?.slice(0, 2) !== 'm3'))
})

test('robbing added kan offers ron before furiten update, closed kan is not robbable', () => {
  const added = fixture('m24p234s234678z11', ['__________,m333+', '', ''])
  const choices = added.feed({ gang: { l: 1, m: 'm333+3' } })
  assert.ok(choices.some(d => d.choice.kind === 'ron'))
  assert.equal(added.player._neng_rong, false)
  const closed = fixture('m24p234s234678z11')
  assert.deepEqual(closed.feed({ gang: { l: 1, m: 'm3333' } }), [])
  const orphans = fixture('m19p19s19z1234567')
  assert.equal(orphans.player.allow_hule(orphans.player.shoupai, 'm1+'), true)
  assert.deepEqual(orphans.feed({ gang: { l: 1, m: 'm1111' } }), [])
})

test('riichi requires sufficient points, closed tenpai and remaining draws; nine-terminals abort is offered', () => {
  const hand = Majiang.Shoupai.fromString('m234456p22345s45z1')
  assert.ok(Majiang.Game.allow_lizhi(rule, hand, 'z1_', 60, 25000))
  assert.equal(Majiang.Game.allow_lizhi(rule, hand, 'z1_', 60, 900), false)
  assert.equal(Majiang.Game.allow_lizhi(rule, hand, 'z1_', 3, 25000), false)
  const player = fixture('m234456p22345s45')
  const choices = player.feed({ zimo: { l: 0, p: 'z1' } })
  const bot = chooseBot(player.player, choices)
  assert.equal(bot.choice.kind, 'riichi')
  assert.equal(bot.reply.dapai, 'z1_*')
  const terminals = fixture('m19p19s19z1234567')
  assert.ok(terminals.feed({ zimo: { l: 0, p: 'm2' } }).some(d => d.choice.kind === 'abort'))
})

test('result presentation exposes scoring but never forwards the engine full-game log', () => {
  const { player, feed } = fixture('m234456p22345s45')
  const offers = feed({ hule: {
    l: 1, shoupai: 'm123456p123s456z11', baojia: null, fubaopai: ['z1'],
    fu: 30, fanshu: 1, defen: 1100, hupai: [{ name: '門前清自摸和', fanshu: 1 }],
    fenpei: [-500, 1100, -300, -300],
  } })
  assert.equal(player.result?.winner, 'B')
  assert.equal(player.result?.hand?.length, 14)
  assert.deepEqual(player.result?.deltas, [-500, 1100, -300, -300])
  assert.deepEqual(offers.map(d => d.choice.kind), ['continue'])
})

test('rotated seat winds map result winners and score deltas to absolute player IDs', () => {
  const { player, feed } = fixture('m234456p22345s45', ['', '', ''], { id: 3, dealer: 2, hand: 1 })
  assert.deepEqual(player.model.player_id, [3, 0, 1, 2])
  feed({ hule: {
    l: 1, shoupai: 'm123456p123s456z11', baojia: null, fubaopai: null,
    fu: 30, fanshu: 1, defen: 1100, hupai: [{ name: '門前清自摸和', fanshu: 1 }],
    fenpei: [-500, 1100, -300, -300],
  } })
  assert.equal(player.result?.winner, 'A')
  assert.deepEqual(player.result?.deltas, [1100, -300, -300, -500])
})

test('deterministic full Game accepts deferred-eligibility ron and ends with scored rankings', () => {
  const testRule = Majiang.rule({ '場数': 0, '赤牌': { m: 0, p: 0, s: 0 } })
  const wall = new Majiang.Shan(testRule)
  const pool = wall._pai.slice().sort()
  const take = (tile: string): string => {
    const index = pool.indexOf(tile)
    assert.ok(index >= 0, `No ${tile} available`)
    return pool.splice(index, 1)[0]
  }
  const winner = handTiles(Majiang.Shoupai.fromString('m234456p22345s45')).map(take)
  const discard = take('s6')
  const firstDraw = take('z7')
  const dealer = [discard, ...pool.splice(0, 12)]
  const west = pool.splice(0, 13)
  const north = pool.splice(0, 13)
  wall._pai = [...pool, ...[...dealer, ...winner, ...west, ...north, firstDraw].reverse()]
  wall._baopai = [wall._pai[4]]
  wall._fubaopai = [wall._pai[9]]
  class FixedGame extends Majiang.Game {
    override kaiju(): void { super.kaiju(0) }
    override qipai(): void { super.qipai(wall) }
  }
  let final: Summary | undefined
  let ronAccepted = false
  const players: TablePlayer[] = []
  for (let id = 0; id < 4; id++) players.push(new TablePlayer({
    decide: (player, choices, callback) => {
      const selected = id === 0
        ? choices.find(d => d.reply.dapai === 's6') ?? chooseBot(player, choices)
        : chooseBot(player, choices)
      if (id === 1 && selected.choice.kind === 'ron') ronAccepted = true
      callback(selected.reply)
    },
    changed: () => {},
    finished: summary => { final = summary },
  }))
  const game = new FixedGame(players, () => {}, testRule)
  game.do_sync()
  assert.equal(ronAccepted, true)
  assert.equal(players[1].result?.title, 'Ron · discard win')
  assert.ok(players[1].result!.yaku.length > 0)
  assert.ok(final)
  assert.equal(final.rank[1], 1)
  assert.equal(final.defen.reduce((sum, points) => sum + points, 0), 100000)
  assert.ok(final.defen[1] > 25000)
  assert.ok(final.defen[0] < 25000)
})
