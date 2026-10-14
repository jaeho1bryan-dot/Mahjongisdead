import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Choice, ClientMessage, GameMode, RoomState, Seat } from '../shared/protocol'
import { Tile } from './Tile'
import { meldTiles } from './tiles'
import { useGame } from './useGame'
import './App.css'

const winds = ['東', '南', '西', '北']
const modes = { hand: '한 판 연습', east: '동풍전', south: '반장전' }

function Melds({ melds }: { melds: string[] }) {
  return <div className="melds">{melds.map((m, i) => {
    const tiles = meldTiles(m)
    const marker = m.search(/[+=-]/)
    const calledIndex = marker > 0 ? meldTiles(m.slice(0, marker)).length - 1 : -1
    const added = tiles.length === 4 && marker > 0 && /\d$/.test(m)
    const closed = tiles.length === 4 && marker < 0
    return <div className="meld" key={`${m}-${i}`} title={closed ? '암깡' : added ? '가깡' : m}>
      {tiles.map((tile, j) => {
        if (added && j === tiles.length - 1) return null
        const called = j === calledIndex
        return <span key={j} className={called ? 'meld-called' : undefined}>
          <Tile code={closed && (j === 0 || j === 3) ? '_' : tile} small />
          {added && called && <span className="meld-added"><Tile code={tiles[3]} small /></span>}
        </span>
      })}
    </div>
  })}</div>
}

function PlayerInfo({ seat, active, self = false }: { seat: Seat; active: boolean; self?: boolean }) {
  return <div className={`player-info ${active ? 'active-player' : ''}`}>
    <div className={`avatar ${self ? 'self-avatar' : ''}`}>{winds[seat.wind]}</div>
    <div><span className="player-name">{seat.name} {self && <small>나</small>}</span><strong className="score">{seat.score.toLocaleString()}<span> 점</span></strong></div>
    <span className={`seat-status ${seat.riichi ? 'riichi-status' : ''}`}>{seat.riichi ? '리치' : seat.bot ? 'BOT' : seat.connected ? '접속 중' : '재접속 중'}</span>
  </div>
}

function River({ seat }: { seat: Seat }) {
  return <div className="river" aria-label={`${seat.name}의 버림패`}>{seat.river.map((p, i) =>
    <span key={i} className={`${p.includes('*') ? 'riichi-discard' : ''} ${/[+=-]/.test(p) ? 'called-discard' : ''}`}><Tile code={p.slice(0, 2)} small /></span>
  )}</div>
}

function Opponent({ seat, position, turn }: { seat?: Seat; position: string; turn: number }) {
  if (!seat) return null
  return <section className={`opponent opponent-${position}`}>
    <PlayerInfo seat={seat} active={seat.id === turn} />
    <div className="opponent-hand" aria-label={`손패 ${seat.concealed}장`}>{Array.from({ length: seat.concealed }, (_, i) => <Tile key={i} small />)}</div>
    <Melds melds={seat.melds} />
    <River seat={seat} />
  </section>
}

function Help({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} onCancel={close} className="help-dialog">
    <button className="dialog-close" onClick={close} aria-label="도움말 닫기">✕</button>
    <span className="eyebrow">HOW TO PLAY</span><h2>차분하게, 한 패씩.</h2>
    <p>4명이 136장의 패로 대국합니다. 기본 화료형은 <b>몸통 4개 + 머리 1개</b>이며, 치또이츠·국사무쌍은 예외입니다. 모양이 완성되어도 <b>역이 하나 이상</b> 있어야 화료할 수 있습니다.</p>
    <div className="help-grid">
      <article><h3>버리기 & 리치</h3><p>내 차례에 밝게 표시되는 패를 클릭하면 버립니다. 멘젠 텐파이에서 리치를 선택한 후 표시된 패를 버리면 1,000점을 공탁합니다.</p></article>
      <article><h3>치 · 퐁 · 깡</h3><p>서버가 허용한 행동만 나타납니다. 치는 왼쪽 사람의 버림패에만 가능하며, 울면 멘젠 전용 역을 잃을 수 있습니다. 여러 조합은 각각 선택합니다.</p></article>
      <article><h3>쯔모 & 론</h3><p>직접 뽑아 완성하면 쯔모, 다른 사람의 버림패로 완성하면 론. 후리텐이면 론할 수 없습니다. 화료를 놓치면 일시 또는 리치 후리텐이 적용됩니다.</p></article>
      <article><h3>도라 & 유국</h3><p>표시된 패는 도라 표시패입니다. 그 다음 순서의 패가 도라입니다. 도라는 역이 아닙니다. 패산 소진 시 텐파이 여부로 정산하며 연장·연짱은 규칙에 따릅니다.</p></article>
    </div>
    <p className="help-note">25,000점 시작 · 적도라 3장 · 쿠이탕 있음 · 더블론 · 머리깨기 없음 · 텐파이 연짱 · 들통 종료. 한 판 연습도 연짱으로 여러 국이 이어질 수 있습니다. 시간 초과 시 자동 버리기/패스, 연결이 끊기면 봇이 대신 진행합니다.</p>
    <p className="help-note">친구와 플레이하려면 방 코드를 공유하세요. 시작 시 빈 자리는 연습 봇으로 채워집니다. 봇은 패 효율 중심의 연습 상대이며 숙련 AI는 아닙니다.</p>
    <button className="primary" onClick={close}>이해했어요</button>
  </dialog>
}

function ResultDialog({ children, close }: { children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="result-card" onCancel={event => { event.preventDefault(); close() }} aria-label="국 결과">{children}</dialog>
}

function Lobby({ state, send, busy }: { state: RoomState; send: (m: ClientMessage) => void; busy: boolean }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${state.roomId}`)
      setCopied(true)
    } catch { setCopyError(true) }
  }
  return <main className="lobby panel">
    <span className="eyebrow">PRIVATE TABLE / {modes[state.mode]}</span>
    <h1>함께 앉을 자리가 있어요.</h1><p>친구를 초대하거나, 봇과 바로 대국을 시작하세요.</p>
    <div className="invite"><div><small>방 코드</small><strong>{state.roomId}</strong></div><button onClick={copy}>{copied ? '링크 복사됨 ✓' : '초대 링크 복사 ↗'}</button></div>
    {copyError && <p role="status">주소창의 주소와 방 코드를 친구에게 공유해 주세요.</p>}
    <div className="lobby-seats">{Array.from({ length: 4 }, (_, i) => {
      const seat = state.seats.find(s => s.id === i)
      return <div className="lobby-seat" key={i}><span className="avatar">{winds[i]}</span><strong>{seat?.name || '빈 자리'}</strong><small>{seat ? (i === state.owner ? '방장' : '준비 완료') : '시작하면 봇이 참여합니다'}</small></div>
    })}</div>
    {state.self === state.owner ? <button className="primary" disabled={busy} onClick={() => send({ type: 'start' })}>대국 시작 <span>→</span></button> : <p className="waiting-label">방장이 시작하기를 기다리고 있습니다.</p>}
    <p className="muted">진행 중 새로고침해도 같은 탭에서 자리를 복구합니다.</p>
  </main>
}

function Table({ state, send, busy, sound }: { state: RoomState; send: (m: ClientMessage) => void; busy: boolean; sound: boolean }) {
  const [riichiPrompt, setRiichiPrompt] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const riichiMode = riichiPrompt !== null && riichiPrompt === state.promptId
  const [dismissedResult, setDismissedResult] = useState<string | null>(null)
  const me = state.seats.find(s => s.id === state.self)
  const audio = useRef<AudioContext | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => () => { void audio.current?.close() }, [])
  const act = (choice: Choice) => {
    if (!state.promptId || busy) return
    if (sound) {
      try {
        audio.current ??= new AudioContext()
        void audio.current.resume()
        const oscillator = audio.current.createOscillator()
        const gain = audio.current.createGain()
        oscillator.connect(gain); gain.connect(audio.current.destination)
        oscillator.frequency.value = choice.kind === 'discard' ? 650 : 880
        gain.gain.setValueAtTime(0.04, audio.current.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audio.current.currentTime + 0.07)
        oscillator.start(); oscillator.stop(audio.current.currentTime + 0.08)
      } catch { /* Sound is optional on browsers without Web Audio. */ }
    }
    send({ type: 'act', promptId: state.promptId, choiceId: choice.id })
  }
  if (!me) return <p>자리를 준비하고 있습니다…</p>
  const seatAt = (offset: number) => state.seats.find(s => s.wind === (me.wind + offset) % 4)
  const discards = state.choices.filter(c => c.kind === (riichiMode ? 'riichi' : 'discard'))
  const choiceFor = (tile: string, drawn: boolean) => discards.find(c => c.tile?.slice(0, 2) === tile && c.tile.includes('_') === drawn)
  const seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - now) / 1000)) : null
  const resultKey = `${state.roundWind}:${state.handNumber}:${state.honba}:${JSON.stringify(state.result)}`
  const showResult = state.result && dismissedResult !== resultKey
  const continueChoice = state.choices.find(c => c.kind === 'continue')
  const actionChoices = state.choices.filter(c => !['discard', 'riichi', 'continue'].includes(c.kind))
  return <main className="game-layout">
    <div className="table-toolbar"><div><span className="live-dot" />{modes[state.mode]} <span className="divider">/</span> <span className="muted">ROOM {state.roomId}</span></div><span className="muted">적도라 · 쿠이탕 있음</span></div>
    <div className="mahjong-table">
      <div className="table-line" />
      <Opponent seat={seatAt(2)} position="top" turn={state.turn} />
      <Opponent seat={seatAt(3)} position="left" turn={state.turn} />
      <Opponent seat={seatAt(1)} position="right" turn={state.turn} />
      <section className="table-center" aria-label="대국 현황">
        <div className="round-label">{winds[state.roundWind % 4]} <b>{state.handNumber}</b> 局</div>
        <div className="round-meta"><span>{state.honba} 본장</span><span>공탁 {state.sticks}</span></div>
        <div className="wall-counter"><strong>{state.remaining}</strong><span>남은 패</span></div>
        <div className="dora-label">도라 표시패</div><div className="dora-tiles">{state.dora.map((p, i) => <Tile code={p} small key={i} />)}</div>
        <span className="table-brand">靑 綠 莊</span>
      </section>
      <section className="own-river"><River seat={me} /></section>
      <div className="table-corner corner-left">리치마작<br /><span>RIICHI MAHJONG</span></div>
      <div className="table-corner corner-right">一期一會<br /><span>ONE TILE AT A TIME</span></div>
    </div>
    <section className="hand-panel">
      <div className="hand-header"><PlayerInfo seat={me} active={state.turn === me.id} self /><div className="turn-hint" role="status">{state.status === 'finished' ? '대국 종료' : riichiMode ? '리치를 선언할 패를 선택하세요' : discards.length ? '버릴 패를 선택하세요' : actionChoices.length ? '행동을 선택하세요' : state.event}{seconds !== null && <strong className={seconds <= 5 ? 'time-low' : ''}>{seconds}<small>초</small></strong>}</div></div>
      <div className="hand-scroll"><div className="my-hand">{(me.hand || []).map((tile, i) => {
        const choice = choiceFor(tile, false)
        return <Tile code={tile} key={i} selected={riichiMode && !!choice} disabled={!choice || busy} onClick={() => choice && act(choice)} />
      })}{me.drawn && <span className="drawn-tile"><Tile code={me.drawn} disabled={!choiceFor(me.drawn, true) || busy} selected={riichiMode && !!choiceFor(me.drawn, true)} onClick={() => { const c = choiceFor(me.drawn!, true); if (c) act(c) }} badge="쯔모" /></span>}<Melds melds={me.melds} /></div></div>
      <div className="action-bar"><span className="action-caption">{riichiMode ? '선택한 패로 리치 선언 · 1,000점 공탁' : '합법적인 행동만 표시됩니다'}</span><div className="action-buttons">
        {state.choices.some(c => c.kind === 'riichi') && <button className={riichiMode ? 'action-button selected-action' : 'action-button'} disabled={busy} onClick={() => setRiichiPrompt(riichiMode ? null : state.promptId)}>{riichiMode ? '리치 취소' : '리치'}</button>}
        {actionChoices.map(choice => <button key={choice.id} className={`action-button ${['ron', 'tsumo'].includes(choice.kind) ? 'win-action' : ''}`} onClick={() => act(choice)} disabled={busy}>{choice.label}{choice.meld && <span className="choice-meld">{meldTiles(choice.meld).map((p, i) => <Tile small code={p} key={i} />)}</span>}</button>)}
        {continueChoice && !showResult && <button className="primary" onClick={() => act(continueChoice)} disabled={busy}>다음 국 →</button>}
        {!state.choices.length && <span className="waiting-label">{state.status === 'finished' ? '수고하셨습니다' : '다른 플레이어의 차례'}</span>}
      </div></div>
    </section>
    {showResult && <ResultDialog close={() => setDismissedResult(resultKey)}>
      <span className="eyebrow">HAND RESULT</span><h2>{state.result!.title}</h2>{state.result!.winner && <p className="result-winner">{state.result!.winner}</p>}
      <div className="winning-hand">{state.result!.hand?.map((p, i) => <Tile small code={p} key={i} />)}<Melds melds={state.result!.melds || []} /></div>
      {!!state.result!.points && <div className="result-points">{state.result!.points.toLocaleString()} <small>점 · {state.result!.fu || '—'}부 {state.result!.han || '역만'}판</small></div>}
      <div className="yaku-list">{state.result!.yaku.map((y, i) => <span key={i}>{y.name} <b>{y.han}</b></span>)}</div>
      {!!state.result!.ura.length && <div className="ura">우라도라 표시패 {state.result!.ura.map((p, i) => <Tile small key={i} code={p} />)}</div>}
      <div className="result-scores">{state.seats.map(s => <div key={s.id}><span>{s.name}</span><strong className={(state.result!.deltas[s.id] || 0) >= 0 ? 'positive' : 'negative'}>{(state.result!.deltas[s.id] || 0) > 0 ? '+' : ''}{(state.result!.deltas[s.id] || 0).toLocaleString()}</strong></div>)}</div>
      <button className="primary" disabled={busy} onClick={() => { if (continueChoice) act(continueChoice); setDismissedResult(resultKey) }}>{continueChoice ? '확인 · 다음 국' : '확인'} →</button>
      <small className="muted">모두 확인하거나 제한 시간이 지나면 진행됩니다.</small>
    </ResultDialog>}
    {state.status === 'finished' && !showResult && <section className="final-results panel"><span className="eyebrow">FINAL RESULTS</span><h2>좋은 대국이었습니다.</h2>{state.ranking?.map(p => <div className="ranking-row" key={p.rank}><b>{p.rank}위</b><span>{p.name}</span><strong>{p.score.toLocaleString()}점</strong></div>)}<button className="primary" onClick={() => send({ type: 'leave' })}>로비로 돌아가기</button></section>}
  </main>
}

export default function App() {
  const { state, connection, error, setError, send, busy } = useGame()
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(location.search).get('room') || '')
  const [mode, setMode] = useState<GameMode>('east')
  const [help, setHelp] = useState(false)
  const [sound, setSound] = useState(false)
  const online = connection === 'online'
  const submit = (join: boolean) => {
    if (!name.trim()) { setError('사용할 닉네임을 입력해 주세요.'); return }
    send(join ? { type: 'join', name: name.trim(), roomId: roomCode.trim().toUpperCase() } : { type: 'create', name: name.trim(), mode })
  }
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="/" onClick={e => { if (state) e.preventDefault() }}><span className="brand-mark">發</span><span>청록장<small>MAHJONG IS DEAD</small></span></a><nav><span className={`connection ${online ? 'connected' : ''}`}><i />{online ? '서버 연결됨' : connection === 'connecting' ? '연결 중' : '재접속 중'}</span><button className="icon-button sound-button" aria-pressed={sound} onClick={() => setSound(!sound)}>{sound ? '♪ 소리 켜짐' : '♪ 소리 꺼짐'}</button><button className="icon-button" onClick={() => setHelp(true)}>? <span>게임 가이드</span></button>{state && <button className="icon-button" onClick={() => { if (state.status !== 'playing' || confirm('대국에서 나가면 봇이 대신 플레이합니다. 나가시겠어요?')) send({ type: 'leave' }) }}>나가기 ↗</button>}</nav></header>
    {error && <div className="error-banner" role="alert">{error}<button aria-label="오류 알림 닫기" onClick={() => setError('')}>✕</button></div>}
    {!online && state && <div className="reconnect-banner" role="status">연결을 복구하고 있습니다. 연결이 끊긴 동안 자동 진행될 수 있습니다.</div>}
    {!state ? <main className="landing">
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><i /> A QUIET PLACE TO PLAY</span><h1>한 패의 여유,<br /><em>한 판의 몰입.</em></h1><p>친구와 마주 앉는 리치마작.<br />설치 없이, 당신의 브라우저에서.</p><div className="hero-details"><span>4인 실시간 대국</span><span>봇과 연습</span><span>정통 리치 규칙</span></div></div>
        <div className="hero-art" aria-label="입체감 있는 리치마작패"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-letter">靑</span><div className="showcase-tiles">{['s1', 'm0', 'z6', 'p9', 'z1'].map((p, i) => <div className={`showcase-tile showcase-${i}`} key={p}><Tile code={p} /></div>)}</div><span className="art-caption">좋은 패보다, 좋은 한 판.</span></div>
      </section>
      <section className="entry-section"><div className="entry-title"><span className="eyebrow">TAKE YOUR SEAT</span><h2>오늘의 대국을 시작하세요.</h2><p>빈 자리는 봇이 채워 드릴게요.</p></div><form className="entry-card" onSubmit={e => { e.preventDefault(); submit(false) }}>
        <label className="field-label" htmlFor="nickname">닉네임</label><input id="nickname" value={name} maxLength={16} placeholder="대국에서 사용할 이름" onChange={e => setName(e.target.value)} autoComplete="nickname" required />
        <fieldset><legend>대국 방식</legend><div className="mode-selector">{(Object.entries(modes) as [GameMode, string][]).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? 'mode-active' : ''} onClick={() => setMode(value)}>{label}<small>{value === 'hand' ? '가볍게 시작' : value === 'east' ? '동장 · 빠른 대국' : '동·남장 · 정식 대국'}</small></button>)}</div></fieldset>
        <button className="primary create-button" type="submit" disabled={!online || busy}>새로운 방 만들기 <span>→</span></button>
        <div className="join-divider"><span>초대받으셨나요?</span></div><div className="join-row"><label className="sr-only" htmlFor="room-code">방 코드</label><input id="room-code" value={roomCode} maxLength={12} onChange={e => setRoomCode(e.target.value.toUpperCase())} placeholder="방 코드 입력" /><button type="button" disabled={!online || busy || !roomCode.trim()} onClick={() => submit(true)}>참가하기 ↗</button></div>
      </form></section>
      <section className="feature-strip"><article><span>01 / AUTHENTIC</span><h3>규칙은 빈틈없이</h3><p>역·점수 계산부터 후리텐, 도라,<br />연짱까지 검증 가능한 규칙 엔진.</p></article><article><span>02 / TOGETHER</span><h3>어디서든 한 테이블</h3><p>방 코드 하나로 친구와 함께.<br />서버가 관리하는 공정한 대국.</p></article><article><span>03 / AT YOUR PACE</span><h3>처음이라도 괜찮아요</h3><p>가능한 행동을 알려주는 인터페이스.<br />봇과 부담 없이 연습하세요.</p></article></section>
    </main> : state.status === 'waiting' ? <Lobby state={state} send={send} busy={busy || !online} /> : <Table state={state} send={send} busy={busy || !online} sound={sound} />}
    <footer className="site-footer"><span>靑綠莊 <b>·</b> Mahjong is dead</span><span>서두르지 않아도, 다음 패는 옵니다.</span><button onClick={() => setHelp(true)}>규칙 & 도움말 ↗</button></footer>
    {help && <Help close={() => setHelp(false)} />}
  </div>
}
