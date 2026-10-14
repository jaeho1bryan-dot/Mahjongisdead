export type GameMode = 'hand' | 'east' | 'south'
export type ActionKind = 'discard' | 'riichi' | 'chi' | 'pon' | 'kan' | 'tsumo' | 'ron' | 'pass' | 'abort' | 'continue'

export interface Choice {
  id: string
  kind: ActionKind
  label: string
  tile?: string
  meld?: string
}

export interface Seat {
  id: number
  name: string
  bot: boolean
  connected: boolean
  wind: number
  score: number
  concealed: number
  hand?: string[]
  drawn?: string
  melds: string[]
  river: string[]
  riichi: boolean
}

export interface HandResult {
  title: string
  winner?: string
  fu?: number
  han?: number
  yakuman?: number
  points?: number
  yaku: { name: string; han: string }[]
  deltas: number[]
  hand?: string[]
  melds?: string[]
  ura: string[]
}

export interface RoomState {
  roomId: string
  mode: GameMode
  status: 'waiting' | 'playing' | 'finished'
  self: number
  owner: number
  seats: Seat[]
  roundWind: number
  handNumber: number
  honba: number
  sticks: number
  remaining: number
  dora: string[]
  turn: number
  choices: Choice[]
  promptId: string | null
  deadline: number | null
  event: string
  result: HandResult | null
  ranking?: { name: string; score: number; rank: number }[]
}

export type ClientMessage =
  | { type: 'create'; name: string; mode: GameMode }
  | { type: 'join'; name: string; roomId: string }
  | { type: 'resume'; roomId: string; token: string }
  | { type: 'start' }
  | { type: 'act'; promptId: string; choiceId: string }
  | { type: 'leave' }

export type ServerMessage =
  | { type: 'session'; roomId: string; token: string }
  | { type: 'state'; state: RoomState }
  | { type: 'error'; message: string }
  | { type: 'left' }
