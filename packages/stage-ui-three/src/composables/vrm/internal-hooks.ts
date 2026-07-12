import type { VrmHook } from './hooks'

import { createVrmHandPropHook } from './handProp'
import { createVrmOutlineHook } from './outline'

export function resolveInternalVrmHooks(): readonly VrmHook[] {
  return [
    createVrmOutlineHook(),
    createVrmHandPropHook(),
  ]
}
