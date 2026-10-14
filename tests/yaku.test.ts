import assert from 'node:assert/strict'
import test from 'node:test'
import { translateYaku } from '../server/yaku.js'

test('all engine yaku, yakuman and dora names have Korean translations', () => {
  const names = [
    '立直', 'ダブル立直', '一発', '海底摸月', '河底撈魚', '嶺上開花', '槍槓', '天和', '地和',
    '門前清自摸和', '翻牌 白', '翻牌 發', '翻牌 中', '平和', '断幺九', '一盃口',
    '三色同順', '一気通貫', '混全帯幺九', '七対子', '対々和', '三暗刻', '三槓子',
    '三色同刻', '混老頭', '小三元', '混一色', '純全帯幺九', '二盃口', '清一色',
    '国士無双十三面', '国士無双', '四暗刻単騎', '四暗刻', '大三元', '大四喜',
    '小四喜', '字一色', '緑一色', '清老頭', '四槓子', '純正九蓮宝燈', '九蓮宝燈',
    'ドラ', '赤ドラ', '裏ドラ',
  ]
  for (const prefix of ['場風', '自風']) for (const wind of ['東', '南', '西', '北'])
    names.push(`${prefix} ${wind}`)
  for (const name of names) {
    assert.match(translateYaku(name), /[가-힣]/, name)
    assert.doesNotMatch(translateYaku(name), /[\u3400-\u9fff\u3040-\u30ff]/, name)
  }
  assert.equal(translateYaku('場風 東'), '장풍패 · 동')
  assert.equal(translateYaku('自風 北'), '자풍패 · 북')
  assert.equal(translateYaku('七対子'), '치또이츠')
  assert.equal(translateYaku('国士無双十三面'), '국사무쌍 13면대기')
  assert.equal(translateYaku('未知の役'), '未知の役')
})
