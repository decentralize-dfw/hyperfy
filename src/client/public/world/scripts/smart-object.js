/**
 * smart-object.js
 *
 * Smart Object state machine script for Hyperfy.
 *
 * Props (configured via editor):
 *   props.states   — array of state configs (max 3):
 *     { id, name, model, audio, animName, animLoop, animWait, collider, visible, color }
 *   props.currentState — current state index (0-based)
 *
 * Clicking the object cycles through states.
 */

const states = app.props.states || []
let current = app.props.currentState || 0
let clickCooldown = false

// ── Representation box (shows if no model is set) ──────────────────
let box = null
if (states.length > 0) {
  const stateColor = states[current]?.color || '#4f46e5'
  box = app.create('prim', {
    type: 'box',
    scale: [1, 1, 1],
    position: [0, 0.5, 0],
    color: stateColor,
    emissive: stateColor,
    emissiveIntensity: 0.4,
    physics: 'static',
  })
  app.add(box)
}

// ── Label text above box ───────────────────────────────────────────
let label = null
if (states.length > 0) {
  label = app.create('prim', {
    type: 'box',
    scale: [0.05, 0.05, 0.05],
    position: [0, 0, 0],
  })
  // Label via title prim not available in all builds, skip for now
}

// ── Apply a state ──────────────────────────────────────────────────
function applyState(idx) {
  if (idx < 0 || idx >= states.length) return
  const state = states[idx]
  current = idx

  // Update box color/visibility
  if (box) {
    const c = state.color || '#4f46e5'
    box.color = c
    box.emissive = c
    box.emissiveIntensity = state.visible ? 0.4 : 0
    box.visible = state.visible !== false
    // Collider
    if (state.collider === false) {
      box.physics = null
    } else {
      box.physics = 'static'
    }
  }
}

// ── Click to cycle ─────────────────────────────────────────────────
if (box) {
  box.onPointerDown = () => {
    if (clickCooldown) return
    clickCooldown = true
    setTimeout(() => { clickCooldown = false }, 300)

    const next = (current + 1) % Math.max(states.length, 1)
    applyState(next)
  }

  // Hover hint
  box.onPointerEnter = () => {
    if (box) box.emissiveIntensity = 1.2
  }
  box.onPointerLeave = () => {
    if (box) box.emissiveIntensity = 0.4
  }
}

// ── Init with current state ────────────────────────────────────────
applyState(current)

console.log(`[smart-object] Loaded with ${states.length} states, current: ${current}`)
