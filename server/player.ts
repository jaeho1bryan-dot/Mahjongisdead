import type { Choice, HandResult } from '../shared/protocol.js'
import { meldTiles, tileName } from '../src/tiles.js'
import {
  Majiang, handTiles, type Draw, type EngineMessage, type ExhaustiveDraw,
  type Meld, type Reply, type ReplyCallback, type Summary, type Win,
} from './engine.js'

export interface Decision { choice: Choice; reply: Reply }
export interface PlayerHooks {
  decide(player: TablePlayer, decisions: Decision[], callback: ReplyCallback): void
  changed(player: TablePlayer): void
  finished(summary: Summary): void
}

export class TablePlayer extends Majiang.Player {
  disposed = false
  event = '참가자를 기다리고 있습니다'
  result: HandResult | null = null

  private readonly hooks: PlayerHooks

  constructor(hooks: PlayerHooks) { super(); this.hooks = hooks }

  override action(message: EngineMessage, callback?: ReplyCallback): void {
    if (this.disposed) return
    super.action(message, callback)
    this.hooks.changed(this)
  }

  private offer(decisions: Decision[]): void {
    const callback = this._callback
    if (!callback) return
    if (decisions.length) this.hooks.decide(this, decisions, callback)
    else callback({})
  }

  action_kaiju(): void { this.offer([]) }
  action_qipai(): void {
    this.result = null
    this.event = '새로운 국이 시작되었습니다'
    this.offer([])
  }

  private discardChoices(riichi = false): Decision[] {
    const decisions = this.get_dapai(this.shoupai).map(tile =>
      decision('discard', `${tileName(tile)} 버리기`, { dapai: tile }, tile))
    if (riichi) {
      const tiles = this.allow_lizhi(this.shoupai)
      if (Array.isArray(tiles)) {
        for (const tile of tiles) decisions.push(
          decision('riichi', `리치 · ${tileName(tile)}`, { dapai: `${tile}*` }, tile))
      }
    }
    return decisions
  }

  action_zimo(draw: Draw, kanDraw = false): void {
    this.event = `${this.model.player[this.model.player_id[draw.l]]}님이 패를 뽑았습니다`
    if (draw.l !== this._menfeng) return this.offer([])
    const choices = this.discardChoices(true)
    if (this.allow_hule(this.shoupai, null, kanDraw))
      choices.push(decision('tsumo', '쯔모', { hule: '-' }))
    for (const meld of this.get_gang_mianzi(this.shoupai) ?? [])
      choices.push(decision('kan', /^[mpsz]\d{4}$/.test(meld) ? '안깡' : '가깡', { gang: meld }, undefined, meld))
    if (this.allow_pingju(this.shoupai))
      choices.push(decision('abort', '구종구패 · 유국', { daopai: '-' }))
    this.offer(choices)
  }

  action_dapai(discard: Draw): void {
    this.event = `${this.model.player[this.model.player_id[discard.l]]}님이 ${tileName(discard.p)} 패를 버렸습니다${discard.p.endsWith('*') ? ' · 리치' : ''}`
    if (discard.l === this._menfeng) return this.offer([])
    const tile = discard.p + '_+=-'[(4 + discard.l - this._menfeng) % 4]
    const choices: Decision[] = []
    // Player.dapai updates furiten AFTER this hook. Capture legality now, not in a timer.
    if (this.allow_hule(this.shoupai, tile)) choices.push(decision('ron', '론', { hule: '-' }))
    for (const [kind, melds] of [
      ['chi', this.get_chi_mianzi(this.shoupai, tile)],
      ['pon', this.get_peng_mianzi(this.shoupai, tile)],
      ['kan', this.get_gang_mianzi(this.shoupai, tile)],
    ] as const) {
      for (const meld of melds ?? [])
        choices.push(decision(kind, kind === 'chi' ? '치' : kind === 'pon' ? '퐁' : '대명깡', { fulou: meld }, undefined, meld))
    }
    if (choices.length) choices.push(decision('pass', '넘기기', {}))
    this.offer(choices)
  }

  action_fulou(meld: Meld): void {
    this.event = `${this.model.player[this.model.player_id[meld.l]]}님의 울기: ${meldTiles(meld.m).map(tileName).join(' · ')}`
    const isKan = /^[mpsz]\d{4}/.test(meld.m)
    this.offer(meld.l === this._menfeng && !isKan ? this.discardChoices() : [])
  }

  action_gang(meld: Meld): void {
    this.event = `${this.model.player[this.model.player_id[meld.l]]}님이 깡을 선언했습니다`
    const choices: Decision[] = []
    // Core rules permit robbing added kans, not closed kans (including thirteen orphans).
    if (meld.l !== this._menfeng && !/^[mpsz]\d{4}$/.test(meld.m)) {
      const tile = meld.m[0] + meld.m.slice(-1) + '_+=-'[(4 + meld.l - this._menfeng) % 4]
      if (this.allow_hule(this.shoupai, tile, true)) {
        choices.push(decision('ron', '론 · 창깡', { hule: '-' }))
        choices.push(decision('pass', '넘기기', {}))
      }
    }
    this.offer(choices)
  }

  private deltas(values: number[]): number[] {
    const mapped = [0, 0, 0, 0]
    this.model.player_id.forEach((id, wind) => { mapped[id] = values[wind] })
    return mapped
  }

  action_hule(win: Win): void {
    const winner = this.model.player[this.model.player_id[win.l]]
    const hand = Majiang.Shoupai.fromString(win.shoupai)
    this.result = {
      title: win.baojia === null ? '쯔모 · 직접 뽑은 패로 화료' : '론 · 버려진 패로 화료',
      winner, fu: win.fu, han: win.fanshu, points: win.defen,
      yaku: win.hupai.map(yaku => ({ name: yaku.name, han: String(yaku.fanshu) })),
      deltas: this.deltas(win.fenpei), hand: handTiles(hand), melds: [...hand._fulou],
      ura: win.fubaopai ?? [],
    }
    this.event = `${winner}님이 화료했습니다`
    this.offer([decision('continue', '다음으로', {})])
  }

  action_pingju(draw: ExhaustiveDraw): void {
    this.result = {
      title: drawNames[draw.name] ?? (draw.name || '유국'), yaku: [],
      deltas: this.deltas(draw.fenpei), ura: [],
    }
    this.event = this.result.title
    this.offer([decision('continue', '다음으로', {})])
  }

  action_jieju(summary: Summary): void {
    this.event = '대국이 종료되었습니다'
    this.hooks.finished(summary)
    this.offer([])
  }
}

const drawNames: Record<string, string> = {
  荒牌平局: '황패 유국', 流し満貫: '나가시 만관', 九種九牌: '구종구패',
  三家和: '삼가화', 四家立直: '사가리치', 四風連打: '사풍연타', 四開槓: '사개깡',
}

function decision(kind: Choice['kind'], label: string, reply: Reply, tile?: string, meld?: string): Decision {
  return { choice: { id: `${kind}:${tile ?? meld ?? ''}`, kind, label, ...(tile ? { tile } : {}), ...(meld ? { meld } : {}) }, reply }
}

export function chooseBot(player: TablePlayer, decisions: Decision[]): Decision {
  const win = decisions.find(d => d.choice.kind === 'tsumo' || d.choice.kind === 'ron')
  if (win) return win
  const discards = decisions.filter(d => d.choice.kind === 'riichi' || d.choice.kind === 'discard')
  if (!discards.length) return decisions.find(d => d.choice.kind === 'pass') ?? decisions[0]

  const visible = new Map<string, number>()
  const count = (tile: string) => {
    const normalized = tile.slice(0, 2).replace('0', '5')
    visible.set(normalized, (visible.get(normalized) ?? 0) + 1)
  }
  handTiles(player.shoupai).forEach(count)
  player.model.he.forEach(river => river._pai.filter(p => !/[+=-]$/.test(p)).forEach(count))
  player.model.shoupai.forEach(hand => hand._fulou.forEach(meld => {
    for (const rank of meld.match(/\d/g) ?? []) count(meld[0] + rank)
  }))
  player.shan.baopai.forEach(count)
  const cache = new Map<string, number>()
  let best = discards[0]
  let bestValue = -Infinity
  for (const candidate of discards) {
    const tile = candidate.reply.dapai!.replace(/\*$/, '')
    let value = cache.get(tile)
    if (value === undefined) {
      const hand = player.shoupai.clone().dapai(tile)
      const shanten = Majiang.Util.xiangting(hand)
      const ukeire = Majiang.Util.tingpai(hand).reduce((sum, p) => sum + Math.max(0, 4 - (visible.get(p) ?? 0)), 0)
      value = -shanten * 1000 + ukeire * 2 - (tile[1] === '0' ? 1 : 0)
      cache.set(tile, value)
    }
    if (candidate.choice.kind === 'riichi') value += 0.5
    if (value > bestValue) { best = candidate; bestValue = value }
  }
  return best
}
