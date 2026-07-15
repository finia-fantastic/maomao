import type { VRM } from '@pixiv/three-vrm'
import type { Material, Mesh, Object3D } from 'three'

import type { VrmHook } from './hooks'

import { Euler, Group, Vector3 } from 'three'
// ---- VRM Hook -------------------------------------------------------------
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// ---- GLB URLs -----------------------------------------------------------

const TABLET_GLB_URL = new URL('../../assets/vrm/props/tablet.glb', import.meta.url).href
const PENCIL_GLB_URL = new URL('../../assets/vrm/props/pencil.glb', import.meta.url).href

// ---- Per-bone offset config -----------------------------------------------

/**
 * Tablet hold offset (left hand palm, local space).
 * +Z points out of the palm for a standard normalized VRM rig.
 * The tablet should sit flat on the palm, screen facing up.
 */
const TABLET_POSITION = new Vector3(0.01, -0.02, 0.06)
const TABLET_ROTATION = new Euler(Math.PI * 0.15, 0, 0)
const TABLET_SCALE = 0.8

/**
 * Pen hold offset (right hand, between thumb and index finger).
 * Positioned so the pen tip extends past the fingers.
 */
const PENCIL_POSITION = new Vector3(0.01, -0.01, 0.04)
const PENCIL_ROTATION = new Euler(Math.PI * 0.5, 0, Math.PI * 0.25)
const PENCIL_SCALE = 0.6

// ---- Texture slots for disposal ------------------------------------------

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
] as const

// ---- Internal state ------------------------------------------------------

interface PropHandle {
  root: Group
  disposed: boolean
}

interface DrawingPropState {
  tablet?: PropHandle
  pencil?: PropHandle
  visible: boolean
}

const registry = new WeakMap<VRM, DrawingPropState>()

let propLoader: GLTFLoader | undefined
function usePropLoader() {
  propLoader ??= new GLTFLoader()
  return propLoader
}

// ---- Dispose helpers -----------------------------------------------------

function disposeMaterial(material: Material) {
  const slots = material as unknown as Record<string, { isTexture?: boolean, dispose?: () => void } | undefined>
  for (const slot of TEXTURE_SLOTS) {
    const texture = slots[slot]
    if (texture?.isTexture)
      texture.dispose?.()
  }
  material.dispose()
}

function disposeObjectTree(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh)
      return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of materials) {
      if (mat)
        disposeMaterial(mat)
    }
  })
}

// ---- Attach --------------------------------------------------------------

function attachProp(
  boneNode: Object3D,
  glbUrl: string,
  pos: Vector3,
  rot: Euler,
  scale: number,
  name: string,
): PropHandle {
  const root = new Group()
  root.name = name
  root.position.copy(pos)
  root.rotation.copy(rot)
  root.scale.setScalar(scale)

  const handle: PropHandle = { root, disposed: false }
  boneNode.add(root)

  usePropLoader().loadAsync(glbUrl).then((gltf) => {
    if (handle.disposed) { disposeObjectTree(gltf.scene); return }
    gltf.scene.name ||= name
    root.add(gltf.scene)
  }).catch((error) => {
    console.warn(`[DrawingProp] Failed to load ${name}:`, error)
  })

  return handle
}

// ---- Public API ----------------------------------------------------------

/**
 * Show drawing props (tablet + pen). Attaches to hand bones if not already
 * attached; makes existing props visible if they were previously hidden.
 */
export function showDrawingProps(vrm: VRM) {
  const humanoid = vrm.humanoid
  if (!humanoid)
    return

  let state = registry.get(vrm)
  if (!state) {
    state = { visible: false }
    registry.set(vrm, state)
  }

  if (state.visible)
    return // already showing
  state.visible = true

  // Tablet → left hand
  if (!state.tablet) {
    const leftHand = humanoid.getNormalizedBoneNode('leftHand')
    if (leftHand) {
      state.tablet = attachProp(leftHand, TABLET_GLB_URL, TABLET_POSITION, TABLET_ROTATION, TABLET_SCALE, 'airiDrawingTablet')
    }
  }
  else {
    state.tablet.root.visible = true
  }

  // Pencil → right hand
  if (!state.pencil) {
    const rightHand = humanoid.getNormalizedBoneNode('rightHand')
    if (rightHand) {
      state.pencil = attachProp(rightHand, PENCIL_GLB_URL, PENCIL_POSITION, PENCIL_ROTATION, PENCIL_SCALE, 'airiDrawingPencil')
    }
  }
  else {
    state.pencil.root.visible = true
  }
}

/**
 * Hide drawing props without disposing (can be shown again).
 */
export function hideDrawingProps(vrm: VRM) {
  const state = registry.get(vrm)
  if (!state)
    return
  state.visible = false

  if (state.tablet)
    state.tablet.root.visible = false
  if (state.pencil)
    state.pencil.root.visible = false
}

/**
 * Toggle drawing props visibility.
 */
export function toggleDrawingProps(vrm: VRM) {
  const state = registry.get(vrm)
  if (state?.visible)
    hideDrawingProps(vrm)
  else showDrawingProps(vrm)
}

/**
 * Check if drawing props are currently visible.
 */
export function isDrawingPropVisible(vrm: VRM): boolean {
  return registry.get(vrm)?.visible ?? false
}

/**
 * Sync world matrices AFTER humanoid.update() so props follow the hand bones
 * in the current frame's pose. Call this in the render loop after
 * `vrm.humanoid.update()`.
 */
export function syncDrawingProps(vrm: VRM) {
  const state = registry.get(vrm)
  if (!state)
    return

  if (state.tablet && !state.tablet.disposed && state.tablet.root.parent) {
    state.tablet.root.updateWorldMatrix(true, true)
  }
  if (state.pencil && !state.pencil.disposed && state.pencil.root.parent) {
    state.pencil.root.updateWorldMatrix(true, true)
  }
}

/**
 * Fully detach and dispose drawing props for a VRM.
 */
export function disposeDrawingProps(vrm?: VRM) {
  if (!vrm)
    return

  const state = registry.get(vrm)
  if (!state)
    return

  for (const handle of [state.tablet, state.pencil]) {
    if (!handle)
      continue
    handle.disposed = true
    handle.root.removeFromParent()
    disposeObjectTree(handle.root)
  }
  registry.delete(vrm)
}

export function createVrmDrawingPropHook(): VrmHook {
  return {
    onLoad({ vrm }) {
      // Don't auto-show — drawing props only appear during drawing animations.
      // Pre-warm the state entry so showDrawingProps() doesn't need to
      // create it on the hot path.
      if (!registry.has(vrm)) {
        registry.set(vrm, { visible: false })
      }
    },
    onDispose({ vrm }) {
      disposeDrawingProps(vrm)
    },
  }
}
