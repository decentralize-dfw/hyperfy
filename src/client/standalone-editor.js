/**
 * standalone-editor.js
 *
 * Password-protected editor overlay for the GitHub Pages standalone build.
 *
 * Activation:  Shift+A  →  password modal  →  unlocks full Hyperfy build-mode
 * Saving:      "Kaydet" button  →  (uses stored GitHub PAT, no dialog if already configured)
 *
 * Security:
 *   - The correct password is stored only as its SHA-256 hash in the compiled bundle.
 *     The hash is injected at build time by build-pages.mjs via esbuild's `define`.
 *   - The plaintext password never appears in the deployed JS (F12 / Ctrl+U safe).
 *   - GitHub PAT is stored in localStorage (browser only, not sent to any server).
 */

import { css } from '@firebolt-dev/css'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  SaveIcon, XIcon, LockIcon, CheckCircleIcon, LoaderIcon,
  BoxIcon, SettingsIcon, ChevronDownIcon, ChevronRightIcon,
  Plus, Minus, Trash2Icon, CopyIcon, KeyIcon, VolumeIcon,
  PlayIcon, RepeatIcon, RotateCcwIcon, EyeIcon, EyeOffIcon,
} from 'lucide-react'

// ------------------------------------------------------------------
// Password verification — SHA-256 hash injected by build-pages.mjs
// __EDITOR_PW_HASH__ is replaced with the actual hash string by esbuild.
// ------------------------------------------------------------------
const _PH = typeof __EDITOR_PW_HASH__ !== 'undefined' ? __EDITOR_PW_HASH__ : ''

async function verifyPassword(input) {
  if (!_PH) return false
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
// Binary → base64
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
// World serialization
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
// Save to GitHub
// ------------------------------------------------------------------
async function saveToGitHub({ world, token, onStatus }) {
  const env = window.env || {}
  const owner = env.GITHUB_OWNER
  const repo = env.GITHUB_REPO
  const branch = env.GITHUB_BRANCH

  if (!owner || !repo || !branch) {
    throw new Error(
      'GitHub repo bilgisi bulunamadı (window.env). Build\'de GITHUB_OWNER/GITHUB_REPO/GITHUB_BRANCH inject edilmeli.'
    )
  }

  const pendingFiles = world.network._pendingFiles || new Map()
  const total = pendingFiles.size + 1
  let done = 0

  for (const [assetUrl, file] of pendingFiles) {
    const filename = assetUrl.replace(/^asset:\/\//, '')
    const filePath = `src/client/public/${filename}`
    onStatus(`Dosya yükleniyor (${++done}/${total}): ${filename}`)
    const buf = await file.arrayBuffer()
    await putFile(owner, repo, branch, filePath, bufferToBase64(buf), `editor: upload asset ${filename}`, token)
  }

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

  world.network._pendingFiles?.clear()
  onStatus('Kaydedildi! GitHub Actions yeniden derleme başlatıldı...')
}

// ------------------------------------------------------------------
// PAT storage helpers (localStorage — browser only, never sent anywhere)
// ------------------------------------------------------------------
const PAT_KEY = '_editor_gh_pat'

function getStoredPAT() {
  try { return localStorage.getItem(PAT_KEY) || '' } catch { return '' }
}

function storePAT(token) {
  try { localStorage.setItem(PAT_KEY, token) } catch {}
}

function clearPAT() {
  try { localStorage.removeItem(PAT_KEY) } catch {}
}

// ------------------------------------------------------------------
// UUID helper
// ------------------------------------------------------------------
function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ------------------------------------------------------------------
// PasswordModal
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
          &:focus { border-color: ${error ? '#ef4444' : 'rgba(255,255,255,0.35)'}; }
        }
        .pw-error { font-size: 0.875rem; color: #ef4444; text-align: center; margin-top: -0.5rem; }
        .pw-btns { display: flex; gap: 0.75rem; }
        .pw-btn {
          flex: 1; height: 2.5rem; border-radius: 0.75rem; font-size: 0.9375rem;
          font-weight: 500; cursor: pointer; display: flex; align-items: center;
          justify-content: center; transition: all 0.15s;
          &.primary {
            background: #4f46e5; color: white;
            &:hover { background: #6366f1; }
            &:disabled { opacity: 0.5; cursor: not-allowed; }
          }
          &.secondary {
            background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.7);
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
        {error && <div className='pw-error'>Yanlış şifre.</div>}
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

// ------------------------------------------------------------------
// SaveDialog — only shown if no PAT stored or user wants to change it
// ------------------------------------------------------------------
function SaveDialog({ world, onClose, initialToken = '' }) {
  const [token, setToken] = useState(initialToken || getStoredPAT())
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const save = async () => {
    if (!token.trim()) return
    storePAT(token.trim())
    setBusy(true)
    setStatus('Hazırlanıyor...')
    setErrorMsg(null)
    try {
      await saveToGitHub({ world, token: token.trim(), onStatus: setStatus })
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
        position: fixed; inset: 0; z-index: 9500;
        background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        pointer-events: auto;
        .sd-modal {
          background: rgba(11, 10, 21, 0.97); border: 1px solid #2a2b39;
          border-radius: 1.25rem; padding: 2rem; width: 26rem;
          display: flex; flex-direction: column; gap: 1.2rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .sd-title {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 1.1rem; font-weight: 600; color: white;
          .sd-title-left { display: flex; align-items: center; gap: 0.5rem; }
        }
        .sd-close { cursor: pointer; opacity: 0.6; &:hover { opacity: 1; } }
        .sd-hint {
          font-size: 0.8125rem; color: rgba(255,255,255,0.5); line-height: 1.5;
          a { color: #818cf8; text-decoration: none; &:hover { text-decoration: underline; } }
        }
        .sd-input {
          width: 100%; height: 2.75rem; padding: 0 1rem;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.75rem; color: white; font-size: 0.9375rem; outline: none;
          font-family: monospace; &:focus { border-color: rgba(255,255,255,0.3); }
        }
        .sd-status {
          font-size: 0.875rem; color: rgba(255,255,255,0.7);
          padding: 0.625rem 0.875rem; background: rgba(255,255,255,0.05);
          border-radius: 0.625rem; display: flex; align-items: center; gap: 0.5rem;
        }
        .sd-error {
          font-size: 0.875rem; color: #ef4444;
          padding: 0.625rem 0.875rem; background: rgba(239,68,68,0.1); border-radius: 0.625rem;
        }
        .sd-success {
          font-size: 0.875rem; color: #4ade80;
          padding: 0.625rem 0.875rem; background: rgba(74,222,128,0.08);
          border-radius: 0.625rem; display: flex; align-items: center; gap: 0.5rem;
        }
        .sd-btns { display: flex; gap: 0.75rem; }
        .sd-btn {
          flex: 1; height: 2.5rem; border-radius: 0.75rem; font-size: 0.9375rem;
          font-weight: 500; cursor: pointer; display: flex; align-items: center;
          justify-content: center; gap: 0.4rem; transition: all 0.15s;
          &.primary {
            background: #16a34a; color: white;
            &:hover { background: #15803d; }
            &:disabled { opacity: 0.5; cursor: not-allowed; }
          }
          &.secondary {
            background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.7);
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
          Dünyayı kaydetmek için GitHub&nbsp;
          <a href='https://github.com/settings/tokens/new?scopes=repo&description=Hyperfy+Editor' target='_blank' rel='noreferrer'>
            Personal Access Token (PAT)
          </a>
          &nbsp;gereklidir. Token tarayıcıda saklanır, bir daha sorulmaz.
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

// ------------------------------------------------------------------
// SaveFab — shows save + PAT-config buttons
// ------------------------------------------------------------------
function SaveFab({ onSave, onConfigPAT }) {
  const hasPAT = !!getStoredPAT()
  return (
    <div
      css={css`
        position: fixed;
        bottom: calc(2rem + env(safe-area-inset-bottom));
        right: calc(2rem + env(safe-area-inset-right));
        z-index: 1000;
        pointer-events: auto;
        display: flex;
        gap: 0.5rem;
        align-items: center;
        .save-fab {
          background: #16a34a; color: white; border-radius: 1rem;
          height: 2.75rem; padding: 0 1.2rem;
          display: flex; align-items: center; gap: 0.5rem;
          font-size: 0.9375rem; font-weight: 600; cursor: pointer;
          box-shadow: 0 4px 20px rgba(22,163,74,0.4);
          transition: all 0.15s; user-select: none;
          &:hover { background: #15803d; transform: translateY(-1px); box-shadow: 0 6px 24px rgba(22,163,74,0.5); }
          &:active { transform: translateY(0); }
        }
        .pat-btn {
          background: rgba(11,10,21,0.85); color: rgba(255,255,255,0.6);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.75rem; height: 2.75rem; width: 2.75rem;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
          &:hover { background: rgba(255,255,255,0.1); color: white; }
        }
      `}
    >
      <div className='pat-btn' onClick={onConfigPAT} title={hasPAT ? 'GitHub Token değiştir' : 'GitHub Token ayarla'}>
        <KeyIcon size='1rem' />
      </div>
      <div className='save-fab' onClick={onSave}>
        <SaveIcon size='1rem' />
        Kaydet
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// SmartObjectEditor — SDK-compatible 3-stage editor
// Matches the field structure from the SDK script's getStore()
// ------------------------------------------------------------------
function SmartObjectEditor({ entity, world }) {
  const blueprint = entity?.blueprint
  if (!blueprint?.props?.smartObject) return null

  const [activeStage, setActiveStage] = useState(blueprint.props.stage || 1)
  const modelRefs = [useRef(), useRef(), useRef()]
  const audioRefs = [useRef(), useRef(), useRef()]

  const p = blueprint.props

  const updateProp = (key, value) => {
    const version = blueprint.version + 1
    const newProps = { ...blueprint.props, [key]: value }
    world.blueprints.modify({ id: blueprint.id, version, props: newProps })
    world.network.send('blueprintModified', { id: blueprint.id, version, props: newProps })
  }

  const uploadFile = async (key, file, type) => {
    if (!file) return
    try {
      const { hashFile } = await import('../../core/utils-client')
      const hash = await hashFile(file)
      const ext = file.name.split('.').pop().toLowerCase()
      const url = `asset://${hash}.${ext}`
      if (type === 'model') world.loader.insert('model', url, file)
      await world.network.upload(file)
      updateProp(key, url)
    } catch (e) { console.error('Upload error', e) }
  }

  const stageColors = ['#4f46e5', '#10b981', '#ef4444']
  const stageIdx = activeStage - 1

  // Get effective values for current stage (respecting inherit/override)
  const getEffective = (key, stage) => {
    if (stage === 1) return p[`${key}1`]
    const override = p[`${key}Override${stage}`]
    return override ? p[`${key}${stage}`] : getEffective(key, stage - 1)
  }

  const renderFileBtn = (key, accept, label, type) => {
    const val = p[key]
    const short = val ? val.split('/').pop().slice(0, 14) : null
    return (
      <div className='so-value'>
        <button
          className={`so-file-btn${val ? ' has-file' : ''}`}
          onClick={() => {
            const idx = parseInt(key.slice(-1)) - 1
            const refs = type === 'audio' ? audioRefs : modelRefs
            refs[idx]?.current?.click()
          }}
        >
          {short ? `${short}` : label}
        </button>
        {val && (
          <button className='so-clear-btn' onClick={() => updateProp(key, null)}>
            <XIcon size='0.75rem' />
          </button>
        )}
        <input
          ref={type === 'audio' ? audioRefs[parseInt(key.slice(-1)) - 1] : modelRefs[parseInt(key.slice(-1)) - 1]}
          type='file' accept={accept} style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(key, f, type); e.target.value = '' }}
        />
      </div>
    )
  }

  const renderToggle = (key, onLabel, offLabel) => {
    const val = p[key]
    return (
      <button
        className={`so-toggle ${val ? 'on' : 'off'}`}
        onClick={() => updateProp(key, !val)}
      >
        {val ? onLabel : offLabel}
      </button>
    )
  }

  const renderInteract = (key, radiusKey, hintKey) => {
    const val = p[key]
    const opts = [
      { label: 'Yok', value: null },
      { label: 'Tıkla', value: 'click' },
      { label: 'Yakınlık', value: 'proximity' },
    ]
    return (
      <>
        <div className='so-row'>
          <div className='so-label'>Etkileşim</div>
          <div className='so-value'>
            <div className='so-seg'>
              {opts.map(o => (
                <button
                  key={String(o.value)}
                  className={`so-seg-btn${val === o.value ? ' active' : ''}`}
                  onClick={() => updateProp(key, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {val === 'proximity' && (
          <div className='so-row'>
            <div className='so-label'>Yarıçap</div>
            <div className='so-value'>
              <button className='so-step-btn' onClick={() => updateProp(radiusKey, Math.max(0.1, ((p[radiusKey] || 1) - 0.1)))}>
                <Minus size='0.75rem' />
              </button>
              <input
                className='so-num-input'
                type='number' min='0.1' step='0.1'
                value={(p[radiusKey] || 1).toFixed(1)}
                onChange={e => updateProp(radiusKey, parseFloat(e.target.value) || 1)}
              />
              <button className='so-step-btn' onClick={() => updateProp(radiusKey, ((p[radiusKey] || 1) + 0.1))}>
                <Plus size='0.75rem' />
              </button>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>m</span>
            </div>
          </div>
        )}
        {val === 'click' && (
          <div className='so-row'>
            <div className='so-label'>Hint</div>
            <div className='so-value'>
              <input
                className='so-input'
                placeholder='Tıkla...'
                value={p[hintKey] || ''}
                onChange={e => updateProp(hintKey, e.target.value)}
              />
            </div>
          </div>
        )}
      </>
    )
  }

  const s = activeStage
  const isOverrideStage = s > 1

  return (
    <div
      css={css`
        background: rgba(11,10,21,0.9);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 1.375rem;
        display: flex;
        flex-direction: column;

        .so-head {
          height: 3rem; padding: 0 0.875rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; align-items: center; gap: 0.5rem;
          font-size: 0.9rem; font-weight: 600; color: rgba(255,255,255,0.85);
        }
        .so-stage-tabs {
          display: flex; padding: 0.375rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          gap: 0.25rem;
        }
        .so-stage-tab {
          flex: 1; height: 2rem; border-radius: 0.5rem;
          font-size: 0.8125rem; font-weight: 500; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 0.3rem;
          transition: all 0.12s;
          background: transparent; color: rgba(255,255,255,0.4);
          &:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7); }
          &.active { background: rgba(255,255,255,0.08); color: white; }
        }
        .so-stage-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; flex-shrink: 0; }

        .so-body { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }

        .so-section {
          font-size: 0.7rem; color: rgba(255,255,255,0.3); text-transform: uppercase;
          letter-spacing: 0.05em; padding: 0.375rem 0.375rem 0.125rem;
        }

        .so-row {
          display: flex; align-items: center; gap: 0.375rem; min-height: 2rem;
        }
        .so-label {
          font-size: 0.8125rem; color: rgba(255,255,255,0.5);
          width: 5.25rem; flex-shrink: 0;
        }
        .so-value { flex: 1; display: flex; align-items: center; gap: 0.3rem; }

        .so-input {
          flex: 1; height: 1.875rem; padding: 0 0.5rem;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.5rem; color: white; font-size: 0.8125rem; outline: none;
          &:focus { border-color: rgba(255,255,255,0.3); }
        }
        .so-num-input {
          width: 3.5rem; height: 1.875rem; padding: 0 0.25rem; text-align: center;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.5rem; color: white; font-size: 0.8125rem; outline: none;
          &:focus { border-color: rgba(255,255,255,0.3); }
        }
        .so-step-btn {
          width: 1.5rem; height: 1.875rem; border-radius: 0.4rem;
          background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
          color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;
          &:hover { background: rgba(255,255,255,0.15); }
        }
        .so-toggle {
          height: 1.875rem; padding: 0 0.5rem; border-radius: 0.5rem;
          font-size: 0.8125rem; cursor: pointer; display: flex; align-items: center;
          gap: 0.3rem; transition: all 0.12s;
          &.on { background: rgba(16,185,129,0.2); border: 1px solid rgba(16,185,129,0.35); color: #10b981; }
          &.off { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.45); }
        }
        .so-file-btn {
          height: 1.875rem; padding: 0 0.5rem; border-radius: 0.5rem; flex: 1;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.7); font-size: 0.8125rem; cursor: pointer;
          display: flex; align-items: center;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          &:hover { background: rgba(255,255,255,0.12); }
          &.has-file { background: rgba(79,70,229,0.15); border-color: rgba(79,70,229,0.4); color: #a5b4fc; }
        }
        .so-clear-btn {
          width: 1.5rem; height: 1.875rem; flex-shrink: 0; border-radius: 0.4rem;
          background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2);
          color: #f87171; cursor: pointer; display: flex; align-items: center; justify-content: center;
          &:hover { background: rgba(239,68,68,0.2); }
        }
        .so-seg { display: flex; gap: 0.2rem; background: rgba(255,255,255,0.04); border-radius: 0.5rem; padding: 0.15rem; }
        .so-seg-btn {
          flex: 1; height: 1.5rem; border-radius: 0.375rem; font-size: 0.75rem;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          color: rgba(255,255,255,0.45); transition: all 0.12s;
          &:hover { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.06); }
          &.active { background: rgba(255,255,255,0.1); color: white; }
        }
        .so-override {
          display: flex; align-items: center; gap: 0.375rem;
          padding: 0.25rem 0.375rem 0.125rem; margin-bottom: 0.125rem;
        }
        .so-override-label { font-size: 0.75rem; color: rgba(255,255,255,0.3); flex: 1; }
        .so-override-btn {
          height: 1.5rem; padding: 0 0.5rem; border-radius: 0.375rem;
          font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem;
          transition: all 0.12s;
          &.on { background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.35); color: #a5b4fc; }
          &.off { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.35); }
        }
      `}
    >
      <div className='so-head'>
        <div style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: '#a29bfe', flexShrink: 0 }} />
        Smart Object
      </div>

      {/* Stage tabs */}
      <div className='so-stage-tabs'>
        {[1, 2, 3].map(n => (
          <button
            key={n}
            className={`so-stage-tab${activeStage === n ? ' active' : ''}`}
            onClick={() => setActiveStage(n)}
          >
            <div className='so-stage-dot' style={{ background: stageColors[n - 1] }} />
            Durum {n}
          </button>
        ))}
      </div>

      <div className='so-body'>
        {/* Override controls for stages 2/3 */}
        {isOverrideStage && (
          <div className='so-override'>
            <div className='so-override-label'>Model, Collision, Anim — varsayılan Durum {s - 1}'den miras alır</div>
          </div>
        )}

        {/* Model */}
        <div className='so-section'>Model</div>
        {isOverrideStage && (
          <div className='so-row'>
            <div className='so-label'>Override</div>
            <div className='so-value'>
              <button
                className={`so-override-btn ${p[`modelOverride${s}`] ? 'on' : 'off'}`}
                onClick={() => updateProp(`modelOverride${s}`, !p[`modelOverride${s}`])}
              >
                {p[`modelOverride${s}`] ? 'Override açık' : 'Miras alıyor'}
              </button>
            </div>
          </div>
        )}
        {(!isOverrideStage || p[`modelOverride${s}`]) && (
          <div className='so-row'>
            <div className='so-label'>GLB</div>
            {renderFileBtn(`model${s}`, '.glb', 'Model seç', 'model')}
          </div>
        )}

        {/* Collision */}
        {(!isOverrideStage || p[`modelOverride${s}`]) && (
          <div className='so-row'>
            <div className='so-label'>Collision</div>
            <div className='so-value'>
              {isOverrideStage ? (
                <>
                  <button
                    className={`so-override-btn ${p[`collisionOverride${s}`] ? 'on' : 'off'}`}
                    onClick={() => updateProp(`collisionOverride${s}`, !p[`collisionOverride${s}`])}
                  >
                    {p[`collisionOverride${s}`] ? 'Override' : 'Miras'}
                  </button>
                  {p[`collisionOverride${s}`] && renderToggle(`collision${s}`, 'Evet', 'Hayır')}
                </>
              ) : (
                renderToggle(`collision${s}`, 'Evet', 'Hayır')
              )}
            </div>
          </div>
        )}

        {/* Interaction */}
        <div className='so-section'>Etkileşim</div>
        {renderInteract(`interact${s}`, `radius${s}`, `hint${s}`)}

        {/* Audio */}
        <div className='so-section'>Ses</div>
        <div className='so-row'>
          <div className='so-label'>MP3</div>
          {renderFileBtn(`audio${s}`, '.mp3,.wav,.ogg', 'Ses seç', 'audio')}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// WorldObjectsPanel — floating panel showing all scene entities
function WorldObjectsPanel({ world }) {
  const [entities, setEntities] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('')

  // Rebuild entity list
  const rebuild = useCallback(() => {
    const list = []
    world.entities.items.forEach(entity => {
      if (!entity.isApp || entity.dead) return
      list.push(entity)
    })
    setEntities([...list])
  }, [world])

  useEffect(() => {
    rebuild()
    world.entities.on('added', rebuild)
    world.entities.on('removed', rebuild)
    return () => {
      world.entities.off('added', rebuild)
      world.entities.off('removed', rebuild)
    }
  }, [rebuild])

  // Track selected app from UI state
  useEffect(() => {
    const onUI = uiState => {
      setSelectedId(uiState.app?.data?.id || null)
    }
    world.on('ui', onUI)
    return () => world.off('ui', onUI)
  }, [world])

  const select = useCallback((entity) => {
    setSelectedId(entity.data.id)
    world.ui.setApp(entity)
    // Also select in builder (translate mode, no pointer lock)
    try {
      if (world.builder.enabled) {
        world.builder.setMode('translate')
        world.builder.select(entity)
      }
    } catch {}
  }, [world])

  const filtered = entities.filter(e => {
    if (!filter) return true
    const name = e.blueprint?.name || e.data.id
    return name.toLowerCase().includes(filter.toLowerCase())
  })

  const selectedEntity = entities.find(e => e.data.id === selectedId)
  const isSmartObject = selectedEntity?.blueprint?.props?.smartObject === true

  return (
    <div
      css={css`
        position: fixed;
        top: calc(2rem + env(safe-area-inset-top));
        left: calc(2rem + env(safe-area-inset-left));
        z-index: 500;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        width: 14rem;
        max-height: calc(100vh - 4rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .obj-panel {
          background: rgba(11,10,21,0.88);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 1.25rem;
          display: flex; flex-direction: column;
          overflow: hidden;
          max-height: 55vh;
        }
        .obj-head {
          height: 3rem; padding: 0 0.875rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; align-items: center; gap: 0.5rem;
          flex-shrink: 0;
          font-size: 0.9rem; font-weight: 600; color: rgba(255,255,255,0.85);
        }
        .obj-count {
          background: rgba(255,255,255,0.08); border-radius: 0.75rem;
          font-size: 0.7rem; padding: 0.1rem 0.4rem; color: rgba(255,255,255,0.4);
        }
        .obj-search {
          padding: 0.5rem 0.75rem; flex-shrink: 0;
        }
        .obj-search-input {
          width: 100%; height: 1.875rem; padding: 0 0.625rem;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.625rem; color: white; font-size: 0.8125rem; outline: none;
          &:focus { border-color: rgba(255,255,255,0.25); }
          &::placeholder { color: rgba(255,255,255,0.3); }
        }
        .obj-list { flex: 1; overflow-y: auto; padding: 0.25rem 0.375rem 0.375rem; }
        .obj-item {
          height: 2.25rem; padding: 0 0.625rem; border-radius: 0.625rem;
          display: flex; align-items: center; gap: 0.5rem;
          cursor: pointer; font-size: 0.8125rem; color: rgba(255,255,255,0.7);
          transition: all 0.1s;
          &:hover { background: rgba(255,255,255,0.07); color: white; }
          &.selected { background: rgba(79,70,229,0.2); color: #a5b4fc; }
        }
        .obj-icon { width: 1.125rem; height: 1.125rem; flex-shrink: 0; opacity: 0.6; }
        .obj-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .obj-badge {
          font-size: 0.625rem; padding: 0.1rem 0.3rem; border-radius: 0.3rem;
          background: rgba(162,155,254,0.15); color: #a29bfe; flex-shrink: 0;
        }
        .obj-hint {
          padding: 0.5rem 0.875rem 0.75rem;
          font-size: 0.75rem; color: rgba(255,255,255,0.3); line-height: 1.4;
          flex-shrink: 0;
          border-top: 1px solid rgba(255,255,255,0.04);
        }
      `}
    >
      <div className='obj-panel'>
        <div className='obj-head'>
          <BoxIcon size='0.9rem' style={{ opacity: 0.6 }} />
          Sahnedeki Objeler
          <span className='obj-count'>{filtered.length}</span>
        </div>
        <div className='obj-search'>
          <input
            className='obj-search-input'
            placeholder='Ara...'
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className='obj-list noscrollbar'>
          {filtered.length === 0 && (
            <div style={{ padding: '0.5rem 0.625rem', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.3)' }}>
              Obje bulunamadı
            </div>
          )}
          {filtered.map(entity => {
            const name = entity.blueprint?.name || entity.data.id.slice(0, 10)
            const isSelected = entity.data.id === selectedId
            const isSO = entity.blueprint?.props?.smartObject === true
            return (
              <div
                key={entity.data.id}
                className={`obj-item${isSelected ? ' selected' : ''}`}
                onClick={() => select(entity)}
              >
                <BoxIcon size='0.875rem' className='obj-icon' />
                <span className='obj-name'>{name}</span>
                {isSO && <span className='obj-badge'>Smart</span>}
              </div>
            )
          })}
        </div>
        <div className='obj-hint'>
          Sağ tık → objeyi seç &amp; App panelini aç
        </div>
      </div>

      {/* Smart Object Editor — shown below objects panel when selected */}
      {isSmartObject && selectedEntity && (
        <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
          <SmartObjectEditor entity={selectedEntity} world={world} />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// EditorHint
// ------------------------------------------------------------------
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
        bottom: calc(5.5rem + env(safe-area-inset-bottom));
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
        white-space: nowrap;
      `}
    >
      Editör aktif — Sağ tık: obje seç | 2: Translate | 3: Rotate | 4: Scale
    </div>
  )
}

// ------------------------------------------------------------------
// Main exported component
// ------------------------------------------------------------------
export function StandaloneEditorGate({ world }) {
  const [showPwModal, setShowPwModal] = useState(false)
  const [editorUnlocked, setEditorUnlocked] = useState(false)
  const [buildMode, setBuildMode] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showHint, setShowHint] = useState(false)

  // Track build-mode changes
  useEffect(() => {
    const handler = enabled => setBuildMode(enabled)
    world.on('build-mode', handler)
    return () => world.off('build-mode', handler)
  }, [world])

  // Shift+A → password modal
  useEffect(() => {
    const handleKey = e => {
      if (
        e.shiftKey && e.code === 'KeyA' &&
        !e.target.matches('input, textarea, [contenteditable]')
      ) {
        e.preventDefault()
        if (editorUnlocked) {
          world.builder.toggle()
        } else {
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

    // Elevate to ADMIN
    const player = world.entities.player
    if (player) {
      player.data.rank = 2
      world.emit('rank', { playerId: player.data.id })
    }

    world.builder.toggle(true)
    // Enable desktop mode: no pointer lock, click-to-select, gizmo-only transforms
    world.builder.desktopMode = true
    world.builder.setMode('translate')
    setShowHint(true)
  }, [world])

  // Save: use stored PAT directly, or show dialog if none stored
  const handleSave = useCallback(() => {
    const pat = getStoredPAT()
    if (pat) {
      // Save directly without showing dialog
      setShowSave('quick')
    } else {
      setShowSave('dialog')
    }
  }, [])

  return (
    <>
      {showPwModal && (
        <PasswordModal
          onSuccess={handlePasswordSuccess}
          onClose={() => setShowPwModal(false)}
        />
      )}

      {buildMode && (
        <WorldObjectsPanel world={world} />
      )}

      {buildMode && (
        <SaveFab
          onSave={handleSave}
          onConfigPAT={() => setShowSave('dialog')}
        />
      )}

      {showSave === 'dialog' && (
        <SaveDialog world={world} onClose={() => setShowSave(false)} />
      )}

      {showSave === 'quick' && (
        <QuickSave world={world} onDone={() => setShowSave(false)} />
      )}

      {showHint && buildMode && (
        <EditorHint key={Date.now()} />
      )}
    </>
  )
}

// ------------------------------------------------------------------
// QuickSave — saves immediately with stored PAT, shows minimal UI
// ------------------------------------------------------------------
function QuickSave({ world, onDone }) {
  const [status, setStatus] = useState('Hazırlanıyor...')
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const pat = getStoredPAT()
    saveToGitHub({ world, token: pat, onStatus: setStatus })
      .then(() => { setDone(true); setTimeout(onDone, 2000) })
      .catch(e => setError(e.message))
  }, [])

  return (
    <div
      css={css`
        position: fixed;
        bottom: calc(5.5rem + env(safe-area-inset-bottom));
        right: calc(2rem + env(safe-area-inset-right));
        z-index: 2000;
        pointer-events: auto;
        background: rgba(11,10,21,0.95);
        border: 1px solid ${error ? '#ef4444' : done ? '#16a34a' : '#2a2b39'};
        border-radius: 1rem;
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
        color: ${error ? '#f87171' : done ? '#4ade80' : 'rgba(255,255,255,0.7)'};
        display: flex; align-items: center; gap: 0.5rem;
        backdrop-filter: blur(5px);
        max-width: 18rem;
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}
    >
      {!done && !error && <LoaderIcon size='0.9rem' style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />}
      {done && <CheckCircleIcon size='0.9rem' style={{ flexShrink: 0 }} />}
      <span>{error ? `Hata: ${error}` : status}</span>
      {(done || error) && (
        <button
          onClick={onDone}
          style={{ marginLeft: 'auto', opacity: 0.6, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', padding: 0 }}
        >
          <XIcon size='0.9rem' />
        </button>
      )}
    </div>
  )
}
