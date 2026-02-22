/**
 * Hyperfy Demo World
 *
 * A full showcase of Hyperfy's 3D capabilities:
 *  - Walkable terrain with physics
 *  - Primitive shapes with materials
 *  - Animated objects
 *  - Physics-enabled props
 *  - Structural architecture (towers, arches)
 *  - Interactive hover effects
 */

// ─── GROUND PLATFORM ────────────────────────────────────────────────────────

const ground = app.create('prim', {
  type: 'box',
  scale: [80, 0.4, 80],
  position: [0, -0.2, 0],
  color: '#1a1a2e',
  metalness: 0.0,
  roughness: 0.9,
  physics: 'static',
})
app.add(ground)

// Grid pattern on ground - lighter tiles
for (let x = -3; x <= 3; x++) {
  for (let z = -3; z <= 3; z++) {
    if ((x + z) % 2 === 0) {
      const tile = app.create('prim', {
        type: 'box',
        scale: [4.9, 0.05, 4.9],
        position: [x * 5, 0.025, z * 5],
        color: '#16213e',
        metalness: 0.1,
        roughness: 0.8,
        physics: 'static',
      })
      app.add(tile)
    }
  }
}

// Glowing edge border
const borderN = app.create('prim', {
  type: 'box',
  scale: [80, 0.1, 0.5],
  position: [0, 0.25, -40],
  color: '#0f3460',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(borderN)

const borderS = app.create('prim', {
  type: 'box',
  scale: [80, 0.1, 0.5],
  position: [0, 0.25, 40],
  color: '#0f3460',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(borderS)

const borderW = app.create('prim', {
  type: 'box',
  scale: [0.5, 0.1, 80],
  position: [-40, 0.25, 0],
  color: '#0f3460',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(borderW)

const borderE = app.create('prim', {
  type: 'box',
  scale: [0.5, 0.1, 80],
  position: [40, 0.25, 0],
  color: '#0f3460',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(borderE)

// ─── CENTRAL SHOWCASE PLATFORM ──────────────────────────────────────────────

const centerPlatform = app.create('prim', {
  type: 'cylinder',
  scale: [8, 0.3, 8],
  position: [0, 0.15, 0],
  color: '#0f3460',
  metalness: 0.6,
  roughness: 0.3,
  physics: 'static',
})
app.add(centerPlatform)

const centerRing = app.create('prim', {
  type: 'torus',
  scale: [4.5, 4.5, 4.5],
  position: [0, 0.35, 0],
  color: '#00d4ff',
  emissive: '#00d4ff',
  emissiveIntensity: 1.5,
  metalness: 0.8,
  roughness: 0.2,
})
app.add(centerRing)

// ─── ORBITING SHOWCASE SPHERES ───────────────────────────────────────────────

const orbitColors = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#a29bfe', '#fd79a8']
const orbitSpheres = []
const orbitRadius = 5

for (let i = 0; i < 6; i++) {
  const sphere = app.create('prim', {
    type: 'sphere',
    scale: [0.6, 0.6, 0.6],
    position: [0, 1.5, 0],
    color: orbitColors[i],
    emissive: orbitColors[i],
    emissiveIntensity: 0.5,
    metalness: 0.7,
    roughness: 0.2,
  })
  app.add(sphere)
  orbitSpheres.push(sphere)
}

// ─── PRIMITIVE SHOWCASE (ring of shapes) ─────────────────────────────────────

const showcaseItems = [
  { type: 'box',      color: '#ff4757', label: 'BOX',      scale: [1.2, 1.2, 1.2] },
  { type: 'sphere',   color: '#1e90ff', label: 'SPHERE',   scale: [0.7, 0.7, 0.7] },
  { type: 'cylinder', color: '#2ed573', label: 'CYLINDER', scale: [0.6, 1.5, 0.6] },
  { type: 'cone',     color: '#ffa502', label: 'CONE',     scale: [0.7, 1.5, 0.7] },
  { type: 'torus',    color: '#a29bfe', label: 'TORUS',    scale: [0.8, 0.8, 0.8] },
  { type: 'plane',    color: '#fd79a8', label: 'PLANE',    scale: [1.5, 1.5, 1],   extra: { doubleside: true } },
]

const showcaseRadius = 14
const showcaseShapes = []

showcaseItems.forEach((item, i) => {
  const angle = (i / showcaseItems.length) * Math.PI * 2
  const x = Math.sin(angle) * showcaseRadius
  const z = Math.cos(angle) * showcaseRadius

  // Pedestal
  const pedestal = app.create('prim', {
    type: 'cylinder',
    scale: [1.5, 1.2, 1.5],
    position: [x, 0.6, z],
    color: '#0f3460',
    metalness: 0.5,
    roughness: 0.5,
    physics: 'static',
  })
  app.add(pedestal)

  // Top cap
  const cap = app.create('prim', {
    type: 'cylinder',
    scale: [1.6, 0.1, 1.6],
    position: [x, 1.25, z],
    color: item.color,
    emissive: item.color,
    emissiveIntensity: 0.3,
    physics: 'static',
  })
  app.add(cap)

  // Shape
  const shape = app.create('prim', {
    type: item.type,
    scale: item.scale,
    position: [x, 2.5, z],
    color: item.color,
    metalness: 0.4,
    roughness: 0.5,
    ...(item.extra || {}),
  })
  app.add(shape)
  showcaseShapes.push(shape)

  // Hover effect
  shape.onPointerEnter = () => {
    shape.emissive = item.color
    shape.emissiveIntensity = 1.5
  }
  shape.onPointerLeave = () => {
    shape.emissive = null
    shape.emissiveIntensity = 0
  }
})

// ─── TOWERS ──────────────────────────────────────────────────────────────────

const towerPositions = [
  [-20, 0, -20],
  [20, 0, -20],
  [-20, 0, 20],
  [20, 0, 20],
]

const towerColors = ['#ff4757', '#2ed573', '#1e90ff', '#a29bfe']

towerPositions.forEach(([x, y, z], i) => {
  const color = towerColors[i]

  // Base
  const base = app.create('prim', {
    type: 'box',
    scale: [4, 0.4, 4],
    position: [x, 0.2, z],
    color: '#0f3460',
    metalness: 0.3,
    roughness: 0.7,
    physics: 'static',
  })
  app.add(base)

  // Tower body
  const tower = app.create('prim', {
    type: 'box',
    scale: [2, 12, 2],
    position: [x, 6.2, z],
    color: '#16213e',
    metalness: 0.4,
    roughness: 0.6,
    physics: 'static',
  })
  app.add(tower)

  // Glowing stripe
  const stripe = app.create('prim', {
    type: 'box',
    scale: [2.1, 0.3, 2.1],
    position: [x, 8, z],
    color: color,
    emissive: color,
    emissiveIntensity: 2,
  })
  app.add(stripe)

  // Top cap
  const top = app.create('prim', {
    type: 'cone',
    scale: [1.5, 3, 1.5],
    position: [x, 13.7, z],
    color: color,
    emissive: color,
    emissiveIntensity: 1,
    metalness: 0.8,
    roughness: 0.2,
  })
  app.add(top)

  // Beacon orb
  const beacon = app.create('prim', {
    type: 'sphere',
    scale: [0.4, 0.4, 0.4],
    position: [x, 15.5, z],
    color: color,
    emissive: color,
    emissiveIntensity: 3,
  })
  app.add(beacon)
})

// ─── ARCHES ──────────────────────────────────────────────────────────────────

function createArch(cx, cz, rotY) {
  const archColor = '#0f3460'
  const glowColor = '#00d4ff'

  // Left pillar
  const pillarL = app.create('prim', {
    type: 'box',
    scale: [1, 6, 1],
    position: [-2.5, 3, 0],
    color: archColor,
    metalness: 0.5,
    roughness: 0.5,
    physics: 'static',
  })

  // Right pillar
  const pillarR = app.create('prim', {
    type: 'box',
    scale: [1, 6, 1],
    position: [2.5, 3, 0],
    color: archColor,
    metalness: 0.5,
    roughness: 0.5,
    physics: 'static',
  })

  // Top beam
  const beam = app.create('prim', {
    type: 'box',
    scale: [6, 1, 1],
    position: [0, 6.5, 0],
    color: archColor,
    metalness: 0.5,
    roughness: 0.5,
    physics: 'static',
  })

  // Glow strip
  const glow = app.create('prim', {
    type: 'box',
    scale: [5.8, 0.15, 0.15],
    position: [0, 6.5, 0.5],
    color: glowColor,
    emissive: glowColor,
    emissiveIntensity: 2,
  })

  const archGroup = app.create('group')
  archGroup.position.set(cx, 0, cz)
  archGroup.rotation.y = rotY
  archGroup.add(pillarL)
  archGroup.add(pillarR)
  archGroup.add(beam)
  archGroup.add(glow)
  app.add(archGroup)
}

createArch(0, -10, 0)
createArch(0, 10, 0)
createArch(-10, 0, Math.PI / 2)
createArch(10, 0, Math.PI / 2)

// ─── PHYSICS ARENA ───────────────────────────────────────────────────────────

// Arena walls (invisible physics barriers)
const arenaWalls = [
  { position: [0, 1.5, -8],  scale: [12, 3, 0.3] },
  { position: [0, 1.5, 8],   scale: [12, 3, 0.3] },
  { position: [-6, 1.5, 0],  scale: [0.3, 3, 16] },
  { position: [6, 1.5, 0],   scale: [0.3, 3, 16] },
]

arenaWalls.forEach(w => {
  const wall = app.create('prim', {
    type: 'box',
    scale: w.scale,
    position: w.position,
    color: '#00d4ff',
    emissive: '#00d4ff',
    emissiveIntensity: 0.3,
    opacity: 0.15,
    physics: 'static',
  })
  app.add(wall)
})

// Physics balls - stacked at arena spawn area
const ballColors = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#a29bfe', '#fd79a8', '#ffffff', '#ffdd59']
const physicsBalls = []

for (let i = 0; i < 8; i++) {
  const offsetX = ((i % 4) - 1.5) * 1.8
  const offsetZ = Math.floor(i / 4) * 2 - 1
  const ball = app.create('prim', {
    type: 'sphere',
    scale: [0.7, 0.7, 0.7],
    position: [offsetX, 4 + i * 0.5, -4 + offsetZ],
    color: ballColors[i],
    emissive: ballColors[i],
    emissiveIntensity: 0.3,
    metalness: 0.8,
    roughness: 0.2,
    physics: 'dynamic',
  })
  app.add(ball)
  physicsBalls.push(ball)
}

// ─── FLOATING CRYSTALS ───────────────────────────────────────────────────────

const crystalData = [
  { pos: [-28, 4, -15], color: '#ff4757', scale: [0.8, 2.5, 0.8] },
  { pos: [28, 6, -12],  color: '#2ed573', scale: [0.6, 2.0, 0.6] },
  { pos: [-25, 5, 18],  color: '#1e90ff', scale: [1.0, 3.0, 1.0] },
  { pos: [26, 3, 20],   color: '#a29bfe', scale: [0.7, 2.2, 0.7] },
  { pos: [0, 8, -30],   color: '#ffa502', scale: [1.2, 3.5, 1.2] },
  { pos: [-30, 7, 0],   color: '#fd79a8', scale: [0.9, 2.8, 0.9] },
  { pos: [32, 5, 5],    color: '#00d4ff', scale: [0.8, 2.4, 0.8] },
]

const crystals = []

crystalData.forEach(({ pos, color, scale }) => {
  const crystal = app.create('prim', {
    type: 'cone',
    scale,
    position: pos,
    color,
    emissive: color,
    emissiveIntensity: 1.2,
    metalness: 0.9,
    roughness: 0.1,
    opacity: 0.85,
  })
  app.add(crystal)

  // Reflection (inverted cone beneath)
  const reflection = app.create('prim', {
    type: 'cone',
    scale: [scale[0], scale[1] * 0.6, scale[2]],
    position: [pos[0], pos[1] - scale[1] * 0.8, pos[2]],
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    metalness: 0.9,
    roughness: 0.1,
    opacity: 0.4,
  })
  app.add(reflection)

  crystals.push({ crystal, reflection, baseY: pos[1], phase: Math.random() * Math.PI * 2 })
})

// ─── STAIRCASE ───────────────────────────────────────────────────────────────

for (let i = 0; i < 10; i++) {
  const step = app.create('prim', {
    type: 'box',
    scale: [4, 0.3, 1.2],
    position: [-22, i * 0.35 + 0.15, -18 + i * 1.2],
    color: '#16213e',
    metalness: 0.3,
    roughness: 0.7,
    physics: 'static',
  })
  app.add(step)

  // Railing
  const rail = app.create('prim', {
    type: 'box',
    scale: [4.2, 0.08, 0.08],
    position: [-22, i * 0.35 + 0.8, -18 + i * 1.2 + 0.5],
    color: '#00d4ff',
    emissive: '#00d4ff',
    emissiveIntensity: 1,
  })
  app.add(rail)
}

// Upper platform at top of stairs
const upperPlatform = app.create('prim', {
  type: 'box',
  scale: [8, 0.4, 8],
  position: [-22, 3.7, -6],
  color: '#0f3460',
  metalness: 0.4,
  roughness: 0.5,
  physics: 'static',
})
app.add(upperPlatform)

// ─── SPINNING RINGS ───────────────────────────────────────────────────────────

const spinnerPositions = [
  { x: -22, y: 6, z: -6 },
  { x: 22, y: 5, z: 0 },
]

const spinners = []
spinnerPositions.forEach(({ x, y, z }, idx) => {
  const ringA = app.create('prim', {
    type: 'torus',
    scale: [2, 2, 2],
    position: [x, y, z],
    color: '#00d4ff',
    emissive: '#00d4ff',
    emissiveIntensity: 1.5,
    metalness: 0.9,
    roughness: 0.1,
  })
  app.add(ringA)

  const ringB = app.create('prim', {
    type: 'torus',
    scale: [1.5, 1.5, 1.5],
    position: [x, y, z],
    color: '#a29bfe',
    emissive: '#a29bfe',
    emissiveIntensity: 1.5,
    metalness: 0.9,
    roughness: 0.1,
  })
  app.add(ringB)

  spinners.push({ ringA, ringB, phase: idx * Math.PI })
})

// ─── FLOATING LOGO PLATFORM ─────────────────────────────────────────────────

const logoPlatform = app.create('prim', {
  type: 'box',
  scale: [10, 0.3, 5],
  position: [0, 8, 0],
  color: '#0f3460',
  emissive: '#00d4ff',
  emissiveIntensity: 0.2,
  metalness: 0.6,
  roughness: 0.3,
  physics: 'static',
})
app.add(logoPlatform)

// H letters (simplified box arrangement)
const hLeft = app.create('prim', {
  type: 'box',
  scale: [0.4, 2.5, 0.4],
  position: [-1.5, 9.55, 0],
  color: '#00d4ff',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(hLeft)

const hRight = app.create('prim', {
  type: 'box',
  scale: [0.4, 2.5, 0.4],
  position: [-0.3, 9.55, 0],
  color: '#00d4ff',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(hRight)

const hCross = app.create('prim', {
  type: 'box',
  scale: [1.6, 0.4, 0.4],
  position: [-0.9, 9.55, 0],
  color: '#00d4ff',
  emissive: '#00d4ff',
  emissiveIntensity: 2,
})
app.add(hCross)

// Support column for floating platform
const supportCol = app.create('prim', {
  type: 'cylinder',
  scale: [0.3, 8, 0.3],
  position: [0, 4, 0],
  color: '#00d4ff',
  emissive: '#00d4ff',
  emissiveIntensity: 1,
})
app.add(supportCol)

// ─── AMBIENT LIGHT PILLARS ────────────────────────────────────────────────────

const lightPillarData = [
  { pos: [-35, 0, -35], color: '#ff4757' },
  { pos: [35, 0, -35],  color: '#2ed573' },
  { pos: [-35, 0, 35],  color: '#1e90ff' },
  { pos: [35, 0, 35],   color: '#a29bfe' },
]

lightPillarData.forEach(({ pos, color }) => {
  const pillar = app.create('prim', {
    type: 'cylinder',
    scale: [0.3, 20, 0.3],
    position: [pos[0], 10, pos[2]],
    color,
    emissive: color,
    emissiveIntensity: 1.5,
    opacity: 0.7,
  })
  app.add(pillar)

  const base = app.create('prim', {
    type: 'cylinder',
    scale: [1.5, 0.3, 1.5],
    position: [pos[0], 0.15, pos[2]],
    color,
    emissive: color,
    emissiveIntensity: 1,
    physics: 'static',
  })
  app.add(base)
})

// ─── ANIMATION LOOP ──────────────────────────────────────────────────────────

let time = 0

app.on('update', dt => {
  time += dt

  // Orbit spheres around center
  orbitSpheres.forEach((sphere, i) => {
    const angle = time * 0.6 + (i / orbitSpheres.length) * Math.PI * 2
    sphere.position.x = Math.sin(angle) * orbitRadius
    sphere.position.z = Math.cos(angle) * orbitRadius
    sphere.position.y = 1.5 + Math.sin(time * 2 + i) * 0.3
  })

  // Rotate showcase shapes
  showcaseShapes.forEach((shape, i) => {
    shape.rotation.y += (0.5 + i * 0.1) * dt
    if (i % 2 === 0) shape.rotation.x += 0.3 * dt
  })

  // Pulse center ring
  const ringPulse = 1 + Math.sin(time * 2) * 0.05
  centerRing.scale.set(4.5 * ringPulse, 4.5 * ringPulse, 4.5 * ringPulse)
  centerRing.emissiveIntensity = 1.0 + Math.sin(time * 3) * 0.5

  // Float crystals
  crystals.forEach(({ crystal, reflection, baseY, phase }) => {
    const floatY = baseY + Math.sin(time * 0.8 + phase) * 0.4
    crystal.position.y = floatY
    reflection.position.y = floatY - crystal.scale.y * 0.8
    crystal.rotation.y += 0.4 * dt
    reflection.rotation.y -= 0.3 * dt
  })

  // Spin rings
  spinners.forEach(({ ringA, ringB, phase }, i) => {
    ringA.rotation.y = time * (1.0 + i * 0.3)
    ringA.rotation.x = time * 0.7
    ringB.rotation.z = time * 1.4
    ringB.rotation.y = -time * 0.9
  })

  // Pulse tower beacons
  towerPositions.forEach((pos, i) => {
    // beacons are updated by emissiveIntensity pulse via property access
    // (they are separate objects - just animate if needed via global time)
  })

  // Floating logo platform bob
  logoPlatform.position.y = 8 + Math.sin(time * 0.5) * 0.2
  hLeft.position.y = 9.55 + Math.sin(time * 0.5) * 0.2
  hRight.position.y = 9.55 + Math.sin(time * 0.5) * 0.2
  hCross.position.y = 9.55 + Math.sin(time * 0.5) * 0.2
})

console.log('[demo-world] Hyperfy 3D World loaded!')
console.log('[demo-world] Walk around using WASD or arrow keys, click to look')
