// Ground Plane — large static physics-enabled floor at y=0
// Uses Hyperfy prim API: physics:'static' gives it a collider so players don't fall through.
const ground = app.create('prim', {
  type: 'box',
  size: [200, 0.2, 200],
  position: [0, -0.1, 0],
  color: '#999988',
  roughness: 0.95,
  metalness: 0,
  physics: 'static',
})
app.add(ground)
