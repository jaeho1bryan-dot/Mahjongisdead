import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket } from 'ws'
import type { Choice, GameMode, RoomState, Seat, ServerMessage } from '../shared/protocol.js'
import { canRobClosedKan, createSecureWall, handTiles, Majiang, type ReplyCallback, type Summary, type Wall } from './engine.js'
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

export class DisposableGame extends Majiang.Game {
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private disposed = false

  override qipai(wall?: Wall): void {
    if (!this.disposed) super.qipai(wall ?? createSecureWall(this._rule))
  }

  // The core engine never lets anyone rob a closed kan. Allow the standard exception for thirteen orphans.
  override reply_gang(): void {
    const kan = this._gang
    if (!kan || !/^[mpsz]\d{4}$/.test(kan)) return super.reply_gang()
    const model = this.model
    for (let i = 1; i < 4; i++) {
      const seat = (model.lunban + i) % 4
      const tile = kan[0] + kan.slice(-1) + '_+=-'[(4 + model.lunban - seat) % 4]
      if (!canRobClosedKan(model.shoupai[seat], tile, this._neng_rong[seat])) continue
      if (this.get_reply(seat).hule) {
        if (this._rule['最大同時和了数'] === 1 && this._hule.length) continue
        this.say('rong', seat)
        this._hule.push(seat)
      } else this._neng_rong[seat] = false
    }
    if (this._hule.length) return this.delay(() => this.hule())
    this.delay(() => this.gangzimo(), 0)
  }

  override hule(): void {
    if (this._hule.length === 3 && this._rule['最大同時和了数'] === 2) {
      return this.pingju('三家和', this.model.shoupai.map(hand => hand.toString()))
    }
    super.hule()
  }

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
  private ronDeclared = false
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
    if (this.status !== 'waiting') throw new Error('이미 대국이 시작되었습니다')
    const id = this.seats.findIndex(seat => !seat)
    if (id < 0) throw new Error('대기실의 모든 자리가 찼습니다')
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
    if (!slot) throw new Error('대기실 코드 또는 세션 정보가 올바르지 않습니다')
    const oldSocket = slot.socket
    slot.socket = socket
    slot.auto = false
    slot.autoplayAt = 0
    if (oldSocket && oldSocket !== socket) oldSocket.close(4001, '다른 연결에서 세션을 복구했습니다')
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
    if (slot.id !== this.owner) throw new Error('방장만 대국을 시작할 수 있습니다')
    if (this.status !== 'waiting') throw new Error('이미 대국이 시작되었습니다')
    this.status = 'playing'
    for (let id = 0; id < 4; id++) {
      this.seats[id] ??= { id, name: `봇 ${id + 1}`, auto: true, autoplayAt: 0 }
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
    this.game.kaiju(randomInt(4))
    this.lastActive = Date.now()
    this.broadcast()
  }

  private prompt(slot: Occupant, decisions: Decision[], callback: ReplyCallback): void {
    if (this.disposed) return
    if (decisions.some(d => !['ron', 'pass', 'chi', 'pon', 'kan'].includes(d.choice.kind)))
      this.ronDeclared = false
    if (this.ronDeclared) {
      if (!decisions.some(d => d.choice.kind === 'ron')) { callback({}); return }
      decisions = decisions.filter(d => d.choice.kind === 'ron' || d.choice.kind === 'pass')
    }
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
    if (decision.choice.kind === 'ron') {
      this.ronDeclared = true
      for (const other of this.seats) {
        if (!other?.prompt) continue
        if (other.prompt.decisions.some(d => d.choice.kind === 'ron')) {
          other.prompt.decisions = other.prompt.decisions.filter(d => d.choice.kind === 'ron' || d.choice.kind === 'pass')
        } else {
          this.resolve(other, { choice: { id: 'pass:', kind: 'pass', label: '넘기기' }, reply: {} })
        }
      }
    }
    prompt.callback(decision.reply)
    this.broadcast()
  }

  act(slot: Occupant, promptId: string, choiceId: string): void {
    if (this.status !== 'playing' || !slot.prompt || slot.prompt.id !== promptId)
      throw new Error('만료된 선택이거나 현재 자신의 차례가 아닙니다')
    if (Date.now() >= slot.prompt.deadline) {
      this.automatic(slot)
      throw new Error('선택 시간이 초과되었습니다')
    }
    const decision = slot.prompt.decisions.find(item => item.choice.id === choiceId)
    if (!decision) throw new Error('허용되지 않은 선택입니다. 표시된 행동을 선택해 주세요')
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
      const drawn = self.id === id && hand?._zimo && /^[mpsz]\d$/.test(hand._zimo) ? hand._zimo : undefined
      if (ownTiles && drawn) {
        const index = ownTiles.indexOf(drawn)
        if (index >= 0) ownTiles.splice(index, 1)
      }
      const pendingDelta = this.status === 'playing' ? self.player?.result?.deltas[id] ?? 0 : 0
      return {
        id, name: slot?.name ?? '빈자리', bot: Boolean(slot?.auto), connected: Boolean(slot?.socket),
        wind, score: (model?.defen?.[id] ?? 25000) + pendingDelta,
        concealed: hand ? handTiles(hand).length : 0,
        ...(ownTiles ? { hand: ownTiles } : {}),
        ...(drawn ? { drawn } : {}),
        melds: hand ? [...hand._fulou] : [], river: hasHand ? [...model!.he[wind]._pai] : [],
        riichi: Boolean(hand?.lizhi),
      }
    }).filter(seat => this.status !== 'waiting' || Boolean(this.seats[seat.id]))
    const choices: Choice[] = self.prompt?.decisions.map(d => d.choice) ?? []
    return {
      roomId: this.id, mode: this.mode, status: this.status, self: self.id, owner: this.owner, seats,
      roundWind: model?.zhuangfeng ?? 0, handNumber: (model?.jushu ?? 0) + 1,
      honba: model?.changbang ?? 0, sticks: model?.lizhibang ?? 0,
      remaining: model?.shan?.paishu ?? 0, dora: [...(model?.shan?.baopai ?? [])],
      turn: hasHand && model!.lunban >= 0 ? model!.player_id[model!.lunban] : -1,
      choices, promptId: self.prompt?.id ?? null, deadline: self.prompt?.deadline ?? null,
      event: self.player?.event ?? '참가자를 기다리고 있습니다', result: self.player?.result ?? null,
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
        slot.socket?.close(4002, '대기실 이용 시간이 만료되었습니다')
      }
    }
    this.game?.dispose()
  }
}
