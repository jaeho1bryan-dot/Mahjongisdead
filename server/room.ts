import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket } from 'ws'
import type { Choice, GameMode, RoomState, Seat, ServerMessage } from '../shared/protocol.js'
import { handTiles, Majiang, type ReplyCallback, type Summary } from './engine.js'
import { chooseBot, TablePlayer, type Decision } from './player.js'

export interface RoomOptions { actionTimeoutMs: number; botDelayMs: number }
interface Prompt {
  id: string
  decisions: Decision[]
  callback: ReplyCallback
  deadline: number
  timer: ReturnType<typeof setTimeout>
}
export interface Occupant {
  id: number
  name: string
  token?: string
  socket?: WebSocket
  player?: TablePlayer
  prompt?: Prompt
  auto: boolean
  autoplayAt: number
}

class DisposableGame extends Majiang.Game {
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private disposed = false

  override delay(callback: () => void, timeout = 0): void {
    if (this.disposed) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (!this.disposed) callback()
    }, timeout)
    this.timers.add(timer)
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    clearTimeout(this._timeout_id)
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }
}

export function send(socket: WebSocket | undefined, message: ServerMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > 1_048_576) { socket.terminate(); return }
  socket.send(JSON.stringify(message))
}

export class Room {
  readonly seats: (Occupant | undefined)[] = Array<undefined>(4).fill(undefined)
  readonly createdAt = Date.now()
  lastActive = Date.now()
  owner = 0
  status: RoomState['status'] = 'waiting'
  ranking?: RoomState['ranking']
  disposed = false
  private game?: DisposableGame
  private broadcastTimer?: ReturnType<typeof setTimeout>
  readonly id: string
  readonly mode: GameMode
  private readonly options: RoomOptions

  constructor(id: string, mode: GameMode, options: RoomOptions) {
    this.id = id
    this.mode = mode
    this.options = options
  }

  join(name: string, socket: WebSocket): Occupant {
    if (this.status !== 'waiting') throw new Error('This game has already started')
    const id = this.seats.findIndex(seat => !seat)
    if (id < 0) throw new Error('This room is full')
    const slot: Occupant = { id, name, token: randomBytes(32).toString('hex'), socket, auto: false, autoplayAt: 0 }
    this.seats[id] = slot
    this.lastActive = Date.now()
    this.session(slot)
    this.broadcast()
    return slot
  }

  resume(token: string, socket: WebSocket): Occupant {
    const tokenBytes = Buffer.from(token, 'hex')
    const slot = this.seats.find(seat => seat?.token && timingSafeEqual(Buffer.from(seat.token, 'hex'), tokenBytes))
    if (!slot) throw new Error('Invalid room or session token')
    const oldSocket = slot.socket
    slot.socket = socket
    slot.auto = false
    slot.autoplayAt = 0
    if (oldSocket && oldSocket !== socket) oldSocket.close(4001, 'Session resumed elsewhere')
    if (slot.prompt) this.resetTimer(slot, this.options.actionTimeoutMs)
    this.lastActive = Date.now()
    this.session(slot)
    this.broadcast()
    return slot
  }

  private session(slot: Occupant): void {
    if (slot.token) send(slot.socket, { type: 'session', roomId: this.id, token: slot.token })
  }

  disconnect(slot: Occupant, socket: WebSocket): void {
    if (slot.socket !== socket) return
    slot.socket = undefined
    slot.autoplayAt = Date.now() + this.options.actionTimeoutMs
    this.broadcast()
  }

  leave(slot: Occupant): void {
    slot.socket = undefined
    slot.token = undefined
    if (this.status === 'waiting') this.seats[slot.id] = undefined
    else {
      slot.auto = true
      slot.autoplayAt = 0
      if (slot.prompt) this.resetTimer(slot, this.options.botDelayMs)
    }
    if (slot.id === this.owner) {
      this.owner = this.seats.find(seat => seat?.token && seat.socket)?.id
        ?? this.seats.find(seat => seat?.token)?.id ?? this.seats.find(seat => seat)?.id ?? 0
    }
    this.lastActive = Date.now()
    this.broadcast()
  }

  start(slot: Occupant): void {
    if (slot.id !== this.owner) throw new Error('Only the host can start the game')
    if (this.status !== 'waiting') throw new Error('This game has already started')
    this.status = 'playing'
    for (let id = 0; id < 4; id++) {
      this.seats[id] ??= { id, name: `Bot ${id + 1}`, auto: true, autoplayAt: 0 }
      const seat = this.seats[id]!
      seat.player = new TablePlayer({
        decide: (_player, decisions, callback) => this.prompt(seat, decisions, callback),
        changed: () => this.broadcast(),
        finished: summary => this.finish(summary),
      })
    }
    const rule = Majiang.rule({ '場数': this.mode === 'hand' ? 0 : this.mode === 'east' ? 1 : 2 })
    this.game = new DisposableGame(this.seats.map(seat => seat!.player!), () => {}, rule, 'Mahjong is Dead')
    this.game.model.player = this.seats.map(seat => seat!.name)
    this.game.speed = 0
    this.game.kaiju()
    this.lastActive = Date.now()
    this.broadcast()
  }

  private prompt(slot: Occupant, decisions: Decision[], callback: ReplyCallback): void {
    if (this.disposed) return
    if (slot.prompt) clearTimeout(slot.prompt.timer)
    const delay = slot.socket ? this.options.actionTimeoutMs
      : Math.max(this.options.botDelayMs, slot.autoplayAt - Date.now())
    slot.prompt = {
      id: randomUUID(), decisions, callback, deadline: Date.now() + delay,
      timer: setTimeout(() => this.automatic(slot), delay),
    }
    this.broadcast()
  }

  private resetTimer(slot: Occupant, delay: number): void {
    if (!slot.prompt) return
    clearTimeout(slot.prompt.timer)
    slot.prompt.deadline = Date.now() + delay
    slot.prompt.timer = setTimeout(() => this.automatic(slot), delay)
  }

  private automatic(slot: Occupant): void {
    if (!slot.prompt || !slot.player || this.disposed) return
    if (!slot.socket) slot.auto = true
    this.resolve(slot, chooseBot(slot.player, slot.prompt.decisions))
  }

  private resolve(slot: Occupant, decision: Decision): void {
    const prompt = slot.prompt
    if (!prompt || this.disposed) return
    clearTimeout(prompt.timer)
    slot.prompt = undefined
    prompt.callback(decision.reply)
    this.broadcast()
  }

  act(slot: Occupant, promptId: string, choiceId: string): void {
    if (this.status !== 'playing' || !slot.prompt || slot.prompt.id !== promptId)
      throw new Error('This action is stale or it is not your turn')
    if (Date.now() >= slot.prompt.deadline) {
      this.automatic(slot)
      throw new Error('This decision has timed out')
    }
    const decision = slot.prompt.decisions.find(item => item.choice.id === choiceId)
    if (!decision) throw new Error('Illegal action; choose one of the offered actions')
    this.lastActive = Date.now()
    this.resolve(slot, decision)
  }

  private finish(summary: Summary): void {
    this.status = 'finished'
    this.ranking = summary.player.map((name, id) => ({ name, score: summary.defen[id], rank: summary.rank[id] }))
      .sort((a, b) => a.rank - b.rank)
    this.broadcast()
  }

  state(self: Occupant): RoomState {
    const model = self.player?.model
    const hasHand = Boolean(model?.shoupai?.length)
    const seats: Seat[] = this.seats.map((slot, id) => {
      const wind = hasHand ? model!.player_id.indexOf(id) : id
      const hand = hasHand ? model!.shoupai[wind] : undefined
      const ownTiles = hand && self.id === id ? handTiles(hand) : undefined
      const pendingDelta = this.status === 'playing' ? self.player?.result?.deltas[id] ?? 0 : 0
      return {
        id, name: slot?.name ?? 'Open seat', bot: Boolean(slot?.auto), connected: Boolean(slot?.socket),
        wind, score: (model?.defen?.[id] ?? 25000) + pendingDelta,
        concealed: hand ? handTiles(hand).length : 0,
        ...(ownTiles ? { hand: ownTiles } : {}),
        ...(self.id === id && hand?._zimo && /^[mpsz]\d$/.test(hand._zimo) ? { drawn: hand._zimo } : {}),
        melds: hand ? [...hand._fulou] : [], river: hasHand ? [...model!.he[wind]._pai] : [],
        riichi: Boolean(hand?.lizhi),
      }
    })
    const choices: Choice[] = self.prompt?.decisions.map(d => d.choice) ?? []
    return {
      roomId: this.id, mode: this.mode, status: this.status, self: self.id, owner: this.owner, seats,
      roundWind: model?.zhuangfeng ?? 0, handNumber: (model?.jushu ?? 0) + 1,
      honba: model?.changbang ?? 0, sticks: model?.lizhibang ?? 0,
      remaining: model?.shan?.paishu ?? 0, dora: [...(model?.shan?.baopai ?? [])],
      turn: hasHand && model!.lunban >= 0 ? model!.player_id[model!.lunban] : -1,
      choices, promptId: self.prompt?.id ?? null, deadline: self.prompt?.deadline ?? null,
      event: self.player?.event ?? 'Waiting for players', result: self.player?.result ?? null,
      ...(this.ranking ? { ranking: this.ranking } : {}),
    }
  }

  broadcast(): void {
    if (this.disposed || this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined
      if (this.disposed) return
      for (const slot of this.seats) {
        if (slot?.socket) send(slot.socket, { type: 'state', state: this.state(slot) })
      }
    }, 0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.broadcastTimer)
    for (const slot of this.seats) {
      if (slot?.prompt) clearTimeout(slot.prompt.timer)
      if (slot?.player) slot.player.disposed = true
      if (slot) {
        slot.prompt = undefined
        slot.socket?.close(4002, 'Room expired')
      }
    }
    this.game?.dispose()
  }
}
