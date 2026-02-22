import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'

import { createStandaloneWorld } from '../core/createStandaloneWorld'
import { CoreUI } from './components/CoreUI'
import { StandaloneEditorGate } from './standalone-editor'

export { System } from '../core/systems/System'

/**
 * StandaloneClient — a self-contained 3D world component that loads world data
 * from a static JSON file. No WebSocket server required.
 *
 * Drop into any static web host (GitHub Pages, Netlify, S3, …) and it just works.
 *
 * Editor: Press Shift+A to open the password-protected editor overlay.
 */
export function StandaloneClient({ onSetup }) {
  const viewportRef = useRef()
  const cssLayerRef = useRef()
  const uiRef = useRef()
  const world = useMemo(() => createStandaloneWorld(), [])
  const [ui, setUI] = useState(world.ui.state)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    world.on('ui', setUI)
    world.on('ready', setReady)
    return () => {
      world.off('ui', setUI)
      world.off('ready', setReady)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const viewport = viewportRef.current
      const cssLayer = cssLayerRef.current
      const ui = uiRef.current

      // Compute the base path so assets resolve correctly whether the app is
      // deployed at the domain root (https://example.com/) or a sub-path
      // (https://user.github.io/repo-name/).
      const pathname = window.location.pathname
      const basePath = pathname.endsWith('/')
        ? pathname
        : pathname.substring(0, pathname.lastIndexOf('/') + 1)

      const baseEnvironment = {
        model: basePath + 'base-environment.glb',
        bg: null,
        hdr: basePath + 'Clear_08_4pm_LDR.hdr',
        rotationY: 0,
        sunDirection: new THREE.Vector3(-1, -2, -2).normalize(),
        sunIntensity: 1,
        sunColor: 0xffffff,
        fogNear: null,
        fogFar: null,
        fogColor: null,
      }
      const config = { viewport, cssLayer, ui, baseEnvironment }
      onSetup?.(world, config)
      world.init(config)
    }
    init()
  }, [])

  return (
    <div
      className='App'
      css={css`
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100vh;
        height: 100dvh;
        .App__viewport {
          position: absolute;
          inset: 0;
        }
        .App__cssLayer {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
        }
        .App__ui {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          user-select: none;
          display: ${ui.visible ? 'block' : 'none'};
        }
      `}
    >
      <div className='App__viewport' ref={viewportRef}>
        <div className='App__cssLayer' ref={cssLayerRef} />
        <div className='App__ui' ref={uiRef}>
          <CoreUI world={world} />
        </div>
      </div>
      {/* Editor gate renders outside the UI layer so it always sits on top */}
      <StandaloneEditorGate world={world} />
    </div>
  )
}
