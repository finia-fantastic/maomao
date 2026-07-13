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

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import process from 'node:process'
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
// These come from the 动作/ pack folder names mapped to their VRChat batch filenames.
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

  // Apply known name overrides
  if (NAME_OVERRIDES[name]) {
    name = NAME_OVERRIDES[name]
  }

  // テレパシ stays as-is (no override needed — prefix strip is sufficient)
  return name
}

// First .vrma found recursively under `dir` (packs bury it in a `vrma/` subfolder).
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

// Check whether a directory is a "flat pack": contains multiple .vrma files directly at
// the top level (e.g. vrchat100个动作 VRChat batch conversion). Single-.vrma folders
// use the standard nested-pack logic (folder name becomes dance name).
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

// Files that should be preserved in dances/ as-is and not renamed/synced by the flat
// pack logic. Base animations are character control (idle/sit/face/costume).
// Animation_TikTok_NN_ files without a name mapping are preserved with original name.
function shouldSkipInFlatPack(filename) {
  return filename.startsWith('Animation_Base_Lazuli_')
    || filename.startsWith('Animation_Lazuli_')
    || filename === 'Animation_Base_NULL.vrma'
    || /^Animation_TikTok_\d+_/.test(filename)
}

let count = 0
const produced = new Set()

for (const pack of readdirSync(packsDir)) {
  const packPath = join(packsDir, pack)
  if (!statSync(packPath).isDirectory())
    continue

  // Flat pack: .vrma files directly at top level (e.g. vrchat100个动作).
  // Sync each file individually with name normalization.
  // Skip base animation files (Animation_Base_Lazuli_* etc.) — they are character
  // control animations, not dances, and live in dances/ independently.
  if (isFlatPack(packPath)) {
    console.info(`[sync-dances] "${pack}": flat pack, syncing individual files`)
    for (const file of readdirSync(packPath)) {
      if (!file.toLowerCase().endsWith('.vrma'))
        continue
      const filePath = join(packPath, file)
      if (!statSync(filePath).isFile())
        continue
      if (shouldSkipInFlatPack(file)) {
        // Register so existing copies aren't pruned, but don't re-sync.
        produced.add(file)
        continue
      }
      const rawName = basename(file, extname(file))
      const cleanName = normalizeDanceName(rawName)
      const fileName = `${cleanName}.vrma`
      // Skip if short-name version already exists (prefer existing).
      const destPath = join(dancesDir, fileName)
      if (existsSync(destPath)) {
        console.info(`[sync-dances]   "${fileName}" already exists, skipping (prefer existing)`)
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

  // Nested pack: find the first .vrma recursively, use folder name as dance name.
  const vrma = findVrma(packPath)
  if (!vrma) {
    console.info(`[sync-dances] "${pack}": no .vrma inside (only vmd/fbx?), skipped`)
    continue
  }
  const fileName = `${pack}.vrma`
  copyFileSync(vrma, join(dancesDir, fileName))
  produced.add(fileName)
  console.info(`[sync-dances] "${pack}" ready`)
  count++
}

// Prune stale dances: remove any dances/*.vrma no longer backed by a 动作/ pack, so
// renaming or deleting a pack folder doesn't leave an unplayable ghost dance behind.
// Base animation files (Animation_Base_Lazuli_* etc.) are preserved — they are
// character control animations that live in dances/ independently of 动作/ packs.
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
