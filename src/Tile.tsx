import { tileName } from './tiles'

const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const honors = ['', '東', '南', '西', '北', '白', '發', '中']

function Face({ code }: { code: string }) {
  const suit = code[0]
  const rank = Number(code[1]) || 5
  const red = code[1] === '0'
  if (suit === 'z') {
    return <span className={`honor honor-${rank}`}>{rank === 5 ? <i className="white-dragon" /> : honors[rank]}</span>
  }
  if (suit === 'm') return <span className={`characters ${red ? 'red' : ''}`}><b>{digits[rank]}</b><em>萬</em></span>
  const positions: Record<number, [number, number][]> = {
    1: [[24, 32]],
    2: [[24, 16], [24, 48]],
    3: [[13, 15], [24, 32], [35, 49]],
    4: [[13, 17], [35, 17], [13, 47], [35, 47]],
    5: [[13, 15], [35, 15], [24, 32], [13, 49], [35, 49]],
    6: [[13, 13], [35, 13], [13, 32], [35, 32], [13, 51], [35, 51]],
    7: [[12, 12], [24, 20], [36, 28], [13, 40], [35, 40], [13, 54], [35, 54]],
    8: [[13, 11], [35, 11], [13, 25], [35, 25], [13, 39], [35, 39], [13, 53], [35, 53]],
    9: [[11, 12], [24, 12], [37, 12], [11, 32], [24, 32], [37, 32], [11, 52], [24, 52], [37, 52]],
  }
  if (suit === 's' && rank === 1) {
    return <svg viewBox="0 0 48 64" aria-hidden="true"><path d="M12 50Q36 54 31 23L37 17 29 16Q22 5 18 19L10 24 20 25Q22 33 12 50Z" fill="#1d7056" /><path d="M18 32L28 26 25 45Z" fill="#b74e3e" /><circle cx="26" cy="17" r="1.5" fill="#f5ecd7" /><path d="M14 54L22 48M26 54L24 47" stroke="#193c34" strokeWidth="2" /></svg>
  }
  return <svg viewBox="0 0 48 64" aria-hidden="true">{positions[rank]?.map(([x, y], i) => {
    const color = red ? '#be4439' : suit === 's' ? (i === 0 && rank > 4 ? '#be4439' : '#24664e') : ['#315a70', '#b44940', '#24664e'][i % 3]
    return suit === 'p'
      ? <g key={i}><circle cx={x} cy={y} r={rank === 1 ? 14 : 5} fill="none" stroke={color} strokeWidth={rank === 1 ? 3 : 2} /><circle cx={x} cy={y} r={rank === 1 ? 7 : 1.5} fill={color} /></g>
      : <g key={i} stroke={color} strokeWidth="4" strokeLinecap="round"><path d={`M${x} ${y - 5}v10`} /><path d={`M${x - 2} ${y}h4`} strokeWidth="2" /></g>
  })}</svg>
}

export function Tile({ code = '_', small = false, selected = false, disabled, onClick, badge }: {
  code?: string; small?: boolean; selected?: boolean; disabled?: boolean; onClick?: () => void; badge?: string
}) {
  const classes = `tile ${code === '_' ? 'tile-back' : ''} ${small ? 'tile-small' : ''} ${selected ? 'tile-selected' : ''}`
  const content = <>{code !== '_' && <Face code={code} />}{badge && <span className="tile-badge">{badge}</span>}</>
  return onClick
    ? <button className={classes} disabled={disabled} onClick={onClick} aria-label={`${tileName(code)} 버리기`} title={tileName(code)}>{content}</button>
    : <span className={classes} role="img" aria-label={tileName(code)} title={tileName(code)}>{content}</span>
}
