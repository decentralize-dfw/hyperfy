import { emoteUrls } from '../extras/playerEmotes'
import { System } from './System'
import { uuid } from '../utils'
import { hashFile } from '../utils-client'

/**
 * Local Network System
 *
 * - Runs on the client in standalone/offline mode (e.g. GitHub Pages)
 * - Loads world data from a static JSON file instead of a WebSocket server
 * - Provides the same interface as ClientNetwork so all other systems work unchanged
 *
 */
export class LocalNetwork extends System {
  constructor(world) {
    super(world)
    this.id = uuid()
    this.isClient = true
    this.isServer = false
    this.apiUrl = null
    this.maxUploadSize = 100  // MB — allow up to 100 MB uploads locally
    this.serverTimeOffset = 0
    this.queue = []

    // Track files dropped/uploaded by the editor so we can push them to GitHub on save
    // Map<assetUrl, File>  e.g.  "asset://abc.glb" => <File>
    this._pendingFiles = new Map()

    // Remember spawn so the save function can include it
    this._worldSpawn = { position: [0, 2, 8], quaternion: [0, 0, 0, 1] }
  }

  async init(options) {
    // Derive assets base URL from the current page location
    // asset://avatar.vrm -> <pageBase>/avatar.vrm
    const pageBase = window.location.href.replace(/\/[^\/]*(\?.*)?$/, '')
    this.world.assetsUrl = options.assetsUrl || pageBase

    // Load static world data JSON
    const worldDataUrl = options.worldDataUrl || (pageBase + '/world/world.json')
    let worldData
    try {
      const resp = await fetch(worldDataUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      worldData = await resp.json()
    } catch (e) {
      console.warn('[LocalNetwork] Could not load world.json, using empty world:', e.message)
      worldData = {
        settings: {},
        blueprints: [],
        entities: [],
        collections: [],
        chat: [],
        ai: { enabled: false, provider: null, model: null, effort: null },
      }
    }

    // Store spawn for later serialisation by the editor
    if (worldData.spawn) {
      this._worldSpawn = worldData.spawn
    }

    // Preload avatar from settings
    if (worldData.settings?.avatar?.url) {
      this.world.loader.preload('avatar', worldData.settings.avatar.url)
    }

    // Preload blueprint assets
    for (const item of worldData.blueprints || []) {
      if (!item.disabled) {
        if (item.model) {
          const type = item.model.endsWith('.vrm') ? 'avatar' : 'model'
          this.world.loader.preload(type, item.model)
        }
        if (item.script) {
          this.world.loader.preload('script', item.script)
        }
      }
    }

    // Preload player animation emotes
    for (const url of emoteUrls) {
      this.world.loader.preload('emote', url)
    }

    // Preload default player avatar
    const defaultAvatar = worldData.defaultAvatar || 'asset://avatar.vrm'
    this.world.loader.preload('avatar', defaultAvatar)

    this.world.loader.execPreload()

    // Initialize world systems with static snapshot data
    this.world.collections.deserialize(worldData.collections || [])
    this.world.settings.deserialize({
      title: 'Hyperfy World',
      desc: 'An interactive 3D virtual world built with Hyperfy',
      image: null,
      avatar: null,
      customAvatars: true,
      voice: false,
      rank: 0,
      playerLimit: null,
      ao: true,
      ...worldData.settings,
      rank: 0,               // always 0 so effectiveRank=0 when hasAdminCode=true
    })
    // With hasAdminCode=true and rank=0, effectiveRank=0 for everyone.
    // Players start as VISITOR; the editor overlay elevates rank after password verification.
    this.world.settings.setHasAdminCode(true)
    this.world.chat.deserialize(worldData.chat || [])
    this.world.ai.deserialize(
      worldData.ai || { enabled: false, provider: null, model: null, effort: null }
    )
    this.world.blueprints.deserialize(worldData.blueprints || [])
    this.world.entities.deserialize(worldData.entities || [])

    // Add local player entity — rank 0 (VISITOR) until password unlocks it
    const spawn = worldData.spawn || { position: [0, 2, 8], quaternion: [0, 0, 0, 1] }
    const playerEntity = {
      id: uuid(),
      type: 'player',
      owner: this.id,
      position: spawn.position,
      quaternion: spawn.quaternion,
      scale: [1, 1, 1],
      health: 100,
      effects: [],
      sessionAvatar: null,
      avatar: defaultAvatar,
      name: 'Player',
      rank: 0,      // numeric VISITOR — isBuilder() returns false until elevated by password gate
      roles: [],
      emote: null,
      moving: false,
    }
    this.world.entities.add(playerEntity, false)
  }

  // No-ops: standalone mode has no server to communicate with
  send(name, data) {}

  /**
   * upload(file) — called by ClientBuilder when a file is drag-dropped.
   *
   * In standalone mode we cannot push the file to a server immediately.
   * Instead we:
   *   1. Compute a deterministic hash-based asset:// URL (same logic as ClientBuilder.addModel)
   *   2. Store the File in _pendingFiles so the editor can later upload it to GitHub
   *
   * ClientBuilder already called world.loader.insert(type, url, file) before calling upload(),
   * so the asset is already available locally for rendering.
   */
  async upload(file) {
    try {
      const hash = await hashFile(file)
      const ext = file.name.split('.').pop().toLowerCase()
      const url = `asset://${hash}.${ext}`
      this._pendingFiles.set(url, file)
    } catch (e) {
      console.warn('[LocalNetwork] Could not track upload file for later GitHub push:', e)
    }
  }

  getTime() {
    return (performance.now() + this.serverTimeOffset) / 1000
  }

  enqueue(method, data) {}

  destroy() {}
}
