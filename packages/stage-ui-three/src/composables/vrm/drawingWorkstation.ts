import type { VRM } from '@pixiv/three-vrm'
import { Object3D } from 'three'
import {
  BoxGeometry,
  Euler,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'

/**
 * Drawing workstation — simple geometric desk + tilted screen placed in
 * front of the character so it looks like they are drawing.
 *
 * Usage from the component that owns the scene and VRM:
 *
 *   showDrawingWorkstation(scene, vrm, vrmGroup)
 *   hideDrawingWorkstation()
 */

// ---- Tuneable parameters ------------------------------------------------

/** Desk dimensions (meters, VRM 1 unit = 1 m). */
const DESK_SIZE = new Vector3(0.8, 0.04, 0.5)

/** Screen/tablet dimensions. */
const SCREEN_SIZE = new Vector3(0.35, 0.24, 0.02)

/** Position of the desk relative to the VRM group origin (in front). */
const DESK_OFFSET = new Vector3(0, -0.35, 0.65)

/** Screen position relative to desk top. */
const SCREEN_OFFSET = new Vector3(0, 0.25, -0.05)

/** Screen tilt — top leans away from character so they look down at it. */
const SCREEN_TILT = new Euler(-0.3, 0, 0)

// ---- Colours ------------------------------------------------------------

const DESK_COLOR = 0x5C4033 // warm brown wood
const SCREEN_COLOR = 0x2D2D2D // dark grey bezel

// ---- State --------------------------------------------------------------

let workstationGroup: Group | null = null
let deskMesh: Mesh | null = null
let screenMesh: Mesh | null = null
let lookTarget: Object3D | null = null

// ---- Public API ---------------------------------------------------------

/**
 * Place a desk + screen in the scene and point the character's gaze at it.
 * Also attaches the pencil to the right hand via the existing hand prop
 * system (must be set separately via modelStore.requestHandProp('pencil')).
 */
export function showDrawingWorkstation(
  scene: Object3D,
  vrm: VRM,
  vrmGroup: Object3D,
) {
  if (workstationGroup) return // already shown

  // --- Build workstation group ---
  workstationGroup = new Group()
  workstationGroup.name = 'airiDrawingWorkstation'

  // Position relative to VRM group
  const vrmWorldPos = new Vector3()
  vrmGroup.getWorldPosition(vrmWorldPos)
  workstationGroup.position.copy(vrmWorldPos).add(DESK_OFFSET)

  // Desk
  const deskGeo = new BoxGeometry(DESK_SIZE.x, DESK_SIZE.y, DESK_SIZE.z)
  const deskMat = new MeshStandardMaterial({ color: DESK_COLOR, roughness: 0.7 })
  deskMesh = new Mesh(deskGeo, deskMat)
  deskMesh.position.set(0, 0, 0)
  deskMesh.name = 'airiDesk'
  workstationGroup.add(deskMesh)

  // Screen on top of desk
  const screenGeo = new BoxGeometry(SCREEN_SIZE.x, SCREEN_SIZE.y, SCREEN_SIZE.z)
  const screenMat = new MeshStandardMaterial({ color: SCREEN_COLOR, roughness: 0.5 })
  screenMesh = new Mesh(screenGeo, screenMat)
  screenMesh.position.copy(SCREEN_OFFSET)
  screenMesh.rotation.copy(SCREEN_TILT)
  screenMesh.name = 'airiScreen'
  workstationGroup.add(screenMesh)

  scene.add(workstationGroup)

  // --- Point lookAt at screen ---
  // VRM lookAt.target expects an Object3D, not a Vector3.
  // Create a small invisible node positioned at screen center.
  lookTarget = new Object3D()
  lookTarget.name = 'airiLookTarget'
  const screenWorldPos = new Vector3()
  screenMesh.getWorldPosition(screenWorldPos)
  lookTarget.position.copy(screenWorldPos)
  scene.add(lookTarget)

  if (vrm.lookAt) {
    vrm.lookAt.target = lookTarget
    vrm.lookAt.autoUpdate = true
  }

  console.log('[DrawingWorkstation] shown')
}

/** Remove the workstation from the scene and reset gaze. */
export function hideDrawingWorkstation() {
  if (lookTarget) {
    lookTarget.removeFromParent()
    lookTarget = null
  }

  if (!workstationGroup) return

  workstationGroup.removeFromParent()
  disposeMesh(deskMesh)
  disposeMesh(screenMesh)
  deskMesh = null
  screenMesh = null
  workstationGroup = null

  console.log('[DrawingWorkstation] hidden')
}

/** Toggle workstation on/off. */
export function toggleDrawingWorkstation(
  scene: Object3D,
  vrm: VRM,
  vrmGroup: Object3D,
) {
  if (workstationGroup) hideDrawingWorkstation()
  else showDrawingWorkstation(scene, vrm, vrmGroup)
}

export function isDrawingWorkstationVisible(): boolean {
  return !!workstationGroup
}

// ---- Dispose ------------------------------------------------------------

function disposeMesh(mesh: Mesh | null) {
  if (!mesh) return
  mesh.geometry?.dispose()
  const mat = mesh.material as MeshStandardMaterial
  mat?.dispose()
}
