const yakuNames: Record<string, string> = {
  立直: '리치', ダブル立直: '더블 리치', 一発: '일발', 門前清自摸和: '멘젠쯔모',
  平和: '핑후', 断幺九: '탕야오', 一盃口: '이페코', 二盃口: '량페코',
  '翻牌 白': '역패 백', '翻牌 發': '역패 발', '翻牌 中': '역패 중',
  嶺上開花: '영상개화', 槍槓: '창깡', 海底摸月: '해저로월', 河底撈魚: '하저로어',
  三色同順: '삼색동순', 三色同刻: '삼색동각', 一気通貫: '일기통관',
  混全帯幺九: '찬타', 純全帯幺九: '준찬타', 七対子: '치또이쯔', 対々和: '또이또이',
  三暗刻: '산안커', 三槓子: '산깡쯔', 小三元: '소삼원', 混老頭: '혼노두',
  混一色: '혼일색', 清一色: '청일색',
  天和: '천화', 地和: '지화', 国士無双: '국사무쌍', 国士無双十三面: '국사무쌍 13면 대기',
  四暗刻: '스안커', 四暗刻単騎: '스안커 단기', 大三元: '대삼원', 小四喜: '소사희', 大四喜: '대사희',
  字一色: '자일색', 緑一色: '녹일색', 清老頭: '청노두', 四槓子: '스깡쯔',
  九蓮宝燈: '구련보등', 純正九蓮宝燈: '순정구련보등',
  ドラ: '도라', 赤ドラ: '적도라', 裏ドラ: '우라도라',
}
const winds: Record<string, string> = { 東: '동', 南: '남', 西: '서', 北: '북' }

/** Korean name for a majiang-core yaku name. Unknown names are returned unchanged. */
export function yakuName(name: string): string {
  const wind = /^(場風|自風) (.)$/.exec(name)
  if (wind && winds[wind[2]]) return `${wind[1] === '場風' ? '장풍패' : '자풍패'} ${winds[wind[2]]}`
  return yakuNames[name] ?? name
}

/** Korean han label: numbers are han, `*` marks are multiples of yakuman. */
export function yakuValue(value: number | string): string {
  if (typeof value === 'number') return `${value}판`
  if (/^\*+$/.test(value)) return value.length === 1 ? '역만' : value.length === 2 ? '더블 역만' : `${value.length}배 역만`
  return value
}
