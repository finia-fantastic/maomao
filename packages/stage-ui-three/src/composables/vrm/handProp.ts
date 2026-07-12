import type { VRM } from '@pixiv/three-vrm'
import type { Material, Object3D } from 'three'

import { BoxGeometry, Euler, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import type { VrmHook } from './hooks'

/*
  * Hand-held prop prototype.
  *
  * Attaches a small prop (e.g. a camera) to one or both of the VRM's hands so it
  * "sticks" to the palm and rides along with the character's hand/body animation.
  * The prop is parented to the normalized hand bone; as a child of that bone its
  * world transform is derived from the bone's world matrix during the scene graph
  * update, so no manual per-frame position copy is required for it to follow the
  * hand — the humanoid animation moves the bone, the bone moves the prop.
  * `syncVrmHandProp()` only refreshes the prop's world matrix at a well-defined
  * point in the frame (see its doc) for mid-frame consumers.
*/

/**
 * Feature flag for the hand-held prop prototype.
 *
 * With the flag off no prop is attached and rendering is byte-for-byte unchanged
 * (the per-frame {@link syncVrmHandProp} call becomes a single WeakMap miss). Flip to
 * `true` to put the Canon AT-1 camera glb back in the character's hand(s).
 */
export const ATTACH_HAND_PROP = false

/**
 * Which hand bone(s) to hold the prop in. A separate prop instance is attached to
 * each listed bone. The stage renders the VRM mirrored (the character faces the
 * viewer), so the character's `rightHand` appears on the viewer's left.
 *
 * - `['rightHand']` / `['leftHand']` — one hand.
 * - `['rightHand', 'leftHand']` — both hands (current default; a prop in each).
 */
export const HAND_PROP_BONES = ['rightHand', 'leftHand'] as const

/**
 * URL of the glTF/GLB prop to hold. Resolved from the bundled package asset via
 * `import.meta.url` (same pattern as the VRMA animation assets), so it works in
 * any app that consumes this package without depending on a per-app `public/`
 * path. When `null`, a placeholder box is used instead.
 *
 * The current asset is a Canon AT-1 camera (converted from FBX/.blend to GLB,
 * PBR textures downscaled to 1K). To swap in a different prop, drop its `.glb`
 * next to this one under `assets/vrm/props/` and repoint this URL, then tune the
 * `HAND_PROP_*` hold offsets below until it sits in the palm.
 */
export const HAND_PROP_GLB_URL: string | null = new URL('../../assets/vrm/props/camera.glb', import.meta.url).href

// Hold offset, expressed in a hand bone's LOCAL space, shared by both hands.
//
// The prop is parented to the bone, so these are constant local transforms and
// the bone's animation supplies the world motion. Units are meters (VRM uses a
// 1 unit = 1 meter scale). Both position and rotation are model- and
// prop-dependent: VRM normalizes bone orientation per spec, but where "the palm"
// is and how a given prop's own origin/axes are authored still varies, so expect
// to nudge these until the prop looks gripped. +Z here points roughly out of the
// palm for a standard normalized VRM rig.
//
// NOTE: left and right hands are mirror-symmetric, so a single shared offset can
// look correct in one hand and slightly off in the other. If both hands need
// independent placement, split these into per-bone offsets keyed by HAND_PROP_BONES.
const HAND_PROP_POSITION_OFFSET = new Vector3(0, -0.03, 0.03)
// Euler is applied in the bone's local space (XYZ order, radians).
const HAND_PROP_ROTATION_OFFSET = new Euler(0, 0, 0)
const HAND_PROP_SCALE = 1

// Placeholder prop, used only when HAND_PROP_GLB_URL is null. A small red box
// roughly the size of a compact camera body — enough to visually prove the prop
// attaches and tracks the hand. Replace by pointing HAND_PROP_GLB_URL at a .glb.
const PLACEHOLDER_BOX_SIZE = new Vector3(0.06, 0.045, 0.09)
const PLACEHOLDER_COLOR = 0xE94B4B

// Texture slots that a placeholder/GLB material may own and that must be freed
// on dispose. three's `Material.dispose()` releases the material program but not
// the textures it references, so we release these explicitly.
const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
] as const

interface HandPropHandle {
  /** Group parented to a hand bone; carries the hold offset and owns the prop subtree. */
  root: Group
  /** Set on dispose to drop a late async GLB attach that resolves after teardown. */
  disposed: boolean
}

// Keyed by VRM → one handle per attached hand. A cached/reused VRM keeps its
// already-attached props instead of stacking duplicates, mirroring how outline.ts
// scopes runtime state per VRM. Entries drop on dispose or when the VRM is GC'd.
const handPropRegistry = new WeakMap<VRM, HandPropHandle[]>()

// A plain (non-VRM) GLTFLoader for prop models. Kept separate from the shared
// VRM loader so prop GLBs are not run through the VRM extension plugins.
let propLoader: GLTFLoader | undefined
function usePropLoader() {
  propLoader ??= new GLTFLoader()
  return propLoader
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'string')
    return error
  return String(error)
}

function createPlaceholderBox() {
  const geometry = new BoxGeometry(
    PLACEHOLDER_BOX_SIZE.x,
    PLACEHOLDER_BOX_SIZE.y,
    PLACEHOLDER_BOX_SIZE.z,
  )
  const material = new MeshStandardMaterial({ color: PLACEHOLDER_COLOR })
  const box = new Mesh(geometry, material)
  box.name = 'airiHandPropPlaceholder'
  return box
}

async function loadPropModel(url: string, handle: HandPropHandle) {
  try {
    const gltf = await usePropLoader().loadAsync(url)

    // The VRM may have been disposed while the GLB was still loading; if so, drop
    // the result and release it rather than attaching to a torn-down handle.
    if (handle.disposed) {
      disposeObjectTree(gltf.scene)
      return
    }

    gltf.scene.name ||= 'airiHandPropModel'
    handle.root.add(gltf.scene)
  }
  catch (error) {
    console.warn('[AIRI] hand prop: failed to load GLB, holder stays empty.', url, toErrorMessage(error))
  }
}

function disposeMaterial(material: Material) {
  // NOTICE:
  // Base `Material` does not type the optional texture slots, but concrete prop
  // materials (MeshStandardMaterial from GLB or the placeholder) do carry them.
  // Root cause: three's type hierarchy puts maps on subclasses, not `Material`.
  // Narrowing to a slot record lets us free textures without importing every
  // concrete material type; safe because unknown slots read as undefined.
  // Removal condition: replace if three exposes a typed texture-slot iterator.
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
    for (const material of materials) {
      if (material)
        disposeMaterial(material)
    }
  })
}

// Build one holder parented to `handNode`, carrying the hold offset, with either
// the loaded GLB (async) or the placeholder box.
function attachToBone(handNode: Object3D): HandPropHandle {
  const root = new Group()
  root.name = 'airiHandProp'
  root.position.copy(HAND_PROP_POSITION_OFFSET)
  root.rotation.copy(HAND_PROP_ROTATION_OFFSET)
  root.scale.setScalar(HAND_PROP_SCALE)

  const handle: HandPropHandle = { root, disposed: false }

  // Parent the holder to the normalized hand bone. From here the prop is a child
  // in the bone's subtree, so `root.matrixWorld = boneMatrixWorld * offset` is
  // recomputed by the normal scene graph update and the prop tracks the animated
  // hand with no per-frame bookkeeping.
  handNode.add(root)

  if (HAND_PROP_GLB_URL)
    loadPropModel(HAND_PROP_GLB_URL, handle) // async: holder is attached; model drops in when it resolves
  else
    root.add(createPlaceholderBox()) // NOTICE: placeholder; set HAND_PROP_GLB_URL to replace

  return handle
}

function attachHandProp(vrm: VRM) {
  // Idempotent: cache reuse re-fires onLoad for the same VRM object, and we must
  // not attach a second set of props to hands that already hold one.
  if (handPropRegistry.has(vrm))
    return

  const humanoid = vrm.humanoid
  if (!humanoid)
    return

  const handles: HandPropHandle[] = []
  for (const bone of HAND_PROP_BONES) {
    const handNode = humanoid.getNormalizedBoneNode(bone)
    if (!handNode) {
      console.warn(`[AIRI] hand prop: ${bone} bone not found on VRM humanoid; skipped.`)
      continue
    }
    handles.push(attachToBone(handNode))
  }

  if (handles.length)
    handPropRegistry.set(vrm, handles)
}

/**
 * Refresh the hand props' world matrices from the humanoid pose finalized this frame.
 *
 * Must be called AFTER `vrm.humanoid.update()`: that is the point at which this
 * frame's bone matrices are settled. `updateWorldMatrix(true, true)` walks up to
 * the scene root (so each hand bone's own world matrix is current) and back down
 * through the prop's children, leaving the props locked to the hands for anything
 * that reads their world transform before the renderer's own scene update. Calling
 * it earlier — e.g. in the pre-update `onFrame` hooks that run before
 * `humanoid.update()` — could read a not-yet-finalized pose and lag the props by
 * one frame. It is a cheap no-op (a single WeakMap miss) when no prop is attached.
 */
export function syncVrmHandProp(vrm: VRM) {
  const handles = handPropRegistry.get(vrm)
  if (!handles)
    return

  for (const handle of handles) {
    if (!handle.disposed && handle.root.parent)
      handle.root.updateWorldMatrix(true, true)
  }
}

/**
 * Detach and release all hand props for a VRM. Removing each holder from its bone
 * before disposing it also keeps the prop out of the VRM's own deep-dispose pass
 * (the holder is no longer a descendant of `vrm.scene`), avoiding a double free.
 */
export function disposeVrmHandProp(vrm?: VRM) {
  if (!vrm)
    return

  const handles = handPropRegistry.get(vrm)
  if (!handles)
    return

  for (const handle of handles) {
    handle.disposed = true
    handle.root.removeFromParent()
    disposeObjectTree(handle.root)
  }
  handPropRegistry.delete(vrm)
}

/**
 * VrmHook that owns the hand-held prop lifecycle: attach on load (guarded by
 * {@link ATTACH_HAND_PROP}), release on dispose. Per-frame following is handled
 * by scene-graph parenting; see {@link syncVrmHandProp} for the optional
 * post-`humanoid.update()` world-matrix refresh wired into the render loop.
 */
export function createVrmHandPropHook(): VrmHook {
  return {
    onLoad({ vrm }) {
      if (!ATTACH_HAND_PROP)
        return

      attachHandProp(vrm)
    },
    onDispose({ vrm }) {
      disposeVrmHandProp(vrm)
    },
  }
}
