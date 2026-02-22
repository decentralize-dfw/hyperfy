import { emoteUrls } from '../extras/playerEmotes'
import { Ranks } from '../extras/ranks'
import { System } from './System'
import { uuid } from '../utils'

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
    this.maxUploadSize = 0
    this.serverTimeOffset = 0
    this.queue = []
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
      customAvatars: null,
      voice: false,
      playerLimit: null,
      ao: true,
      ...worldData.settings,
      // Always set rank to ADMIN in standalone mode so every visitor can build
      rank: Ranks.ADMIN,
    })
    // No admin code in standalone mode → effectiveRank = Ranks.ADMIN for everyone
    this.world.settings.setHasAdminCode(false)
    this.world.chat.deserialize(worldData.chat || [])
    this.world.ai.deserialize(
      worldData.ai || { enabled: false, provider: null, model: null, effort: null }
    )
    this.world.blueprints.deserialize(worldData.blueprints || [])
    this.world.entities.deserialize(worldData.entities || [])

    // Add local player entity with spawn position from world data
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
      rank: Ranks.ADMIN,
      roles: [],
      emote: null,
      moving: false,
    }
    this.world.entities.add(playerEntity, false)
  }

  // No-ops: standalone mode has no server to communicate with
  send(name, data) {}

  async upload(file) {
    console.warn('[LocalNetwork] File upload not supported in standalone mode')
  }

  getTime() {
    return (performance.now() + this.serverTimeOffset) / 1000
  }

  enqueue(method, data) {}

  destroy() {}
}
