// Idle animation, always present; VRMModel loops it on load.
export const animations = {
  idleLoop: new URL('./idle_loop.vrma', import.meta.url),
}

// Auto-discovered body-gesture animations. Drop a `.vrma` into ./dances/ and it becomes
// playable by its filename (without extension, lowercased) — no code change needed. Vite
// resolves each glob match to a served asset URL at build/dev time.
const danceModules = import.meta.glob('./dances/*.vrma', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/**
 * Named registry of body-gesture animations that LLM tools resolve by name
 * (case-insensitively; keys are lowercased filenames). Built from the files in
 * `./dances/`, so adding a dance is just dropping a `<name>.vrma` there — the name the
 * user references (and the LLM passes to `vrm_play_animation`) is that filename.
 */
export const vrmGestureAnimations: Record<string, string> = Object.fromEntries(
  Object.entries(danceModules).map(([path, url]) => {
    const name = path.split('/').pop()!.replace(/\.vrma$/i, '').toLowerCase()
    return [name, url]
  }),
)

// Diagnostic: log all registered animation keys at module load
console.log('[animations/registry] glob found', Object.keys(vrmGestureAnimations).length, 'dances:', Object.keys(vrmGestureAnimations).filter(k => k.includes('画') || k.includes('趴') || k.includes('飘') || k.includes('坐')).join(', ') || '(no drawing animations found!)')
console.log('[animations/registry] first 5 keys:', Object.keys(vrmGestureAnimations).slice(0, 5).join(', '))
