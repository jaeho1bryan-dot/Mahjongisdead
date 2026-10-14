import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import type { ClientMessage } from '../shared/protocol.js'
import { Room, send, type Occupant } from './room.js'

export interface ServerOptions {
  actionTimeoutMs?: number
  botDelayMs?: number
  maxRooms?: number
  maxConnections?: number
  maxConnectionsPerIp?: number
  roomIdleMs?: number
  roomLifetimeMs?: number
  sweepIntervalMs?: number
  heartbeatMs?: number
  rateLimit?: number
  rateWindowMs?: number
  distDir?: string
  allowedOrigins?: string[]
  devPort?: number | null
}
interface Connection {
  room?: Room
  seat?: Occupant
  alive: boolean
  messages: number
  windowStart: number
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function shortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function parseMessage(raw: string): ClientMessage {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Invalid JSON') }
  if (!record(value) || typeof value.type !== 'string') throw new Error('Invalid message')
  const exact = (keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  const name = () => {
    if (!shortString(value.name, 24) || !value.name.trim()
      || [...value.name].some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)))
      throw new Error('Name must contain 1–24 visible characters')
    return value.name.trim()
  }
  const roomId = () => {
    if (typeof value.roomId !== 'string' || !/^[A-Fa-f0-9]{6}$/.test(value.roomId))
      throw new Error('Enter a valid six-character room code')
    return value.roomId.toUpperCase()
  }
  switch (value.type) {
    case 'create':
      if (exact(['type', 'name', 'mode']) && typeof value.mode === 'string' && ['hand', 'east', 'south'].includes(value.mode))
        return { type: 'create', name: name(), mode: value.mode as 'hand' | 'east' | 'south' }
      break
    case 'join':
      if (exact(['type', 'name', 'roomId'])) return { type: 'join', name: name(), roomId: roomId() }
      break
    case 'resume':
      if (exact(['type', 'roomId', 'token']) && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token))
        return { type: 'resume', roomId: roomId(), token: value.token }
      break
    case 'start':
    case 'leave':
      if (exact(['type'])) return { type: value.type }
      break
    case 'act':
      if (exact(['type', 'promptId', 'choiceId']) && shortString(value.promptId, 80) && shortString(value.choiceId, 80))
        return { type: 'act', promptId: value.promptId, choiceId: value.choiceId }
      break
  }
  throw new Error('Invalid message or unsupported action')
}

export function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[], devPort: number | null): boolean {
  if (!origin) return true // Native/non-browser WebSocket clients do not send Origin.
  if (!host || origin === 'null') return false
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return false
    if (allowed.includes(url.origin)) return true
    const target = new URL(`http://${host}`)
    return url.host === target.host || (devPort !== null && url.hostname === target.hostname && url.port === String(devPort))
  } catch { return false }
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)
}

async function serve(req: IncomingMessage, res: ServerResponse, dist: string): Promise<void> {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
    return
  }
  let pathname: string
  try {
    if (!req.url || req.url.length > 2048) throw new Error('Invalid path')
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path')
  } catch { res.writeHead(400).end('Invalid path'); return }
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(req.method === 'HEAD' ? undefined : '{"ok":true}')
    return
  }
  if (pathname === '/ws') { res.writeHead(426).end('WebSocket upgrade required'); return }
  const requested = resolve(dist, `.${pathname}`)
  if (!inside(dist, requested)) { res.writeHead(403).end('Forbidden'); return }
  let file = requested
  try {
    let details = await stat(file).catch(() => null)
    if (!details?.isFile()) {
      if (extname(pathname)) { res.writeHead(404).end('Not found'); return }
      file = resolve(dist, 'index.html')
      details = await stat(file)
    }
    const [realRoot, realFile] = await Promise.all([realpath(dist), realpath(file)])
    if (!inside(realRoot, realFile) || !details.isFile() || details.size > 32 * 1024 * 1024) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const html = extname(file) === '.html'
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Content-Length': details.size,
      'Cache-Control': html ? 'no-store' : 'public, max-age=3600',
    })
    if (req.method === 'HEAD') res.end()
    else createReadStream(realFile).on('error', () => res.destroy()).pipe(res)
  } catch {
    if (!res.headersSent) res.writeHead(404).end('Build the client to serve the application')
    else res.destroy()
  }
}

export function createServer(options: ServerOptions = {}) {
  const rooms = new Map<string, Room>()
  const connections = new Map<WebSocket, Connection>()
  const ips = new Map<string, number>()
  const settings = {
    actionTimeoutMs: options.actionTimeoutMs ?? 20_000,
    botDelayMs: options.botDelayMs ?? 350,
    maxRooms: options.maxRooms ?? 64,
    maxConnections: options.maxConnections ?? 256,
    maxConnectionsPerIp: options.maxConnectionsPerIp ?? 32,
    roomIdleMs: options.roomIdleMs ?? 15 * 60_000,
    roomLifetimeMs: options.roomLifetimeMs ?? 6 * 60 * 60_000,
    rateLimit: options.rateLimit ?? 60,
    rateWindowMs: options.rateWindowMs ?? 10_000,
  }
  const dist = resolve(options.distDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../dist'))
  const allowed = options.allowedOrigins ?? (process.env.WS_ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? [])
  const devPort = options.devPort !== undefined ? options.devPort
    : process.env.NODE_ENV === 'production' ? null : Number(process.env.DEV_PORT ?? 5173)
  const httpServer = createHttpServer((req, res) => { void serve(req, res, dist) })
  httpServer.requestTimeout = 10_000
  httpServer.headersTimeout = 10_000
  httpServer.keepAliveTimeout = 5_000
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false })
  let closing = false

  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`) }
    if (closing) return reject('503 Service Unavailable')
    if (req.url !== '/ws') return reject('404 Not Found')
    if (!originAllowed(req.headers.origin, req.headers.host, allowed, devPort)) return reject('403 Forbidden')
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (connections.size >= settings.maxConnections || (ips.get(ip) ?? 0) >= settings.maxConnectionsPerIp)
      return reject('503 Service Unavailable')
    wss.handleUpgrade(req, socket, head, ws => {
      ips.set(ip, (ips.get(ip) ?? 0) + 1)
      wss.emit('connection', ws, req)
      ws.once('close', () => {
        const count = (ips.get(ip) ?? 1) - 1
        if (count > 0) ips.set(ip, count)
        else ips.delete(ip)
      })
    })
  })

  const active = (connection: Connection, ws: WebSocket): { room: Room; seat: Occupant } => {
    if (!connection.room || !connection.seat || connection.room.disposed || connection.seat.socket !== ws)
      throw new Error('Join or create a room first')
    return { room: connection.room, seat: connection.seat }
  }
  const handle = (ws: WebSocket, connection: Connection, message: ClientMessage) => {
    if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
      if (connection.room) throw new Error('Leave your current room first')
      if (message.type === 'create') {
        if (rooms.size >= settings.maxRooms) throw new Error('The server is full; try again later')
        let id: string
        do { id = randomBytes(3).toString('hex').toUpperCase() } while (rooms.has(id))
        const room = new Room(id, message.mode, settings)
        const seat = room.join(message.name, ws)
        rooms.set(id, room)
        Object.assign(connection, { room, seat })
      } else {
        const room = rooms.get(message.roomId)
        if (!room || room.disposed) throw new Error('Invalid room or session token')
        const seat = message.type === 'join' ? room.join(message.name, ws) : room.resume(message.token, ws)
        Object.assign(connection, { room, seat })
      }
      return
    }
    const { room, seat } = active(connection, ws)
    if (message.type === 'start') room.start(seat)
    else if (message.type === 'act') room.act(seat, message.promptId, message.choiceId)
    else if (message.type === 'leave') {
      room.leave(seat)
      connection.room = undefined
      connection.seat = undefined
      send(ws, { type: 'left' })
      if (room.status === 'waiting' && !room.seats.some(Boolean)) { room.dispose(); rooms.delete(room.id) }
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    const connection: Connection = { alive: true, messages: 0, windowStart: Date.now() }
    connections.set(ws, connection)
    ws.on('error', () => ws.terminate())
    ws.on('pong', () => { connection.alive = true })
    ws.on('message', (data, binary) => {
      const now = Date.now()
      if (now - connection.windowStart >= settings.rateWindowMs) {
        connection.messages = 0
        connection.windowStart = now
      }
      if (++connection.messages > settings.rateLimit) { ws.close(1008, 'Rate limit exceeded'); return }
      try {
        if (binary) throw new Error('Send JSON text messages')
        handle(ws, connection, parseMessage(data.toString()))
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Invalid request' })
      }
    })
    ws.once('close', () => {
      connections.delete(ws)
      if (connection.room && connection.seat) connection.room.disconnect(connection.seat, ws)
    })
  })

  const heartbeat = setInterval(() => {
    for (const [ws, connection] of connections) {
      if (!connection.alive) { ws.terminate(); continue }
      connection.alive = false
      if (ws.readyState === WebSocket.OPEN) ws.ping()
    }
  }, options.heartbeatMs ?? 30_000)
  heartbeat.unref()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [id, room] of rooms) {
      const absent = !room.seats.some(seat => seat?.socket)
      if (now - room.createdAt > settings.roomLifetimeMs
        || ((absent || room.status !== 'playing') && now - room.lastActive > settings.roomIdleMs)) {
        room.dispose()
        rooms.delete(id)
      }
    }
  }, options.sweepIntervalMs ?? 30_000)
  sweep.unref()

  let closePromise: Promise<void> | undefined
  return {
    httpServer, wss, rooms,
    listen(port = 0, host = '127.0.0.1'): Promise<number> {
      return new Promise((done, reject) => {
        const onError = (error: Error) => { httpServer.off('listening', onListen); reject(error) }
        const onListen = () => {
          httpServer.off('error', onError)
          const address = httpServer.address()
          done(typeof address === 'object' && address ? address.port : port)
        }
        httpServer.once('error', onError)
        httpServer.once('listening', onListen)
        httpServer.listen(port, host)
      })
    },
    close(): Promise<void> {
      closePromise ??= new Promise(done => {
        closing = true
        clearInterval(heartbeat)
        clearInterval(sweep)
        for (const room of rooms.values()) room.dispose()
        rooms.clear()
        for (const ws of connections.keys()) ws.terminate()
        wss.close()
        httpServer.close(() => done())
        httpServer.closeAllConnections()
      })
      return closePromise
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createServer()
  const port = Number(process.env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535')
  server.listen(port, process.env.HOST ?? '0.0.0.0')
    .then(actual => { console.log(`Mahjong server listening on port ${actual}`) })
    .catch(error => { console.error(error); void server.close(); process.exitCode = 1 })
  const shutdown = () => { void server.close() }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
