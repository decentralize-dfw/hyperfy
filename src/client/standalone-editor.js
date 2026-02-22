/**
 * standalone-editor.js
 *
 * Password-protected editor overlay for the GitHub Pages standalone build.
 *
 * Activation:  Shift+A  →  password modal  →  unlocks full Hyperfy build-mode
 * Saving:      "Kaydet" button  →  GitHub token prompt  →  commits world.json + assets to the repo
 *
 * Security:
 *   - The correct password is stored only as its SHA-256 hash in the compiled bundle.
 *     The hash is injected at build time by build-pages.mjs via esbuild's `define`.
 *   - The plaintext password never appears in the deployed JS (F12 / Ctrl+U safe).
 */

import { css } from '@firebolt-dev/css'
import { useEffect, useState, useRef, useCallback } from 'react'
import { SaveIcon, XIcon, LockIcon, CheckCircleIcon, LoaderIcon } from 'lucide-react'

// ------------------------------------------------------------------
// Password verification — SHA-256 hash injected by build-pages.mjs
// __EDITOR_PW_HASH__ is replaced with the actual hash string by esbuild.
// ------------------------------------------------------------------
const _PH = typeof __EDITOR_PW_HASH__ !== 'undefined' ? __EDITOR_PW_HASH__ : ''

async function verifyPassword(input) {
  if (!_PH) return false  // no hash available (dev mode without hash injection)
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    return hex === _PH
  } catch {
    return false
  }
}

// ------------------------------------------------------------------
// Binary → base64 (handles large files safely)
// ------------------------------------------------------------------
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function textToBase64(str) {
  return bufferToBase64(new TextEncoder().encode(str).buffer)
}

// ------------------------------------------------------------------
// World serialization — captures current live positions from Three.js nodes
// ------------------------------------------------------------------
function serializeWorld(world) {
  const blueprints = world.blueprints.serialize()

  const entities = []
  world.entities.items.forEach(entity => {
    if (!entity.isApp) return
    if (entity.dead) return

    const pos = entity.root
      ? entity.root.position.toArray()
      : (entity.data.position ?? [0, 0, 0])
    const quat = entity.root
      ? entity.root.quaternion.toArray()
      : (entity.data.quaternion ?? [0, 0, 0, 1])
    const scale = entity.root
      ? entity.root.scale.toArray()
      : (entity.data.scale ?? [1, 1, 1])

    entities.push({
      id: entity.data.id,
      type: 'app',
      blueprint: entity.data.blueprint,
      position: pos,
      quaternion: quat,
      scale: scale,
      state: entity.data.state || {},
    })
  })

  return {
    version: 1,
    spawn: world.network._worldSpawn,
    defaultAvatar: 'asset://avatar.vrm',
    settings: world.settings.serialize(),
    blueprints,
    entities,
  }
}

// ------------------------------------------------------------------
// GitHub API helpers
// ------------------------------------------------------------------
async function ghGet(url, token) {
  const r = await fetch(`https://api.github.com${url}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
  return r
}

async function ghPut(url, token, body) {
  const r = await fetch(`https://api.github.com${url}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.message || `GitHub API ${r.status}`)
  }
  return r
}

async function getFileSha(owner, repo, branch, path, token) {
  const r = await ghGet(
    `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    token
  )
  if (r.status === 404) return undefined
  if (!r.ok) throw new Error(`Could not read ${path} from GitHub (${r.status})`)
  const data = await r.json()
  return data.sha
}

async function putFile(owner, repo, branch, path, content64, message, token) {
  const sha = await getFileSha(owner, repo, branch, path, token)
  const body = { message, content: content64, branch }
  if (sha) body.sha = sha
  await ghPut(`/repos/${owner}/${repo}/contents/${path}`, token, body)
}

// ------------------------------------------------------------------
// Full save: world.json + any locally-uploaded asset files
// ------------------------------------------------------------------
async function saveToGitHub({ world, token, onStatus }) {
  const env = window.env || {}
  const owner = env.GITHUB_OWNER
  const repo = env.GITHUB_REPO
  const branch = env.GITHUB_BRANCH

  if (!owner || !repo || !branch) {
    throw new Error(
      'GitHub repo info not found in window.env. Make sure the build injected GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH.'
    )
  }

  const pendingFiles = world.network._pendingFiles || new Map()
  const total = pendingFiles.size + 1 // +1 for world.json
  let done = 0

  // 1. Upload any locally-dropped asset files
  for (const [assetUrl, file] of pendingFiles) {
    // assetUrl: "asset://abc123.glb"
    const filename = assetUrl.replace(/^asset:\/\//, '')
    const filePath = `src/client/public/${filename}`
    onStatus(`Dosya yükleniyor (${++done}/${total}): ${filename}`)
    const buf = await file.arrayBuffer()
    await putFile(
      owner, repo, branch, filePath,
      bufferToBase64(buf),
      `editor: upload asset ${filename}`,
      token
    )
  }

  // 2. Save world.json
  onStatus(`Dünya kaydediliyor (${++done}/${total}): world.json`)
  const worldData = serializeWorld(world)
  const worldJson = JSON.stringify(worldData, null, 2)
  await putFile(
    owner, repo, branch,
    'src/client/public/world/world.json',
    textToBase64(worldJson),
    `editor: update world — ${new Date().toISOString()}`,
    token
  )

  // 3. Clear pending files (already uploaded)
  world.network._pendingFiles?.clear()

  onStatus('Kaydedildi! GitHub Actions derleme başlatıldı...')
}

// ------------------------------------------------------------------
// UI Components
// ------------------------------------------------------------------

function PasswordModal({ onSuccess, onClose }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const submit = async () => {
    if (busy || !value) return
    setBusy(true)
    setError(false)
    const ok = await verifyPassword(value)
    setBusy(false)
    if (ok) {
      onSuccess()
    } else {
      setError(true)
      setValue('')
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }

  return (
    <div
      className='pw-backdrop'
      css={css`
        position: fixed;
        inset: 0;
        z-index: 9000;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        .pw-modal {
          background: rgba(11, 10, 21, 0.95);
          border: 1px solid #2a2b39;
          border-radius: 1.25rem;
          padding: 2rem;
          width: 22rem;
          display: flex;
          flex-direction: column;
          gap: 1.2rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .pw-title {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-size: 1.1rem;
          font-weight: 600;
          color: white;
        }
        .pw-input {
          width: 100%;
          height: 2.75rem;
          padding: 0 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid ${error ? '#ef4444' : 'rgba(255,255,255,0.1)'};
          border-radius: 0.75rem;
          color: white;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.15s;
          &:focus {
            border-color: ${error ? '#ef4444' : 'rgba(255,255,255,0.35)'};
          }
        }
        .pw-error {
          font-size: 0.875rem;
          color: #ef4444;
          text-align: center;
          margin-top: -0.5rem;
        }
        .pw-btns {
          display: flex;
          gap: 0.75rem;
        }
        .pw-btn {
          flex: 1;
          height: 2.5rem;
          border-radius: 0.75rem;
          font-size: 0.9375rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          &.primary {
            background: #4f46e5;
            color: white;
            &:hover { background: #6366f1; }
            &:disabled { opacity: 0.5; cursor: not-allowed; }
          }
          &.secondary {
            background: rgba(255,255,255,0.07);
            color: rgba(255,255,255,0.7);
            &:hover { background: rgba(255,255,255,0.12); }
          }
        }
      `}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className='pw-modal'>
        <div className='pw-title'>
          <LockIcon size='1.1rem' />
          <span>Editör Erişimi</span>
        </div>
        <input
          ref={inputRef}
          className='pw-input'
          type='password'
          placeholder='Şifre girin...'
          value={value}
          onChange={e => { setValue(e.target.value); setError(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
          autoComplete='off'
        />
        {error && <div className='pw-error'>Yanlış şifre. Tekrar deneyin.</div>}
        <div className='pw-btns'>
          <button className='pw-btn primary' onClick={submit} disabled={busy || !value}>
            {busy ? <LoaderIcon size='1rem' style={{ animation: 'spin 1s linear infinite' }} /> : 'Giriş'}
          </button>
          <button className='pw-btn secondary' onClick={onClose}>İptal</button>
        </div>
      </div>
    </div>
  )
}

function SaveDialog({ world, onClose }) {
  const [token, setToken] = useState(() => {
    try { return sessionStorage.getItem('_editor_gh_token') || '' } catch { return '' }
  })
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const save = async () => {
    if (!token.trim()) return
    try { sessionStorage.setItem('_editor_gh_token', token.trim()) } catch {}
    setBusy(true)
    setStatus('Hazırlanıyor...')
    setErrorMsg(null)
    try {
      await saveToGitHub({
        world,
        token: token.trim(),
        onStatus: setStatus,
      })
      setSuccess(true)
    } catch (e) {
      setErrorMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className='sd-backdrop'
      css={css`
        position: fixed;
        inset: 0;
        z-index: 9000;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        .sd-modal {
          background: rgba(11, 10, 21, 0.97);
          border: 1px solid #2a2b39;
          border-radius: 1.25rem;
          padding: 2rem;
          width: 26rem;
          display: flex;
          flex-direction: column;
          gap: 1.2rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .sd-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 1.1rem;
          font-weight: 600;
          color: white;
          .sd-title-left {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
        }
        .sd-close {
          cursor: pointer;
          opacity: 0.6;
          &:hover { opacity: 1; }
        }
        .sd-hint {
          font-size: 0.8125rem;
          color: rgba(255,255,255,0.5);
          line-height: 1.5;
          a { color: #818cf8; text-decoration: none; &:hover { text-decoration: underline; } }
        }
        .sd-input {
          width: 100%;
          height: 2.75rem;
          padding: 0 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.75rem;
          color: white;
          font-size: 0.9375rem;
          outline: none;
          font-family: monospace;
          &:focus { border-color: rgba(255,255,255,0.3); }
        }
        .sd-status {
          font-size: 0.875rem;
          color: rgba(255,255,255,0.7);
          padding: 0.625rem 0.875rem;
          background: rgba(255,255,255,0.05);
          border-radius: 0.625rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .sd-error {
          font-size: 0.875rem;
          color: #ef4444;
          padding: 0.625rem 0.875rem;
          background: rgba(239,68,68,0.1);
          border-radius: 0.625rem;
        }
        .sd-success {
          font-size: 0.875rem;
          color: #4ade80;
          padding: 0.625rem 0.875rem;
          background: rgba(74,222,128,0.08);
          border-radius: 0.625rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .sd-btns {
          display: flex;
          gap: 0.75rem;
        }
        .sd-btn {
          flex: 1;
          height: 2.5rem;
          border-radius: 0.75rem;
          font-size: 0.9375rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          transition: all 0.15s;
          &.primary {
            background: #16a34a;
            color: white;
            &:hover { background: #15803d; }
            &:disabled { opacity: 0.5; cursor: not-allowed; }
          }
          &.secondary {
            background: rgba(255,255,255,0.07);
            color: rgba(255,255,255,0.7);
            &:hover { background: rgba(255,255,255,0.12); }
          }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className='sd-modal'>
        <div className='sd-title'>
          <div className='sd-title-left'>
            <SaveIcon size='1.1rem' />
            <span>GitHub'a Kaydet</span>
          </div>
          {!busy && <div className='sd-close' onClick={onClose}><XIcon size='1.1rem' /></div>}
        </div>

        <div className='sd-hint'>
          Dünyayı kaydetmek için bir GitHub&nbsp;
          <a href='https://github.com/settings/tokens/new?scopes=repo&description=Hyperfy+Editor' target='_blank' rel='noreferrer'>
            Personal Access Token
          </a>
          &nbsp;(PAT) gereklidir. Token yalnızca bu oturumda saklanır (sessionStorage).
        </div>

        <input
          className='sd-input'
          type='password'
          placeholder='ghp_xxxxxxxxxxxxxxxxxxxx'
          value={token}
          onChange={e => setToken(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          disabled={busy || success}
          autoComplete='off'
        />

        {status && !success && !errorMsg && (
          <div className='sd-status'>
            <LoaderIcon size='0.9rem' style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            {status}
          </div>
        )}
        {errorMsg && <div className='sd-error'>Hata: {errorMsg}</div>}
        {success && (
          <div className='sd-success'>
            <CheckCircleIcon size='0.9rem' />
            {status}
          </div>
        )}

        <div className='sd-btns'>
          {!success ? (
            <>
              <button className='sd-btn primary' onClick={save} disabled={busy || !token.trim()}>
                {busy
                  ? <><LoaderIcon size='0.9rem' style={{ animation: 'spin 1s linear infinite' }} /> Kaydediliyor...</>
                  : <><SaveIcon size='0.9rem' /> Kaydet</>
                }
              </button>
              <button className='sd-btn secondary' onClick={onClose} disabled={busy}>İptal</button>
            </>
          ) : (
            <button className='sd-btn secondary' style={{ flex: 1 }} onClick={onClose}>Kapat</button>
          )}
        </div>
      </div>
    </div>
  )
}

function SaveFab({ onClick }) {
  return (
    <div
      className='save-fab'
      onClick={onClick}
      css={css`
        position: fixed;
        bottom: calc(2rem + env(safe-area-inset-bottom));
        right: calc(2rem + env(safe-area-inset-right));
        z-index: 1000;
        pointer-events: auto;
        background: #16a34a;
        color: white;
        border-radius: 1rem;
        height: 2.75rem;
        padding: 0 1.2rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9375rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(22,163,74,0.4);
        transition: all 0.15s;
        user-select: none;
        &:hover {
          background: #15803d;
          transform: translateY(-1px);
          box-shadow: 0 6px 24px rgba(22,163,74,0.5);
        }
        &:active {
          transform: translateY(0);
        }
      `}
    >
      <SaveIcon size='1rem' />
      Kaydet
    </div>
  )
}

function EditorHint() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5000)
    return () => clearTimeout(t)
  }, [])
  if (!visible) return null
  return (
    <div
      css={css`
        position: fixed;
        bottom: calc(2rem + env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        pointer-events: none;
        background: rgba(11,10,21,0.85);
        border: 1px solid #2a2b39;
        border-radius: 1rem;
        padding: 0.6rem 1.2rem;
        font-size: 0.8125rem;
        color: rgba(255,255,255,0.7);
        backdrop-filter: blur(5px);
        animation: fadeOut 1s 4s forwards;
        @keyframes fadeOut { to { opacity: 0; } }
      `}
    >
      Editör aktif — değişiklikler için "Kaydet" butonuna bas
    </div>
  )
}

// ------------------------------------------------------------------
// Main exported component — add inside StandaloneClient render
// ------------------------------------------------------------------
export function StandaloneEditorGate({ world }) {
  const [showPwModal, setShowPwModal] = useState(false)
  const [editorUnlocked, setEditorUnlocked] = useState(false)
  const [buildMode, setBuildMode] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showHint, setShowHint] = useState(false)

  // Track build-mode changes from ClientBuilder
  useEffect(() => {
    const handler = enabled => setBuildMode(enabled)
    world.on('build-mode', handler)
    return () => world.off('build-mode', handler)
  }, [world])

  // Shift+A to open password modal / toggle editor
  useEffect(() => {
    const handleKey = e => {
      if (
        e.shiftKey &&
        e.code === 'KeyA' &&
        !e.target.matches('input, textarea, [contenteditable]')
      ) {
        e.preventDefault()
        if (editorUnlocked) {
          // already authenticated — just toggle builder
          world.builder.toggle()
        } else {
          // Release pointer lock so the user can type into the password field
          world.controls?.pointer?.unlock?.()
          setShowPwModal(true)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [world, editorUnlocked])

  const handlePasswordSuccess = useCallback(() => {
    setShowPwModal(false)
    setEditorUnlocked(true)

    // Elevate player rank to ADMIN so ClientBuilder.canBuild() returns true
    const player = world.entities.player
    if (player) {
      player.data.rank = 2 // Ranks.ADMIN
      world.emit('rank', { playerId: player.data.id })
    }

    // Enable build mode
    world.builder.toggle(true)

    setShowHint(true)
  }, [world])

  return (
    <>
      {showPwModal && (
        <PasswordModal
          onSuccess={handlePasswordSuccess}
          onClose={() => setShowPwModal(false)}
        />
      )}
      {buildMode && <SaveFab onClick={() => setShowSave(true)} />}
      {showSave && <SaveDialog world={world} onClose={() => setShowSave(false)} />}
      {showHint && buildMode && (
        <EditorHint key={Date.now()} />
      )}
    </>
  )
}
