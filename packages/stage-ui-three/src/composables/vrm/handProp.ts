import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import type { Material, Object3D } from 'three'
import { Euler, Group, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import type { VrmHook } from './hooks'

export type HandPropType = 'none' | 'camera' | 'pencil' | 'tablet-pen'

interface PropConfig {
  glbUrl: string | null
  bones: readonly VRMHumanBoneName[]
  position: Vector3
  rotation: Euler
  scale: number
}

const PROP_CONFIGS: Record<Exclude<HandPropType, 'none'>, PropConfig> = {
  camera: {
    glbUrl: new URL('../../assets/vrm/props/camera.glb', import.meta.url).href,
    bones: ['rightHand', 'leftHand'],
    position: new Vector3(0, -0.03, 0.03),
    rotation: new Euler(0, 0, 0),
    scale: 1,
  },
  pencil: {
    glbUrl: new URL('../../assets/vrm/props/pencil.glb', import.meta.url).href,
    bones: ['rightHand'],
    position: new Vector3(0.01, -0.01, 0.04),
    rotation: new Euler(Math.PI * 0.5, 0, Math.PI * 0.25),
    scale: 0.6,
  },
  'tablet-pen': {
    glbUrl: null,
    bones: [],
    position: new Vector3(),
    rotation: new Euler(),
    scale: 1,
  },
}

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'alphaMap',
] as const

interface HandPropHandle {
  root: Group
  disposed: boolean
}

const handPropRegistry = new WeakMap<VRM, HandPropHandle[]>()

let propLoader: GLTFLoader | undefined
function usePropLoader() {
  propLoader ??= new GLTFLoader()
  return propLoader
}

function disposeMaterial(material: Material) {
  const slots = material as unknown as Record<string, { isTexture?: boolean, dispose?: () => void } | undefined>
  for (const slot of TEXTURE_SLOTS) {
    const texture = slots[slot]
    if (texture?.isTexture) texture.dispose?.()
  }
  material.dispose()
}

function disposeObjectTree(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of materials) { if (mat) disposeMaterial(mat) }
  })
}

async function loadPropModel(url: string, handle: HandPropHandle) {
  try {
    const gltf = await usePropLoader().loadAsync(url)
    if (handle.disposed) { disposeObjectTree(gltf.scene); return }
    gltf.scene.name ||= 'airiHandPropModel'
    handle.root.add(gltf.scene)
  }
  catch (error) {
    console.warn('[AIRI] hand prop: load failed', url, error)
  }
}

function attachToBone(handNode: Object3D, config: PropConfig): HandPropHandle {
  const root = new Group()
  root.name = 'airiHandProp'
  root.position.copy(config.position)
  root.rotation.copy(config.rotation)
  root.scale.setScalar(config.scale)

  const handle: HandPropHandle = { root, disposed: false }
  handNode.add(root)

  if (config.glbUrl) loadPropModel(config.glbUrl, handle)
  return handle
}

function attachForType(vrm: VRM, type: Exclude<HandPropType, 'none'>) {
  const humanoid = vrm.humanoid
  if (!humanoid) return

  const handles: HandPropHandle[] = []

  if (type === 'tablet-pen') {
    const configs: PropConfig[] = [
      {
        glbUrl: new URL('../../assets/vrm/props/tablet.glb', import.meta.url).href,
        bones: ['leftHand'],
        position: new Vector3(0.01, -0.02, 0.06),
        rotation: new Euler(Math.PI * 0.15, 0, 0),
        scale: 0.8,
      },
      {
        glbUrl: new URL('../../assets/vrm/props/pencil.glb', import.meta.url).href,
        bones: ['rightHand'],
        position: new Vector3(0.01, -0.01, 0.04),
        rotation: new Euler(Math.PI * 0.5, 0, Math.PI * 0.25),
        scale: 0.6,
      },
    ]
    for (const cfg of configs) {
      for (const bone of cfg.bones) {
        const node = humanoid.getNormalizedBoneNode(bone)
        if (node) handles.push(attachToBone(node, cfg))
      }
    }
  }
  else {
    const config = PROP_CONFIGS[type]
    for (const bone of config.bones) {
      const node = humanoid.getNormalizedBoneNode(bone)
      if (node) handles.push(attachToBone(node, config))
    }
  }

  if (handles.length) handPropRegistry.set(vrm, handles)
}

export function switchVrmHandProp(vrm: VRM, type: HandPropType) {
  disposeVrmHandProp(vrm)
  if (type !== 'none') attachForType(vrm, type)
}

export function syncVrmHandProp(vrm: VRM) {
  const handles = handPropRegistry.get(vrm)
  if (!handles) return
  for (const h of handles) {
    if (!h.disposed && h.root.parent) h.root.updateWorldMatrix(true, true)
  }
}

export function disposeVrmHandProp(vrm?: VRM) {
  if (!vrm) return
  const handles = handPropRegistry.get(vrm)
  if (!handles) return
  for (const h of handles) {
    h.disposed = true
    h.root.removeFromParent()
    disposeObjectTree(h.root)
  }
  handPropRegistry.delete(vrm)
}

export function createVrmHandPropHook(): VrmHook {
  return {
    onLoad() {},
    onDispose({ vrm }) { disposeVrmHandProp(vrm) },
  }
}
