// Sync dance animations from the user's drop folder (动作/) into the in-repo dances/
// folder that the Vite glob picks up. Each subfolder of 动作/ that contains a `.vrma`
// (searched recursively — packs usually nest it under a `vrma/` subfolder) becomes a
// playable dance named after that subfolder. Run before launching the pet (run_pet.bat).
//
// Workflow: drop a downloaded dance pack folder into 动作/, rename the folder to the name
// you want to say ("跳<folder>"), start the pet — the dance is auto-registered.
//
// Flat packs (e.g. vrchat100个动作) that contain .vrma files directly at the top level
// are synced file-by-file with name normalization (prefix stripping + known mappings).

import process from 'node:process'

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const packsDir = join(root, '动作')
const dancesDir = join(root, 'packages/stage-ui-three/src/assets/vrm/animations/dances')

if (!existsSync(packsDir)) {
  console.info('[sync-dances] no 动作/ folder, nothing to sync')
  process.exit(0)
}
mkdirSync(dancesDir, { recursive: true })

// Prefixes to strip from auto-generated filenames (VRChat batch conversion, etc.).
const STRIP_PREFIXES = [
  'TikTok_Motion_TikTok_',
  'TikTok_Motion_',
  'Animation_Base_Lazuli_',
  'Animation_Lazuli_Lazuli_',
  'Animation_Lazuli_',
]

// Regex for prefixes like Animation_TikTok_13_ (numbered variants).
const ANIMATION_TIKTOK_NUM_RE = /^Animation_TikTok_\d+_/

// Known name overrides: raw filename (sans .vrma, after prefix strip) → desired name.
const NAME_OVERRIDES = {
  '美少女無罪パイレーツ': '美少女无罪',
  '粛清ロリ神レクイエム': '萝莉神',
  'なぜ謎ANSWER': '露露卡',
  '心予報': '心予报',
  'ハッピーシンセサイザ': '快乐合成器',
  '愛包ダンスホール': '爱派dancehall',
  '最上級にかわいいの': '最上级的可爱',
  '愛♡スクリ～ム！': '愛スクリーム（ice cream）',
  '刀ピークリスマスのテーマソング2023': '刀p',
  'テレパシ': '体操歌',
  '体操歌': '体操歌',
}

// Folder name → dance name prefix for multi-file packs or renamed folders.
const FOLDER_NAME_MAP = {
  'AnimationPack_vol_01': '', // special: sync all .vrma with individual names
  'ムリムリ進化論（进化论）': '进化论',
  '質問、恋って何でしょうか？（质问恋爱是什么？）': '质问恋爱', // appends 1/2/3
}

// Known multi-file packs with name mappings (base name → renamed output).
// Drawing poses are character animations, not dances.
const DRAWING_NAME_MAP = {
  anim_anim_drawing_float: '飘着画画',
  anim_anim_drawing_prone: '趴着画画',
  anim_anim_drawing_sit: '坐着画画',
}

/**
 * Normalize a raw .vrma filename (without extension) to a user-friendly dance name.
 * Strips known prefixes then applies name overrides.
 */
function normalizeDanceName(rawName) {
  let name = rawName

  for (const prefix of STRIP_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length)
      break
    }
  }

  name = name.replace(ANIMATION_TIKTOK_NUM_RE, '')

  if (NAME_OVERRIDES[name]) {
    name = NAME_OVERRIDES[name]
  }

  return name
}

// First .vrma found recursively under `dir`.
function findVrma(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      const found = findVrma(p)
      if (found)
        return found
    }
    else if (name.toLowerCase().endsWith('.vrma')) {
      return p
    }
  }
  return null
}

// All .vrma files found recursively under `dir`.
function findAllVrma(dir) {
  const result = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      result.push(...findAllVrma(p))
    }
    else if (name.toLowerCase().endsWith('.vrma')) {
      result.push(p)
    }
  }
  return result
}

// Check whether a directory is a "flat pack": contains multiple .vrma files directly at
// the top level (e.g. vrchat100个动作 VRChat batch conversion).
function isFlatPack(dir) {
  let vrmaCount = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (!statSync(p).isDirectory() && name.toLowerCase().endsWith('.vrma')) {
      vrmaCount++
      if (vrmaCount >= 2)
        return true
    }
  }
  return false
}

// Files that should be preserved in dances/ and not pruned.
function shouldSkipInFlatPack(filename) {
  return filename.startsWith('Animation_Base_Lazuli_')
    || filename.startsWith('Animation_Lazuli_')
    || filename === 'Animation_Base_NULL.vrma'
    || /^Animation_TikTok_\d+_/.test(filename)
}

// Known dance names used by multi-file packs. Size-based matching maps source .vrma
// byte sizes to preferred user-facing dance names.
const SIZE_TO_NAME = {
  // AnimationPack_vol_01
  548176: 'BabyYou',
  679352: 'Toca',
  449612: '这么可爱真是抱歉',
  479536: 'blue',
  1212704: '青空狂想曲',
}

let count = 0
const produced = new Set()

for (const pack of readdirSync(packsDir)) {
  const packPath = join(packsDir, pack)
  if (!statSync(packPath).isDirectory())
    continue

  // Flat pack: .vrma files directly at top level (e.g. vrchat100个动作).
  if (isFlatPack(packPath)) {
    console.info(`[sync-dances] "${pack}": flat pack, syncing individual files`)
    for (const file of readdirSync(packPath)) {
      if (!file.toLowerCase().endsWith('.vrma'))
        continue
      const filePath = join(packPath, file)
      if (!statSync(filePath).isFile())
        continue
      if (shouldSkipInFlatPack(file)) {
        produced.add(file)
        continue
      }
      const rawName = basename(file, extname(file))
      const cleanName = normalizeDanceName(rawName)
      const fileName = `${cleanName}.vrma`
      const destPath = join(dancesDir, fileName)
      if (existsSync(destPath)) {
        console.info(`[sync-dances]   "${fileName}" already exists, skipping`)
        produced.add(fileName)
        count++
        continue
      }
      copyFileSync(filePath, destPath)
      produced.add(fileName)
      console.info(`[sync-dances]   "${rawName}.vrma" → "${fileName}" ready`)
      count++
    }
    continue
  }

  // Multi-vrma nested pack: vrma/ subfolder has multiple .vrma files.
  // Sync each one with individual naming.
  const allVrma = findAllVrma(packPath)
  if (allVrma.length >= 2) {
    console.info(`[sync-dances] "${pack}": multi-dance pack (${allVrma.length} vrma), syncing individually`)
    allVrma.sort()
    let idx = 0
    for (const vrmaPath of allVrma) {
      idx++
      let fileName
      const folderBase = FOLDER_NAME_MAP[pack]

      if (folderBase !== undefined) {
        // Known multi-file pack — use mapped base name
        if (folderBase === '') {
          // Special: use SIZE_TO_NAME mapping for individual files
          const size = statSync(vrmaPath).size
          const nameFromSize = SIZE_TO_NAME[size]
          if (nameFromSize) {
            fileName = `${nameFromSize}.vrma`
          }
          else {
            // Fallback to filename
            const raw = basename(vrmaPath, extname(vrmaPath))
            fileName = `${normalizeDanceName(raw)}.vrma`
          }
        }
        else {
          // Use mapped name with number suffix
          fileName = allVrma.length > 1 ? `${folderBase}${idx}.vrma` : `${folderBase}.vrma`
        }
      }
      else if (pack === 'Drawing_v01_01') {
        // Drawing poses — use DRAWING_NAME_MAP, skip tablet/pen/empty animations
        const raw = basename(vrmaPath, extname(vrmaPath))
        const mapped = DRAWING_NAME_MAP[raw]
        if (mapped) {
          fileName = `${mapped}.vrma`
        }
        else {
          // Skip non-character animations (tablet, pen, empty)
          console.info(`[sync-dances]   skipping "${raw}.vrma" (not a character pose)`)
          continue
        }
      }
      else {
        // Unknown pack — use filename from vrma/
        const raw = basename(vrmaPath, extname(vrmaPath))
        fileName = `${normalizeDanceName(raw)}.vrma`
      }
      const destPath = join(dancesDir, fileName)
      if (existsSync(destPath)) {
        console.info(`[sync-dances]   "${fileName}" already exists, skipping`)
        produced.add(fileName)
        count++
        continue
      }
      copyFileSync(vrmaPath, destPath)
      produced.add(fileName)
      console.info(`[sync-dances]   → "${fileName}" ready`)
      count++
    }
    continue
  }

  // Single-vrma nested pack: one .vrma found, use folder name (with mapping).
  const vrma = findVrma(packPath)
  if (!vrma) {
    console.info(`[sync-dances] "${pack}": no .vrma inside (only vmd/fbx?), skipped`)
    continue
  }
  const mappedName = FOLDER_NAME_MAP[pack] || pack
  const fileName = `${mappedName}.vrma`
  copyFileSync(vrma, join(dancesDir, fileName))
  produced.add(fileName)
  console.info(`[sync-dances] "${pack}" → "${fileName}" ready`)
  count++
}

// Prune stale dances: remove dances/*.vrma not backed by a 动作/ pack.
for (const f of readdirSync(dancesDir)) {
  if (f.toLowerCase().endsWith('.vrma') && !produced.has(f)) {
    if (shouldSkipInFlatPack(f)) {
      produced.add(f)
      continue
    }
    unlinkSync(join(dancesDir, f))
    console.info(`[sync-dances] pruned stale "${f}"`)
  }
}

console.info(`[sync-dances] ${count} dance(s) synced into dances/`)
