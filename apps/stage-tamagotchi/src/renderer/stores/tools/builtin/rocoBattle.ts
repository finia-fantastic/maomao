import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

// ── Inline copy of core damage calc (same logic as roco-skills.ts) ──

const SKILL_DB: Record<string, { name: string, element: string, type: string, cost: number, power: number }> = {
  '猛烈撞击': { name: '猛烈撞击', element: '普通', type: '物攻', cost: 1, power: 65 },
  '闪光冲击': { name: '闪光冲击', element: '光', type: '物攻', cost: 3, power: 100 },
  '水炮': { name: '水炮', element: '水', type: '魔攻', cost: 5, power: 120 },
  '气泡': { name: '气泡', element: '水', type: '魔攻', cost: 3, power: 100 },
  '天洪': { name: '天洪', element: '水', type: '魔攻', cost: 7, power: 150 },
  '爆裂飞弹': { name: '爆裂飞弹', element: '火', type: '魔攻', cost: 7, power: 160 },
  '炎枪': { name: '炎枪', element: '火', type: '魔攻', cost: 3, power: 100 },
  '火焰箭': { name: '火焰箭', element: '火', type: '物攻', cost: 2, power: 80 },
  '火云车': { name: '火云车', element: '火', type: '物攻', cost: 5, power: 120 },
  '藤鞭': { name: '藤鞭', element: '草', type: '物攻', cost: 3, power: 50 },
  '棘突': { name: '棘突', element: '草', type: '魔攻', cost: 3, power: 100 },
  '仙人掌刺击': { name: '仙人掌刺击', element: '草', type: '物攻', cost: 6, power: 150 },
  '地震': { name: '地震', element: '地', type: '物攻', cost: 10, power: 190 },
  '岩土暴击': { name: '岩土暴击', element: '地', type: '物攻', cost: 8, power: 140 },
  '裂石': { name: '裂石', element: '地', type: '物攻', cost: 2, power: 60 },
  '升龙咆哮': { name: '升龙咆哮', element: '龙', type: '魔攻', cost: 3, power: 200 },
  '超导': { name: '超导', element: '电', type: '魔攻', cost: 3, power: 95 },
  '电弧': { name: '电弧', element: '电', type: '物攻', cost: 3, power: 80 },
  '冰爪': { name: '冰爪', element: '冰', type: '物攻', cost: 2, power: 80 },
  '寒风吹': { name: '寒风吹', element: '冰', type: '魔攻', cost: 3, power: 70 },
  '冷风': { name: '冷风', element: '冰', type: '魔攻', cost: 1, power: 60 },
  '坍缩': { name: '坍缩', element: '幻', type: '魔攻', cost: 3, power: 85 },
  '潮涌': { name: '潮涌', element: '水', type: '物攻', cost: 2, power: 80 },
  '光刃': { name: '光刃', element: '光', type: '物攻', cost: 4, power: 120 },
  '过曝': { name: '过曝', element: '光', type: '魔攻', cost: 3, power: 60 },
  '光球': { name: '光球', element: '光', type: '魔攻', cost: 2, power: 80 },
  '热砂': { name: '热砂', element: '地', type: '魔攻', cost: 2, power: 80 },
  '念力膨胀': { name: '念力膨胀', element: '幻', type: '物攻', cost: 2, power: 80 },
  '闪光': { name: '闪光', element: '光', type: '魔攻', cost: 1, power: 60 },
  '藤绞': { name: '藤绞', element: '草', type: '物攻', cost: 3, power: 80 },
  '水刃': { name: '水刃', element: '水', type: '物攻', cost: 4, power: 90 },
  '荆棘爪': { name: '荆棘爪', element: '草', type: '物攻', cost: 2, power: 80 },
  '球状闪电': { name: '球状闪电', element: '电', type: '物攻', cost: 1, power: 60 },
  '扬沙': { name: '扬沙', element: '地', type: '物攻', cost: 1, power: 60 },
  '吹火': { name: '吹火', element: '火', type: '物攻', cost: 1, power: 45 },
  '炎打': { name: '炎打', element: '火', type: '魔攻', cost: 2, power: 95 },
  '花香': { name: '花香', element: '草', type: '魔攻', cost: 1, power: 60 },
  '离子震荡': { name: '离子震荡', element: '机械', type: '物攻', cost: 3, power: 90 },
}

const TYPE_CHART: Record<string, Record<string, number>> = {
  '普通': {},
  '草': { '水': 2, '地': 2, '光': 2, '火': 0.5, '草': 0.5, '冰': 0.5 },
  '火': { '草': 2, '冰': 2, '虫': 2, '水': 0.5, '地': 0.5, '光': 0.5 },
  '水': { '火': 2, '地': 2, '草': 0.5, '电': 0.5, '水': 0.5 },
  '光': { '恶': 2, '幻': 2, '草': 0.5, '幽': 0.5 },
  '地': { '火': 2, '电': 2, '草': 0.5, '水': 0.5 },
  '冰': { '草': 2, '地': 2, '火': 0.5, '水': 0.5, '冰': 0.5 },
  '电': { '水': 2, '翼': 2, '地': 0.5, '电': 0.5, '草': 0.5 },
  '幻': { '萌': 2, '恶': 0.5 },
  '龙': { '龙': 2 },
  '萌': { '恶': 2 },
  '恶': { '幻': 2, '萌': 0.5 },
  '武': { '普通': 2, '冰': 2, '幻': 0.5, '翼': 0.5 },
  '虫': { '草': 2, '幻': 2, '火': 0.5, '翼': 0.5 },
  '毒': { '草': 2, '萌': 2, '地': 0.5, '幻': 0.5 },
  '翼': { '虫': 2, '武': 2, '电': 0.5 },
  '幽': { '幻': 2, '幽': 2 },
  '机械': { '冰': 2, '光': 2, '火': 0.5, '电': 0.5 },
}

function getTypeMult(atk: string, def: string): number {
  return TYPE_CHART[atk]?.[def] ?? 1.0
}

const rocoCalcParams = z.object({
  query: z.string().describe(
    'What to calculate or look up. Examples:\n' +
    '- "迪莫用闪光冲击打草系精灵伤害多少"\n' +
    '- "火系技能有哪些，威力多少"\n' +
    '- "水系克制什么属性"\n' +
    '- "计算：我方迪莫物攻80，用闪光冲击(光/物攻/100威力)打对面草系魔防105"\n' +
    '- "推荐打水系用哪些技能"',
  ),
})

async function executeRocoCalc(input: { query: string }): Promise<string> {
  const q = input.query

  // Skill lookup
  if (/有哪些技能|技能列表|什么技能|火系.*技能|水系.*技能/.test(q)) {
    const element = q.match(/(普通|草|火|水|光|地|冰|电|幻|龙|萌|恶|武|虫|毒|翼|幽|机械)系?/)?.[1]
    if (element) {
      const skills = Object.values(SKILL_DB).filter(s => s.element === element)
      return `${element}系技能(${skills.length}个):\n${skills.map(s => `- ${s.name}: ${s.type} ${s.power}威力 能耗${s.cost}`).join('\n')}`
    }
    return `可用技能:\n${Object.values(SKILL_DB).map(s => `- ${s.name}(${s.element}/${s.type} ${s.power}威力)`).join('\n')}`
  }

  // Type matchup lookup
  if (/克制|属性.*关系|什么.*克/.test(q)) {
    const el = q.match(/(普通|草|火|水|光|地|冰|电|幻|龙|萌|恶|武|虫|毒|翼|幽|机械)/)?.[1]
    if (el) {
      const mults = TYPE_CHART[el] || {}
      const lines = Object.entries(mults).map(([k, v]) => `${k}系 ×${v}`)
      return `${el}系 克制关系:\n${lines.join('\n') || '无特殊克制'}`
    }
  }

  // Damage calculation
  const atkMatch = q.match(/物攻(\d+)|魔攻(\d+)|攻击(\d+)/)
  const defMatch = q.match(/物防(\d+)|魔防(\d+)|防御(\d+)/)
  const hpMatch = q.match(/HP(\d+)|生命(\d+)|血量(\d+)/)
  const skillMatch = q.match(new RegExp(`(${Object.keys(SKILL_DB).join('|')})`))

  if (skillMatch && atkMatch && defMatch) {
    const skill = SKILL_DB[skillMatch[1]]
    if (!skill) return `未找到技能: ${skillMatch[1]}`

    const atk = Number(atkMatch[1] || atkMatch[2] || atkMatch[3] || 80)
    const def = Number(defMatch[1] || defMatch[2] || defMatch[3] || 100)
    const hp = Number(hpMatch?.[1] || hpMatch?.[2] || hpMatch?.[3] || 120)
    const elAtk = q.match(/打(\S+?)系/)?.[1] || skill.element
    const elDef = q.match(/(\S+?)系.*(?:防御|精灵)/)?.[1] || elAtk

    const base = Math.round(skill.power * (atk / 100))
    const stab = skill.element === '光' ? 1.5 : 1.0 // Assume Diemo's light type
    const afterSTAB = Math.round(base * stab)
    const typeMult = getTypeMult(elAtk, elDef)
    const afterType = Math.round(afterSTAB * typeMult)
    const afterDef = Math.round(afterType - def * 0.4)
    const final = Math.round(afterDef * 1.0)

    const pct = ((final / hp) * 100).toFixed(1)
    const canKill = final >= hp

    return [
      `## 伤害计算: ${skill.name}(${skill.element}/${skill.type})`,
      ``,
      `| 步骤 | 数值 |`,
      `|------|------|`,
      `| 技能威力 | ${skill.power} |`,
      `| 攻击力 | ${atk} |`,
      `| 基础伤害 | ${base} |`,
      `| 本系加成 | ×${stab} = ${afterSTAB} |`,
      `| 属性克制(${elAtk}→${elDef}) | ×${typeMult} = ${afterType} |`,
      `| 防御减伤 | -${Math.round(def * 0.4)} = ${afterDef} |`,
      `| **最终伤害** | **${final}** |`,
      `| 目标HP | ${hp} |`,
      `| 伤害占比 | ${pct}% |`,
      `| 能否击杀 | ${canKill ? '✅ 可以' : `❌ 差${hp - final}HP`} |`,
    ].join('\n')
  }

  return `洛克王国技能数据库已就绪。你可以：
- 查询 "水系有哪些技能"
- 计算 "迪莫用闪光冲击打草系伤害"
- 查属性 "火系克制什么"
- 问具体技能 "水炮威力多少"
请给我具体的数字和宠物资质。`
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'roco_battle',
    description: [
      '洛克王国：世界 战斗计算器。查询技能数据、属性克制、计算伤害。',
      '可查询: 技能列表(按属性筛选)、威力、能耗、属性克制关系。',
      '可计算: 给定攻击方物攻/魔攻 + 技能 + 防御方物防/魔防 + HP → 伤害数值和百分比。',
      '公式: 伤害 = 威力 × (攻击/100) × 本系加成(1.5) × 属性克制 × 减防 → 对比HP判断击杀。',
      '使用本工具帮用户做战斗决策。',
    ].join('\n'),
    execute: executeRocoCalc,
    parameters: rocoCalcParams,
  }),
]

export const rocoBattleTools = async () => Promise.all(tools)
