import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test, { type TestContext } from 'node:test'
import { WebSocket } from 'ws'
import type { ClientMessage, RoomState, ServerMessage } from '../shared/protocol.js'
import { createServer, originAllowed, parseMessage, type ServerOptions } from '../server/index.js'
import { DisposableGame, Room } from '../server/room.js'
import { handTiles, Majiang } from '../server/engine.js'

class Client {
  readonly ws: WebSocket
  readonly messages: ServerMessage[] = []
  private waiters: (() => void)[] = []
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    this.ws.on('error', () => {})
    this.ws.on('message', raw => {
      this.messages.push(JSON.parse(raw.toString()) as ServerMessage)
      for (const notify of [...this.waiters]) notify()
    })
  }
  async open(): Promise<this> {
    await new Promise<void>((done, reject) => {
      this.ws.once('open', done)
      this.ws.once('error', reject)
    })
    return this
  }
  send(message: ClientMessage): void { this.ws.send(JSON.stringify(message)) }
  wait<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeout = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((done, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.waiters = this.waiters.filter(fn => fn !== check)
      }
      const check = () => {
        const index = this.messages.findIndex(message => message.type === type
          && predicate(message as Extract<ServerMessage, { type: T }>))
        if (index < 0) return
        const [message] = this.messages.splice(index, 1)
        cleanup()
        done(message as Extract<ServerMessage, { type: T }>)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for ${type}; received ${this.messages.map(m => m.type).join(',')}`))
      }, timeout)
      this.waiters.push(check)
      check()
    })
  }
  async state(predicate: (state: RoomState) => boolean = () => true, timeout?: number): Promise<RoomState> {
    return (await this.wait('state', m => predicate(m.state), timeout)).state
  }
  close(): Promise<number> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve(1006)
    const closed = new Promise<number>(done => this.ws.once('close', code => done(code)))
    this.ws.close()
    return closed
  }
}

async function setup(t: TestContext, options: ServerOptions = {}) {
  const server = createServer({ actionTimeoutMs: 5000, botDelayMs: 1, ...options })
  const port = await server.listen()
  const clients: Client[] = []
  t.after(async () => {
    for (const client of clients) client.ws.terminate()
    await server.close()
  })
  return {
    server, port,
    async client() {
      const client = await new Client(port).open()
      clients.push(client)
      return client
    },
  }
}
function assertPrivate(state: RoomState): void {
  if (state.status === 'waiting') assert.ok(state.seats.length >= 1 && state.seats.length <= 4)
  else assert.equal(state.seats.length, 4)
  for (const seat of state.seats) {
    if (seat.id !== state.self) {
      assert.equal(Object.hasOwn(seat, 'hand'), false)
      assert.equal(Object.hasOwn(seat, 'drawn'), false)
    } else if (seat.hand) assert.equal(seat.hand.length + (seat.drawn ? 1 : 0), seat.concealed)
  }
  assert.ok(!JSON.stringify(state).includes('"shoupai"'))
  assert.ok(!JSON.stringify(state).includes('"token"'))
  assert.ok(!JSON.stringify(state).includes('"log"'))
}

test('strict input validation rejects malformed, oversized and ambiguous payloads', () => {
  assert.deepEqual(parseMessage('{"type":"join","name":" A ","roomId":"abcdef"}'), { type: 'join', name: 'A', roomId: 'ABCDEF' })
  for (const raw of [
    'null', '[]', '{}', 'garbage', '{"type":"start","extra":true}',
    '{"type":"create","name":"A","mode":["hand"]}', '{"type":"create","name":"A","mode":"unknown"}',
    '{"type":"join","name":"A","roomId":"../../"}', '{"type":"join","name":"\\n","roomId":"ABCDEF"}',
    '{"type":"resume","roomId":"ABCDEF","token":"bad"}',
    JSON.stringify({ type: 'create', name: 'x'.repeat(25), mode: 'hand' }),
  ]) assert.throws(() => parseMessage(raw), raw)
})

test('origin policy accepts only same host, configured development port or explicit allowlist', () => {
  assert.equal(originAllowed('http://localhost:3001', 'localhost:3001', [], null), true)
  assert.equal(originAllowed('http://localhost:5173', 'localhost:3001', [], 5173), true)
  assert.equal(originAllowed('http://localhost:5173', 'localhost:3001', [], null), false)
  assert.equal(originAllowed('https://trusted.example', 'localhost:3001', ['https://trusted.example'], null), true)
  for (const origin of ['null', 'http://evil.example:5173', 'ftp://localhost:3001', 'http://localhost:3001/evil', 'http://user@localhost:3001'])
    assert.equal(originAllowed(origin, 'localhost:3001', [], 5173), false)
})

test('create, join, session tokens, owner-only start, capacity and owner transfer', async t => {
  const env = await setup(t)
  const a = await env.client()
  a.send({ type: 'create', name: 'Host', mode: 'east' })
  const session = await a.wait('session')
  assert.match(session.roomId, /^[A-F0-9]{6}$/)
  assert.match(session.token, /^[a-f0-9]{64}$/)
  assertPrivate(await a.state())
  const b = await env.client()
  b.send({ type: 'join', roomId: session.roomId, name: 'Guest' })
  const second = await b.wait('session')
  assert.notEqual(second.token, session.token)
  const state = await b.state(s => s.seats[1].name === 'Guest')
  assert.equal(state.owner, 0)
  assert.equal(state.self, 1)
  b.send({ type: 'start' })
  assert.match((await b.wait('error')).message, /방장/)
  a.send({ type: 'leave' })
  await a.wait('left')
  const transferred = await b.state(s => s.owner === 1)
  assert.equal(transferred.seats.some(seat => seat.id === 0), false)
  assert.equal(transferred.seats.length, 1)
  b.send({ type: 'start' })
  const playing = await b.state(s => s.seats[s.self].concealed >= 13)
  assert.equal(playing.status, 'playing')
  assert.equal(playing.seats.filter(seat => seat.bot).length, 3)
  assertPrivate(playing)
  a.send({ type: 'join', roomId: session.roomId, name: 'Late' })
  assert.match((await a.wait('error')).message, /이미 대국/)
})

test('four-player gameplay keeps deals/draws private and rejects out-of-turn, illegal and stale choices', async t => {
  const env = await setup(t)
  const clients = await Promise.all([env.client(), env.client(), env.client(), env.client()])
  clients[0].send({ type: 'create', name: 'A', mode: 'south' })
  const { roomId } = await clients[0].wait('session')
  for (let id = 1; id < 4; id++) {
    clients[id].send({ type: 'join', name: String(id), roomId })
    await clients[id].wait('session')
  }
  const fifth = await env.client()
  fifth.send({ type: 'join', roomId, name: 'Extra' })
  assert.match((await fifth.wait('error')).message, /찼습니다/)
  clients[0].send({ type: 'start' })
  const states = await Promise.all(clients.map(client => client.state(s => s.remaining === 69)))
  states.forEach(assertPrivate)
  const turn = states[0].turn
  const own = states[turn]
  assert.equal(own.seats[turn].hand?.length, 13)
  assert.ok(own.seats[turn].drawn)
  assert.ok(own.choices.some(c => c.kind === 'discard' && c.tile === `${own.seats[turn].drawn}_`))
  for (const candidate of own.choices.filter(c => c.kind === 'discard')) {
    if (candidate.tile?.endsWith('_')) assert.equal(candidate.tile.slice(0, 2), own.seats[turn].drawn)
    else assert.ok(own.seats[turn].hand?.includes(candidate.tile!))
  }
  assert.ok(own.promptId)
  assert.ok(own.deadline! > Date.now())
  assert.ok(own.choices.some(c => c.kind === 'discard'))
  for (let id = 0; id < 4; id++) if (id !== turn) assert.equal(states[id].promptId, null)
  const choice = own.choices.find(c => c.kind === 'discard')!
  clients[(turn + 1) % 4].send({ type: 'act', promptId: own.promptId!, choiceId: choice.id })
  assert.match((await clients[(turn + 1) % 4].wait('error')).message, /차례가 아닙니다/)
  clients[turn].send({ type: 'act', promptId: own.promptId!, choiceId: 'ron:forged' })
  assert.match((await clients[turn].wait('error')).message, /허용되지 않은/)
  clients[turn].send({ type: 'act', promptId: own.promptId!, choiceId: choice.id })
  const after = await clients[turn].state(s => s.seats[turn].river.length > 0)
  assertPrivate(after)
  assert.equal(after.seats[turn].river[0].slice(0, 2), choice.tile?.slice(0, 2))
  clients[turn].send({ type: 'act', promptId: own.promptId!, choiceId: choice.id })
  assert.match((await clients[turn].wait('error')).message, /만료된 선택|차례가 아닙니다/)
})

test('reconnect restores only the bearer seat without extending its deadline; takeover revokes the old socket', async t => {
  const env = await setup(t)
  const a = await env.client()
  a.send({ type: 'create', name: 'Reconnect', mode: 'hand' })
  const session = await a.wait('session')
  a.send({ type: 'start' })
  const state = await a.state(s => s.choices.some(c => c.kind === 'discard'))
  assertPrivate(state)
  const wrong = await env.client()
  wrong.send({ type: 'resume', roomId: session.roomId, token: '0'.repeat(64) })
  assert.match((await wrong.wait('error')).message, /세션 정보가 올바르지/)
  const replacement = await env.client()
  await new Promise(done => setTimeout(done, 10))
  const closed = new Promise<number>(done => a.ws.once('close', code => done(code)))
  replacement.send({ type: 'resume', roomId: session.roomId, token: session.token })
  assert.equal(await closed, 4001)
  await replacement.wait('session')
  const restored = await replacement.state(s => s.promptId === state.promptId)
  assertPrivate(restored)
  assert.equal(restored.self, state.self)
  assert.equal(restored.deadline, state.deadline)
  assert.deepEqual(restored.seats[restored.self].hand, state.seats[state.self].hand)
  await replacement.close()
  const third = await env.client()
  third.send({ type: 'resume', roomId: session.roomId, token: session.token })
  await third.wait('session')
  const resumed = await third.state(s => s.promptId === state.promptId)
  assertPrivate(resumed)
  assert.equal(resumed.deadline, state.deadline)
  third.send({ type: 'leave' })
  await third.wait('left')
  const fourth = await env.client()
  fourth.send({ type: 'resume', roomId: session.roomId, token: session.token })
  assert.match((await fourth.wait('error')).message, /세션 정보가 올바르지/)
})

test('timed-out humans and paced bots complete a real game with results and final rankings', { timeout: 60_000 }, async t => {
  const env = await setup(t, { actionTimeoutMs: 2, botDelayMs: 2 })
  const client = await env.client()
  const seen: RoomState[] = []
  client.ws.on('message', raw => {
    const message = JSON.parse(raw.toString()) as ServerMessage
    if (message.type === 'state') seen.push(message.state)
  })
  client.send({ type: 'create', name: 'Automatic', mode: 'hand' })
  await client.wait('session')
  client.send({ type: 'start' })
  const final = await client.state(s => s.status === 'finished', 55_000)
  assert.ok(seen.some(s => s.result))
  seen.forEach(assertPrivate)
  assert.equal(final.ranking?.length, 4)
  assert.deepEqual(final.ranking?.map(r => r.rank), [1, 2, 3, 4])
  assert.equal(final.ranking?.reduce((sum, seat) => sum + seat.score, 0), 100000)
  assert.equal(final.seats.reduce((sum, seat) => sum + seat.score, 0), 100000)
  assert.equal(final.choices.length, 0)
  assert.equal(final.promptId, null)
})

test('disconnect triggers autoplay while keeping the reserved seat reconnectable', async t => {
  const env = await setup(t, { actionTimeoutMs: 50, botDelayMs: 5 })
  const client = await env.client()
  client.send({ type: 'create', name: 'Away', mode: 'south' })
  const session = await client.wait('session')
  client.send({ type: 'start' })
  await client.state(s => s.seats[0].concealed >= 13)
  await client.close()
  const room = env.server.rooms.get(session.roomId)!
  const until = Date.now() + 3000
  while (!room.seats[0]?.auto && Date.now() < until)
    await new Promise(done => setTimeout(done, 10))
  assert.equal(room.seats[0]?.token, session.token)
  assert.equal(room.seats[0]?.auto, true)
  const replacement = await env.client()
  replacement.send({ type: 'resume', roomId: session.roomId, token: session.token })
  await replacement.wait('session')
  const state = await replacement.state()
  assertPrivate(state)
  assert.equal(state.seats[0].name, 'Away')
  assert.equal(state.seats[0].bot, false)
})

test('HTTP health, static assets, SPA fallback and path/symlink containment', async t => {
  const root = resolve(`tests/.static-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  await writeFile(resolve(root, 'index.html'), '<!doctype html><title>Mahjong</title>')
  await writeFile(resolve(root, 'app.js'), 'console.log("ready")')
  await symlink(resolve('package.json'), resolve(root, 'outside.json'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = await setup(t, { distDir: root })
  const base = `http://127.0.0.1:${env.port}`
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true })
  const html = await fetch(`${base}/table/ABCDEF`)
  assert.equal(html.status, 200)
  assert.match(await html.text(), /Mahjong/)
  const js = await fetch(`${base}/app.js`)
  assert.match(js.headers.get('content-type')!, /javascript/)
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await fetch(`${base}/unknown.js`)).status, 404)
  assert.equal((await fetch(`${base}/outside.json`)).status, 403)
  assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 403)
  assert.equal((await fetch(`${base}/%00`)).status, 400)
  assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405)
  assert.equal(await (await fetch(`${base}/app.js`, { method: 'HEAD' })).text(), '')
})

test('WebSocket origin/path restrictions, payload size and rate limits', async t => {
  const env = await setup(t, { rateLimit: 3, devPort: null })
  for (const [path, origin, expected] of [
    ['/ws', 'http://evil.example', 403], ['/not-ws', undefined, 404],
  ] as const) {
    const status = await new Promise<number>((done, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}${path}`, origin ? { origin } : {})
      ws.on('error', () => {})
      ws.once('open', () => { ws.terminate(); reject(new Error('Unexpected accepted connection')) })
      ws.once('unexpected-response', (_req, response) => {
        response.resume()
        done(response.statusCode!)
        ws.terminate()
      })
    })
    assert.equal(status, expected)
  }
  const limited = await env.client()
  const limitClosed = new Promise<number>(done => limited.ws.once('close', code => done(code)))
  for (let n = 0; n < 4; n++) limited.ws.send('{}')
  assert.equal(await limitClosed, 1008)
  const oversized = await env.client()
  const payloadClosed = new Promise<number>(done => oversized.ws.once('close', code => done(code)))
  oversized.ws.send('x'.repeat(4097))
  assert.equal(await payloadClosed, 1009)
})

test('finite room capacity, expiry and idempotent graceful disposal', async t => {
  const env = await setup(t, { maxRooms: 1, roomIdleMs: 100, sweepIntervalMs: 5 })
  const a = await env.client()
  const b = await env.client()
  a.send({ type: 'create', name: 'Host', mode: 'hand' })
  await a.wait('session')
  b.send({ type: 'create', name: 'Other', mode: 'hand' })
  assert.match((await b.wait('error')).message, /가득 찼습니다/)
  const expired = new Promise<number>(done => a.ws.once('close', code => done(code)))
  assert.equal(await expired, 4002)
  assert.equal(env.server.rooms.size, 0)
  await env.server.close()
  await env.server.close()
})

test('heartbeat terminates unresponsive connections', async t => {
  const env = await setup(t, { heartbeatMs: 15 })
  const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws`, { autoPong: false })
  ws.on('error', () => {})
  t.after(() => ws.terminate())
  const code = await new Promise<number>(done => ws.once('close', value => done(value)))
  assert.equal(code, 1006)
})

test('the first dealer is drawn at random instead of always being the room owner', async () => {
  const dealers = new Set<number>()
  for (let i = 0; i < 40 && dealers.size < 4; i++) {
    const room = new Room('DEALER', 'hand', { actionTimeoutMs: 60_000, botDelayMs: 60_000 })
    const owner = room.join('Host', undefined as unknown as WebSocket)
    room.start(owner)
    const until = Date.now() + 2000
    while (!room.state(owner).seats[0].concealed && Date.now() < until)
      await new Promise(done => setTimeout(done, 1))
    const state = room.state(owner)
    assert.equal(state.owner, 0)
    dealers.add(state.seats.find(seat => seat.wind === 0)!.id)
    room.dispose()
  }
  assert.ok(dealers.size > 1, `dealer was always seat ${[...dealers]}`)
})

for (const secondRon of [true, false]) test(`ron cancels pending calls immediately and preserves a second player's ${secondRon ? 'ron' : 'pass'}`, async t => {
  const wall = new Majiang.Shan(Majiang.rule())
  const pool = wall._pai.slice()
  const take = (tile: string) => {
    const index = pool.indexOf(tile)
    assert.ok(index >= 0, `No ${tile} available`)
    return pool.splice(index, 1)[0]
  }
  const winner = handTiles(Majiang.Shoupai.fromString('m234456p22345s45')).map(take)
  const second = handTiles(Majiang.Shoupai.fromString('m234456p22345s45')).map(take)
  const caller = handTiles(Majiang.Shoupai.fromString('m17p18s66789z1234')).map(take)
  const discard = take('s6')
  const firstDraw = take('z7')
  const dealer = [discard, ...pool.splice(0, 12)]
  wall._pai = [...pool, ...[...dealer, ...winner, ...caller, ...second, firstDraw].reverse()]
  wall._baopai = [wall._pai[4]]
  wall._fubaopai = [wall._pai[9]]
  const qipai = DisposableGame.prototype.qipai
  t.mock.method(DisposableGame.prototype, 'qipai', function (this: DisposableGame) { qipai.call(this, wall) })
  const room = new Room('RONTEST', 'hand', { actionTimeoutMs: 60_000, botDelayMs: 60_000 })
  t.after(() => room.dispose())
  for (let id = 0; id < 4; id++) room.join(String(id), undefined as unknown as WebSocket)
  room.start(room.seats[0]!)
  const wait = async (ready: () => boolean) => {
    const until = Date.now() + 2000
    while (!ready() && Date.now() < until) await new Promise(done => setTimeout(done, 1))
    assert.ok(ready(), 'Game did not reach expected phase')
  }
  await wait(() => room.seats.some(slot => slot?.prompt?.decisions.some(d => d.reply.dapai === 's6')))
  const byWind = (wind: number) => room.seats.find(slot => slot && room.state(slot).seats[slot.id].wind === wind)!
  const dealerSlot = byWind(0), winnerSlot = byWind(1), callerSlot = byWind(2), secondSlot = byWind(3)
  const act = (slot: typeof winnerSlot, kind: string) => {
    const state = room.state(slot)
    room.act(slot, state.promptId!, state.choices.find(c => c.kind === kind)!.id)
  }
  room.act(dealerSlot, dealerSlot.prompt!.id, dealerSlot.prompt!.decisions.find(d => d.reply.dapai === 's6')!.choice.id)
  await wait(() => Boolean(winnerSlot.prompt && callerSlot.prompt && secondSlot.prompt))
  assert.ok(room.state(winnerSlot).choices.some(c => c.kind === 'chi'))
  const oldCaller = room.state(callerSlot)
  const pon = oldCaller.choices.find(c => c.kind === 'pon')!
  assert.ok(pon)
  act(secondSlot, 'ron')
  assert.deepEqual(room.state(callerSlot).choices, [])
  assert.equal(room.state(callerSlot).promptId, null)
  assert.throws(() => room.act(callerSlot, oldCaller.promptId!, pon.id), /만료된 선택/)
  assert.deepEqual(room.state(winnerSlot).choices.map(c => c.kind), ['ron', 'pass'])
  assert.throws(() => room.act(winnerSlot, winnerSlot.prompt!.id, 'chi:s4-56'), /허용되지 않은/)
  act(winnerSlot, secondRon ? 'ron' : 'pass')
  await wait(() => Boolean(room.state(secondSlot).result))
  assert.ok(room.seats.every(slot => room.state(slot!).choices.every(c => c.kind === 'continue')))
  if (secondRon) {
    const firstWinner = room.state(secondSlot).result!.winner
    assert.equal(firstWinner, winnerSlot.name)
    for (const slot of room.seats) act(slot!, 'continue')
    await wait(() => room.state(secondSlot).result?.winner !== firstWinner)
    assert.equal(room.state(secondSlot).result!.winner, secondSlot.name)
  } else assert.equal(room.state(secondSlot).result!.winner, secondSlot.name)
})
