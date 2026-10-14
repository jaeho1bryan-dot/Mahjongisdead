const honorNames = ['', '동', '남', '서', '북', '백', '발', '중']

export function tileName(code: string) {
  if (!code || code === '_') return '뒷면'
  const rank = Number(code[1]) || 5
  return code[0] === 'z' ? honorNames[rank] : `${code[1] === '0' ? '적 ' : ''}${rank}${({ m: '만', p: '통', s: '삭' })[code[0]]}`
}

export function meldTiles(meld: string): string[] {
  return [...meld.slice(1)].filter(c => /\d/.test(c)).map(n => meld[0] + n)
}
