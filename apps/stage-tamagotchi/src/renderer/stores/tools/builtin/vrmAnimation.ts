import type { Tool } from '@xsai/shared-chat'

import { useModelStore } from '@proj-airi/stage-ui-three'
import { vrmGestureAnimations } from '@proj-airi/stage-ui-three/assets/vrm'
import { tool } from '@xsai/tool'
import { z } from 'zod'

// -- LLM Tools: VRM body gestures --
//
// These reach the on-screen VRM through the shared model store: the store holds
// a fire-and-forget `gesturePlayRequest`, and ThreeScene watches it and drives
// VRMModel.playAnimation. Nothing here touches a component ref directly, which
// keeps the tool callable from the renderer store context. Mirrors the Spine
// `spine_play_animation` tool that pokes `useSpine`.

interface VrmToolResult {
  success: boolean
  data?: unknown
  error?: string
}

function serialize(result: VrmToolResult): string {
  return JSON.stringify(result)
}

/**
 * Resolves a gesture name against the placeholder registry.
 *
 * Before:
 * - "Demo" / "demo"
 *
 * After:
 * - "<file url of the resolved .vrma>"
 *
 * NOTICE: The registry currently only ships a `demo` clip (idle_loop.vrma stand-in).
 * Real clips (e.g. `dance`) are registered in
 * packages/stage-ui-three/src/assets/vrm/animations/index.ts.
 */
function resolveGestureUrl(name: string): string | undefined {
  return vrmGestureAnimations[name.trim().toLowerCase()]
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'vrm_play_animation',
    description: [
      'Play a body-gesture animation (e.g. a dance) on the active VRM character.',
      'Only works when the VRM renderer is active and a model is loaded.',
      'Call vrm_list_animations first to discover available names; names are case-insensitive.',
      'By default the gesture plays once and the character eases back into its idle loop; pass loop: true to keep it playing.',
    ].join(' '),
    execute: async ({ name, loop }) => {
      const store = useModelStore()
      if (!store.vrmModelLoaded)
        return serialize({ success: false, error: 'No VRM model is currently loaded, or the active renderer is not VRM.' })

      const url = resolveGestureUrl(name)
      if (!url) {
        return serialize({
          success: false,
          error: `Animation "${name}" not found. Available: ${Object.keys(vrmGestureAnimations).join(', ')}`,
        })
      }

      store.requestGesturePlay(url, { loop: loop ?? false })
      return serialize({ success: true, data: { animation: name, loop: loop ?? false } })
    },
    parameters: z.object({
      name: z.string().describe('Gesture animation name, e.g. "dance" or "demo". Case-insensitive.'),
      loop: z.boolean().optional().describe('Loop the gesture instead of playing once and reverting to idle. Defaults to false.'),
    }),
  }),

  tool({
    name: 'vrm_list_animations',
    description: 'List the body-gesture animations available to play on the active VRM character.',
    execute: async () => {
      const keys = Object.keys(vrmGestureAnimations)
      console.log('[vrm_list_animations] returning', keys.length, 'animations',
        'drawing:', keys.filter(k => k.includes('画') || k.includes('趴') || k.includes('飘')).join(', ') || '(none)')
      return serialize({ success: true, data: keys })
    },
    parameters: z.object({}),
  }),
]

export const vrmAnimationTools = async () => Promise.all(tools)
