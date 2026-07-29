/**
 * 洛克王国：世界 技能数据库 + 伤害计算器
 *
 * 使用方法：
 *   import { skillDB, damageCalc } from './roco-skills'
 *
 *   // 查询技能
 *   skillDB.getByName('水炮')
 *
 *   // 计算伤害
 *   damageCalc({ attacker: diemo, skill: '闪光冲击', defender: { ... } })
 */

// ==================== 类型定义 ====================

export type SkillType = '物攻' | '魔攻' | '状态' | '防御'
export type Element = '普通' | '草' | '火' | '水' | '光' | '地' | '冰' | '电' | '幻' | '龙' | '萌' | '恶' | '武' | '虫' | '毒' | '翼' | '幽' | '机械'

export interface GameSkill {
  name: string
  element: Element
  type: SkillType
  cost: number       // 能耗
  power: number      // 威力 (0=非攻击)
  effects: string    // 效果描述
  /** 特殊效果标签 */
  tags?: string[]
}

export interface PetStats {
  name: string
  level: number
  hp: number
  atk: number      // 物攻
  spAtk: number    // 魔攻
  def: number      // 物防
  spDef: number    // 魔防
  speed: number
  element: Element
  personality?: Personality
}

export interface Personality {
  /** 性格名称 */
  name: string
  /** 加成属性 (1.1x) */
  buffStat: 'atk' | 'spAtk' | 'def' | 'spDef' | 'speed' | 'none'
  /** 削弱属性 (0.9x) */
  nerfStat: 'atk' | 'spAtk' | 'def' | 'spDef' | 'speed' | 'none'
}

// ==================== 属性克制表 ====================

const TYPE_MATCHUP: Record<Element, Partial<Record<Element, number>>> = {
  '普通': {},
  '草': { '水': 2.0, '地': 2.0, '光': 2.0, '火': 0.5, '草': 0.5, '冰': 0.5 },
  '火': { '草': 2.0, '冰': 2.0, '虫': 2.0, '水': 0.5, '地': 0.5, '光': 0.5 },
  '水': { '火': 2.0, '地': 2.0, '草': 0.5, '电': 0.5, '水': 0.5 },
  '光': { '恶': 2.0, '幻': 2.0, '草': 0.5, '幽': 0.5, '光': 0.5 },
  '地': { '火': 2.0, '电': 2.0, '草': 0.5, '水': 0.5 },
  '冰': { '草': 2.0, '地': 2.0, '火': 0.5, '水': 0.5, '冰': 0.5 },
  '电': { '水': 2.0, '翼': 2.0, '地': 0.5, '电': 0.5, '草': 0.5 },
  '幻': { '萌': 2.0, '恶': 0.5 },
  '龙': { '龙': 2.0 },
  '萌': { '恶': 2.0 },
  '恶': { '幻': 2.0, '萌': 0.5 },
  '武': { '普通': 2.0, '冰': 2.0, '幻': 0.5, '翼': 0.5 },
  '虫': { '草': 2.0, '幻': 2.0, '火': 0.5, '翼': 0.5 },
  '毒': { '草': 2.0, '萌': 2.0, '地': 0.5, '幻': 0.5 },
  '翼': { '虫': 2.0, '武': 2.0, '电': 0.5 },
  '幽': { '幻': 2.0, '幽': 2.0 },
  '机械': { '冰': 2.0, '光': 2.0, '火': 0.5, '电': 0.5 },
}

/** 获取属性克制倍率 */
export function getTypeMultiplier(atkElement: Element, defElement: Element): number {
  return TYPE_MATCHUP[atkElement]?.[defElement] ?? 1.0
}

// ==================== 技能数据库 ====================

export const ALL_SKILLS: GameSkill[] = [
  // ── 普通 ──
  { name: '猛烈撞击', element: '普通', type: '物攻', cost: 1, power: 65, effects: '物理伤害' },
  { name: '闪光', element: '光', type: '魔攻', cost: 1, power: 60, effects: '魔法伤害' },
  { name: '防御', element: '普通', type: '防御', cost: 1, power: 0, effects: '减伤70%，应对攻击', tags: ['防御'] },
  { name: '魔法增效', element: '普通', type: '状态', cost: 0, power: 0, effects: '魔攻+70%', tags: ['增益'] },
  { name: '光球', element: '光', type: '魔攻', cost: 2, power: 80, effects: '魔法伤害' },
  { name: '火焰箭', element: '火', type: '物攻', cost: 2, power: 80, effects: '物理伤害' },
  { name: '力量增效', element: '普通', type: '状态', cost: 1, power: 0, effects: '物攻+100%', tags: ['增益'] },
  { name: '棘突', element: '草', type: '魔攻', cost: 3, power: 100, effects: '魔法伤害' },
  { name: '潮涌', element: '水', type: '物攻', cost: 2, power: 80, effects: '物理伤害' },
  { name: '超导', element: '电', type: '魔攻', cost: 3, power: 95, effects: '迸发时能耗-1' },
  { name: '闪光冲击', element: '光', type: '物攻', cost: 3, power: 100, effects: '物理伤害' },
  { name: '漫反射', element: '光', type: '状态', cost: 1, power: 0, effects: '每种系别至多1个技能威力+35', tags: ['增益'] },
  { name: '冰爪', element: '冰', type: '物攻', cost: 2, power: 80, effects: '物理伤害' },
  { name: '热砂', element: '地', type: '魔攻', cost: 2, power: 80, effects: '魔法伤害' },
  { name: '念力膨胀', element: '幻', type: '物攻', cost: 2, power: 80, effects: '物理伤害' },
  { name: '放晴', element: '光', type: '状态', cost: 0, power: 0, effects: '光系技能威力永久+50%', tags: ['增益'] },
  { name: '过曝', element: '光', type: '魔攻', cost: 3, power: 60, effects: '每用1个其他系技能威力+30' },
  { name: '光刃', element: '光', type: '物攻', cost: 4, power: 120, effects: '物理伤害' },
  { name: '折射', element: '光', type: '魔攻', cost: 4, power: 50, effects: '携带其他系别有不同效果，见折射表' },

  // ── 水 ──
  { name: '水炮', element: '水', type: '魔攻', cost: 5, power: 120, effects: '每次释放后能耗-1' },
  { name: '气泡', element: '水', type: '魔攻', cost: 3, power: 100, effects: '魔法伤害' },
  { name: '天洪', element: '水', type: '魔攻', cost: 7, power: 150, effects: '应对时能耗永久-6' },
  { name: '求雨', element: '水', type: '状态', cost: 8, power: 0, effects: '天气变雨天，其他水技能能耗-2', tags: ['天气'] },
  { name: '水刃', element: '水', type: '物攻', cost: 4, power: 90, effects: '应对时能耗-4' },
  { name: '润泽', element: '水', type: '状态', cost: 7, power: 0, effects: '魔攻+190%', tags: ['增益'] },

  // ── 火 ──
  { name: '爆裂飞弹', element: '火', type: '魔攻', cost: 7, power: 160, effects: '魔法伤害' },
  { name: '火云车', element: '火', type: '物攻', cost: 5, power: 120, effects: '物理伤害' },
  { name: '炎枪', element: '火', type: '魔攻', cost: 3, power: 100, effects: '魔法伤害' },
  { name: '怒火', element: '火', type: '状态', cost: 1, power: 0, effects: '双攻+120%，双防-40%', tags: ['增益'] },
  { name: '热身', element: '火', type: '状态', cost: 1, power: 0, effects: '下次攻击技威力翻倍，应对防御时4倍', tags: ['增益'] },
  { name: '吹火', element: '火', type: '物攻', cost: 1, power: 45, effects: '每次释放威力+15' },
  { name: '火焰护盾', element: '火', type: '防御', cost: 2, power: 0, effects: '减伤70%，应对时敌方+5层灼烧', tags: ['防御'] },

  // ── 草 ──
  { name: '藤鞭', element: '草', type: '物攻', cost: 3, power: 50, effects: '2连击' },
  { name: '藤绞', element: '草', type: '物攻', cost: 3, power: 80, effects: '回复5能量' },
  { name: '荆棘爪', element: '草', type: '物攻', cost: 2, power: 80, effects: '物理伤害' },
  { name: '仙人掌刺击', element: '草', type: '物攻', cost: 6, power: 150, effects: '物理伤害' },
  { name: '丰饶', element: '草', type: '状态', cost: 3, power: 0, effects: '物攻魔攻+140%~150%', tags: ['增益'] },
  { name: '寄生种子', element: '草', type: '状态', cost: 2, power: 0, effects: '敌方每回合-8%生命', tags: ['持续伤害'] },
  { name: '汲取', element: '草', type: '魔攻', cost: 0, power: 30, effects: '吸血100%', tags: ['吸血'] },

  // ── 地 ──
  { name: '地震', element: '地', type: '物攻', cost: 10, power: 190, effects: '物理伤害' },
  { name: '岩土暴击', element: '地', type: '物攻', cost: 8, power: 140, effects: '每被攻击1次能耗-1' },
  { name: '裂石', element: '地', type: '物攻', cost: 2, power: 60, effects: '应对时敌方物防-80%', tags: ['破防'] },
  { name: '壁垒', element: '地', type: '防御', cost: 2, power: 0, effects: '减伤90%，应对时冷却-1', tags: ['防御'] },
  { name: '流沙', element: '地', type: '状态', cost: 2, power: 0, effects: '敌方速度-50%，应对时-150%', tags: ['减益'] },

  // ── 龙 ──
  { name: '升龙咆哮', element: '龙', type: '魔攻', cost: 3, power: 200, effects: '蓄力1回合', tags: ['蓄力'] },

  // ── 电 ──
  { name: '电弧', element: '电', type: '物攻', cost: 3, power: 80, effects: '迸发时威力+40' },
  { name: '球状闪电', element: '电', type: '物攻', cost: 1, power: 60, effects: '物理伤害' },
  { name: '离子震荡', element: '机械', type: '物攻', cost: 3, power: 90, effects: '3号位时威力+40' },

  // ── 冰 ──
  { name: '冷风', element: '冰', type: '魔攻', cost: 1, power: 60, effects: '魔法伤害' },
  { name: '寒风吹', element: '冰', type: '魔攻', cost: 3, power: 70, effects: '敌方魔防-50%', tags: ['破防'] },

  // ── 幻 ──
  { name: '坍缩', element: '幻', type: '魔攻', cost: 3, power: 85, effects: '击败敌方时魔攻+70%' },

  // ── 萌 ──
  { name: '恶作剧', element: '萌', type: '状态', cost: 0, power: 0, effects: '敌方失去3能量，应对防御时失去6', tags: ['干扰'] },
]

// 按名称快速查找
const skillByName = new Map<string, GameSkill>()
for (const s of ALL_SKILLS) skillByName.set(s.name, s)

export const skillDB = {
  getByName: (name: string) => skillByName.get(name),
  getByElement: (el: Element) => ALL_SKILLS.filter(s => s.element === el),
  getAll: () => ALL_SKILLS,
}

// ==================== 伤害计算器 ====================

export interface DamageInput {
  attacker: PetStats
  skillName: string
  defender: PetStats
  /** 攻击方增益倍率（如力量增效=2.0） */
  atkBuff?: number
  /** 防御方是否有防御状态 */
  defenderGuarding?: boolean
}

export interface DamageResult {
  skill: GameSkill
  baseDamage: number
  afterSTAB: number
  afterTypeMatchup: number
  afterStatBuff: number
  afterDefense: number
  finalDamage: number
  /** 伤害占目标HP百分比 */
  percentOfTargetHP: number
  /** 能否击杀 */
  canKill: boolean
  breakdown: string
}

/** 伤害公式（基于洛克王国世界机制估算） */
export function damageCalc(input: DamageInput): DamageResult | { error: string } {
  const skill = skillByName.get(input.skillName)
  if (!skill) return { error: `未找到技能: ${input.skillName}` }
  if (skill.power === 0) return { error: `${skill.name} 不是攻击技能` }

  const { attacker, defender } = input

  // 1. 基础伤害 = 威力 × (攻击力/100)
  const isPhysical = skill.type === '物攻'
  const atkStat = isPhysical ? attacker.atk : attacker.spAtk
  const defStat = isPhysical ? defender.def : defender.spDef
  const baseDamage = Math.round(skill.power * (atkStat / 100))

  // 2. 本系加成 (STAB) = 1.5x if skill element matches pet element
  const stab = skill.element === attacker.element ? 1.5 : 1.0
  const afterSTAB = Math.round(baseDamage * stab)

  // 3. 属性克制
  const typeMultiplier = getTypeMultiplier(skill.element, defender.element)
  const afterTypeMatchup = Math.round(afterSTAB * typeMultiplier)

  // 4. 攻击方增益 (物攻/魔攻 buff)
  const buff = input.atkBuff ?? 1.0
  const afterStatBuff = Math.round(afterTypeMatchup * buff)

  // 5. 防御减伤
  const defense = Math.round(defStat * 0.4)
  const defMultiplier = input.defenderGuarding ? 0.3 : 1.0
  const afterDefense = Math.round(Math.max(1, afterStatBuff - defense) * defMultiplier)

  // 6. 随机波动 (±10%)
  const variance = 0.9 + Math.random() * 0.2
  const finalDamage = Math.round(afterDefense * variance)

  // 7. 百分比计算
  const percentOfTargetHP = Number(((finalDamage / defender.hp) * 100).toFixed(1))
  const canKill = finalDamage >= defender.hp

  const breakdown = [
    `技能: ${skill.name} (${skill.element}/${skill.type})`,
    `威力: ${skill.power}, 攻击: ${atkStat}, 防御: ${defStat}`,
    `基础: ${skill.power} × (${atkStat}/100) = ${baseDamage}`,
    `本系加成: ×${stab} → ${afterSTAB}`,
    `属性克制(${typeMultiplier}x): → ${afterTypeMatchup}`,
    `增益buff(×${buff}): → ${afterStatBuff}`,
    `防御减伤(-${defense}, 守卫×${defMultiplier}): → ${afterDefense}`,
    `随机波动: → ${finalDamage}`,
    `目标HP: ${defender.hp}, 伤害占比: ${percentOfTargetHP}%`,
    canKill ? '✅ 可以击杀' : `❌ 无法击杀 (差${defender.hp - finalDamage}HP)`,
  ].join('\n')

  return {
    skill,
    baseDamage,
    afterSTAB,
    afterTypeMatchup,
    afterStatBuff,
    afterDefense,
    finalDamage,
    percentOfTargetHP,
    canKill,
    breakdown,
  }
}

// ==================== 性格系统 ====================

export const PERSONALITIES: Personality[] = [
  { name: '勇敢', buffStat: 'atk', nerfStat: 'speed' },
  { name: '冷静', buffStat: 'spAtk', nerfStat: 'speed' },
  { name: '大胆', buffStat: 'def', nerfStat: 'atk' },
  { name: '沉着', buffStat: 'spDef', nerfStat: 'atk' },
  { name: '固执', buffStat: 'atk', nerfStat: 'spAtk' },
  { name: '保守', buffStat: 'spAtk', nerfStat: 'atk' },
  { name: '开朗', buffStat: 'speed', nerfStat: 'spAtk' },
  { name: '胆小', buffStat: 'speed', nerfStat: 'atk' },
  { name: '淘气', buffStat: 'def', nerfStat: 'spAtk' },
  { name: '慎重', buffStat: 'spDef', nerfStat: 'spAtk' },
  { name: '悠闲', buffStat: 'def', nerfStat: 'speed' },
  { name: '马虎', buffStat: 'spAtk', nerfStat: 'spDef' },
  { name: '温顺', buffStat: 'spDef', nerfStat: 'def' },
  { name: '急躁', buffStat: 'speed', nerfStat: 'def' },
  { name: '天真', buffStat: 'speed', nerfStat: 'spDef' },
  { name: '无修正', buffStat: 'none', nerfStat: 'none' },
]

/** 应用性格修正到种族值 */
export function applyPersonality(stats: PetStats, personality: Personality): PetStats {
  const modified = { ...stats }
  const BUFF = 1.1
  const NERF = 0.9
  if (personality.buffStat !== 'none') {
    modified[personality.buffStat] = Math.round(stats[personality.buffStat] * BUFF)
  }
  if (personality.nerfStat !== 'none') {
    modified[personality.nerfStat] = Math.round(stats[personality.nerfStat] * NERF)
  }
  return modified
}
