import { createRequire } from 'node:module'

export type Rule = Record<string, unknown>
export interface Hand {
  _bingpai: { _: number; m: number[]; p: number[]; s: number[]; z: number[] }
  _fulou: string[]
  _zimo: string | null
  lizhi: boolean
  menqian: boolean
  clone(): Hand
  toString(): string
  zimo(tile: string, check?: boolean): Hand
  dapai(tile: string, check?: boolean): Hand
  fulou(meld: string, check?: boolean): Hand
  gang(meld: string, check?: boolean): Hand
  get_dapai(check?: boolean): string[]
}
export interface River { _pai: string[]; find(tile: string): boolean }
export interface Board {
  player: string[]
  player_id: number[]
  defen: number[]
  zhuangfeng: number
  jushu: number
  changbang: number
  lizhibang: number
  lunban: number
  shoupai: Hand[]
  he: River[]
  shan: { paishu: number; baopai: string[]; fubaopai?: string[] } | null
  menfeng(id: number): number
}
export interface Draw { l: number; p: string }
export interface Meld { l: number; m: string }
export interface Win {
  l: number
  shoupai: string
  baojia: number | null
  fubaopai: string[] | null
  fu?: number
  fanshu?: number
  damanguan?: number
  defen: number
  hupai: { name: string; fanshu: number | string }[]
  fenpei: number[]
}
export interface ExhaustiveDraw { name: string; shoupai: string[]; fenpei: number[] }
export interface Summary { defen: number[]; rank: number[]; player: string[] }
export interface InitialHand {
  zhuangfeng: number; jushu: number; changbang: number; lizhibang: number
  defen: number[]; baopai: string; shoupai: string[]
}
export interface EngineMessage {
  kaiju?: { id: number; rule: Rule; title: string; player: string[]; qijia: number }
  qipai?: InitialHand
  zimo?: Draw
  gangzimo?: Draw
  dapai?: Draw
  fulou?: Meld
  gang?: Meld
  kaigang?: { baopai: string }
  hule?: Win
  pingju?: ExhaustiveDraw
  jieju?: Summary
}
export interface Reply { dapai?: string; fulou?: string; gang?: string; hule?: string; daopai?: string }
export type ReplyCallback = (reply?: Reply) => void
export interface EnginePlayer {
  _id: number
  _menfeng: number
  _rule: Rule
  _neng_rong: boolean
  _diyizimo: boolean
  _callback?: ReplyCallback
  model: Board
  shoupai: Hand
  he: River
  shan: NonNullable<Board['shan']>
  action(message: EngineMessage, callback?: ReplyCallback): void
  get_dapai(hand: Hand): string[]
  get_chi_mianzi(hand: Hand, tile: string): string[] | null
  get_peng_mianzi(hand: Hand, tile: string): string[] | null
  get_gang_mianzi(hand: Hand, tile?: string | null): string[] | null
  allow_lizhi(hand: Hand, tile?: string): boolean | string[]
  allow_hule(hand: Hand, tile?: string | null, yaku?: boolean): boolean
  allow_pingju(hand: Hand): boolean
}
export interface EngineGame {
  model: Board
  speed: number
  _timeout_id?: ReturnType<typeof setTimeout>
  kaiju(dealer?: number): void
  stop(callback?: () => void): void
  delay(callback: () => void, timeout?: number): void
  do_sync(): EngineGame
}
interface GameConstructor {
  new(players: EnginePlayer[], callback?: (summary: Summary) => void, rule?: Rule, title?: string): EngineGame
  get_dapai(rule: Rule, hand: Hand): string[]
  get_chi_mianzi(rule: Rule, hand: Hand, tile: string, remaining: number): string[] | null
  get_peng_mianzi(rule: Rule, hand: Hand, tile: string, remaining: number): string[] | null
  get_gang_mianzi(rule: Rule, hand: Hand, tile: string | null, remaining: number, kans: number): string[] | null
  allow_lizhi(rule: Rule, hand: Hand, tile: string | null, remaining: number, score: number): boolean | string[]
  allow_hule(rule: Rule, hand: Hand, tile: string | null, round: number, wind: number, yaku?: boolean, ronAllowed?: boolean): boolean
  allow_pingju(rule: Rule, hand: Hand, firstDraw: boolean): boolean
}
export interface Score {
  hupai?: { name: string; fanshu: number | string }[]
  fu?: number
  fanshu?: number
  damanguan?: number
  defen?: number
  fenpei?: number[]
}
interface Engine {
  rule(overrides?: Rule): Rule
  Player: new() => EnginePlayer
  Game: GameConstructor
  Shoupai: { new(tiles?: string[]): Hand; fromString(value: string): Hand }
  Shan: {
    new(rule?: Rule): {
      paishu: number; baopai: string[]; zimo(): string; gangzimo(): string
      kaigang(): void; close(): void; fubaopai: string[]
    }
  }
  Util: {
    xiangting(hand: Hand): number
    tingpai(hand: Hand): string[]
    hule(hand: Hand, winningTile: string | null, parameters: Record<string, unknown>): Score
  }
}

// majiang-core is CommonJS and ships no declarations. Keep the typed boundary here.
export const Majiang = createRequire(import.meta.url)('@kobalab/majiang-core') as Engine

export function handTiles(hand: Hand): string[] {
  const tiles: string[] = Array<string>(hand._bingpai._).fill('_')
  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const counts = hand._bingpai[suit]
    for (let n = 1; n < counts.length; n++) {
      const reds = n === 5 && suit !== 'z' ? counts[0] : 0
      for (let i = 0; i < counts[n]; i++) tiles.push(`${suit}${i < reds ? 0 : n}`)
    }
  }
  return tiles
}
