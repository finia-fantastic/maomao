/**
 * Strip embedded 3D model data from VRMA (GLB) files.
 * V2: Keep ALL nodes with original indices. Only rebuild BIN with animation data.
 *
 * Usage: node tools/strip-vrma-model.cjs <input.vrma> [output.vrma]
 */

const fs = require('node:fs')

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67)
    throw new Error('Not a GLB file')
  if (buf.readUInt32LE(4) !== 2)
    throw new Error('Only GLB v2 supported')

  let offset = 12
  let jsonLen = buf.readUInt32LE(offset)
  let jsonType = buf.readUInt32LE(offset + 4)
  if (jsonType !== 0x4E4F534A) {
    offset = 12 + 8 + jsonLen
    jsonLen = buf.readUInt32LE(offset)
    jsonType = buf.readUInt32LE(offset + 4)
  }
  if (jsonType !== 0x4E4F534A)
    throw new Error('JSON chunk not found')

  const jsonStart = offset + 8
  const json = JSON.parse(buf.subarray(jsonStart, jsonStart + jsonLen).toString('utf-8'))

  let binStart
  const candidate = jsonStart + jsonLen
  if (candidate + 8 <= buf.length) {
    const cl = buf.readUInt32LE(candidate)
    if (buf.readUInt32LE(candidate + 4) === 0x004E4942)
      binStart = candidate
  }
  if (binStart === undefined) {
    if (buf.readUInt32LE(12 + 4) === 0x004E4942)
      binStart = 12
  }
  if (binStart === undefined)
    throw new Error('BIN chunk not found')

  const binLen = buf.readUInt32LE(binStart)
  const binData = buf.subarray(binStart + 8, binStart + 8 + binLen)
  return { json, binData, binLen }
}

function accessorByteSize(acc) {
  const compSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const typeCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  return (compSizes[acc.componentType] || 4) * (typeCounts[acc.type] || 1) * (acc.count || 0)
}

function stripVrma(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath)
  const { json, binData } = parseGlb(buf)

  // Validate
  const ext = json.extensions?.VRMC_vrm_animation
  if (!ext)
    throw new Error('VRMC_vrm_animation extension not found')
  if (!ext.humanoid?.humanBones)
    throw new Error('No humanoid humanBones')

  // Collect animation accessors (sampler input + output)
  const animAccessors = new Set()
  if (json.animations) {
    for (const anim of json.animations) {
      for (const s of (anim.samplers || [])) {
        if (s.input !== undefined)
          animAccessors.add(s.input)
        if (s.output !== undefined)
          animAccessors.add(s.output)
      }
    }
  }
  if (animAccessors.size === 0)
    throw new Error('No animation accessors found')

  // Check for unsupported features
  for (let i = 0; i < (json.accessors?.length || 0); i++) {
    const acc = json.accessors[i]
    if (acc.sparse)
      throw new Error(`Sparse accessor #${i} not supported`)
  }

  // Validate all references
  for (const [boneName, bone] of Object.entries(ext.humanoid.humanBones)) {
    if (bone.node !== undefined && !json.nodes[bone.node])
      throw new Error(`Invalid humanBone node: ${boneName} -> ${bone.node}`)
  }
  for (const animation of json.animations || []) {
    for (const channel of animation.channels || []) {
      const ni = channel.target?.node
      if (ni !== undefined && !json.nodes[ni])
        throw new Error(`Invalid animation target node: ${ni}`)
    }
  }
  for (let i = 0; i < (json.nodes?.length || 0); i++) {
    for (const child of json.nodes[i]?.children || []) {
      if (!json.nodes[child])
        throw new Error(`Invalid child: parent=${i} child=${child}`)
    }
  }
  for (const scene of json.scenes || []) {
    for (const node of scene.nodes || []) {
      if (!json.nodes[node])
        throw new Error(`Invalid scene root: ${node}`)
    }
  }

  // Rebuild accessors: only keep animation accessors
  const oldToNewAcc = new Map()
  const newAccessors = []

  for (let i = 0; i < (json.accessors?.length || 0); i++) {
    if (animAccessors.has(i)) {
      oldToNewAcc.set(i, newAccessors.length)
      newAccessors.push(JSON.parse(JSON.stringify(json.accessors[i])))
    }
  }

  // Rebuild BIN: extract only animation data
  const newBinChunks = []
  let binOffset = 0

  for (let i = 0; i < newAccessors.length; i++) {
    const acc = newAccessors[i]
    const bvIdx = acc.bufferView
    if (bvIdx === undefined)
      throw new Error('Accessor has no bufferView')

    const bv = json.bufferViews[bvIdx]
    const byteSize = accessorByteSize(acc)
    const srcOffset = (acc.byteOffset || 0) + (bv.byteOffset || 0)

    if (srcOffset + byteSize > binData.length)
      throw new Error('BufferView out of range')

    const data = binData.subarray(srcOffset, srcOffset + byteSize)
    newBinChunks.push(data)

    // Create new bufferView
    acc.bufferView = i // reuse accessor index as bufferView index

    binOffset += data.length
  }

  // Pad BIN
  const binPad = (4 - (binOffset % 4)) % 4
  if (binPad)
    newBinChunks.push(Buffer.alloc(binPad, 0))

  const newBin = Buffer.concat(newBinChunks)

  // Create new bufferViews (one per accessor)
  const newBufferViews = []
  let bvByteOffset = 0
  for (let i = 0; i < newAccessors.length; i++) {
    newBufferViews.push({
      buffer: 0,
      byteOffset: bvByteOffset,
      byteLength: accessorByteSize(newAccessors[i]),
    })
    newAccessors[i].bufferView = i
    newAccessors[i].byteOffset = 0
    bvByteOffset += accessorByteSize(newAccessors[i])
  }

  // Remap sampler input/output indices
  if (json.animations) {
    for (const anim of json.animations) {
      for (const s of (anim.samplers || [])) {
        if (s.input !== undefined)
          s.input = oldToNewAcc.get(s.input)
        if (s.output !== undefined)
          s.output = oldToNewAcc.get(s.output)
      }
    }
  }

  // Keep all nodes — only remove mesh/skin/camera/weights from nodes
  for (const node of json.nodes || []) {
    delete node.mesh
    delete node.skin
    delete node.camera
    delete node.weights
  }

  // Remove mesh-related top-level arrays
  delete json.meshes
  delete json.materials
  delete json.textures
  delete json.images
  delete json.samplers
  delete json.skins
  delete json.cameras

  // Update JSON
  json.accessors = newAccessors
  json.bufferViews = newBufferViews
  json.buffers = [{ byteLength: newBin.length }]

  // Build GLB
  const newJson = Buffer.from(JSON.stringify(json), 'utf-8')
  const jsonAlign = (4 - (newJson.length % 4)) % 4
  const totalLen = 12 + 8 + newJson.length + jsonAlign + 8 + newBin.length

  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546C67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLen, 8)

  const jh = Buffer.alloc(8)
  jh.writeUInt32LE(newJson.length + jsonAlign, 0)
  jh.writeUInt32LE(0x4E4F534A, 4)

  const bh = Buffer.alloc(8)
  bh.writeUInt32LE(newBin.length, 0)
  bh.writeUInt32LE(0x004E4942, 4)

  const output = Buffer.concat([
    header,
    jh,
    newJson,
    Buffer.alloc(jsonAlign, 0x20),
    bh,
    newBin,
  ])

  fs.writeFileSync(outputPath, output)

  return {
    originalSize: buf.length,
    strippedSize: output.length,
    nodes: json.nodes.length,
    accessorsAfter: newAccessors.length,
    animationChannels: json.animations?.[0]?.channels?.length || 0,
    humanBones: Object.keys(ext.humanoid.humanBones || {}).length,
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    console.log('Usage: node tools/strip-vrma-model.cjs <input.vrma> [output.vrma]')
    process.exit(1)
  }
  const inputPath = args[0]
  const outputPath = args[1] || inputPath.replace(/\.vrma$/i, '.safe-stripped.vrma')

  try {
    const stats = stripVrma(inputPath, outputPath)
    console.log('Original:', (stats.originalSize / 1024 / 1024).toFixed(1), 'MB')
    console.log('Stripped:', (stats.strippedSize / 1024).toFixed(0), 'KB')
    console.log('Nodes:', stats.nodes, '(preserved)')
    console.log('Accessors:', stats.accessorsAfter)
    console.log('Channels:', stats.animationChannels)
    console.log('HumanBones:', stats.humanBones)
    console.log('SUCCESS')
  }
  catch (e) {
    console.error('ERROR:', e.message)
    process.exit(1)
  }
}

module.exports = { stripVrma }
