/**
 * HL-AUTH-001 — Entrance gate.
 *
 * Runs before the command centre boots. The app stays hidden (gate.css) until
 * this module resolves. The backend enforces the real boundary (middleware on
 * /api/* and /ws/*); this overlay only decides whether the UI may show.
 *
 * Flow: status -> disabled/authenticated: release the app.
 *       enabled & locked: show the gate image + Enter button -> password form
 *       -> POST /api/entrance/unlock -> reload to /?view=home on success.
 */

const APP = document.getElementById('app');
const GATE_ID = 'hl-gate';

function releaseApp(): void {
  const gate = document.getElementById(GATE_ID);
  if (gate) gate.remove();
  APP?.classList.add('hl-gate-open');
}

/** ArrayBuffer -> unpadded base64url, the wire format WebAuthn expects. */
function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PublicKeyCredential -> the JSON dict the backend's webauthn library parses. */
function serializeCredential(cred: PublicKeyCredential): Record<string, unknown> {
  const resp = (cred.response ?? {}) as unknown as Record<string, ArrayBuffer | string[] | undefined>;
  const response: Record<string, unknown> = {};
  for (const key of ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature']) {
    if (resp[key] instanceof ArrayBuffer) response[key] = b64url(resp[key] as ArrayBuffer);
  }
  return { id: cred.id, rawId: b64url(cred.rawId), type: cred.type, response };
}

async function fetchWebauthnOptions(kind: 'register' | 'authenticate'): Promise<unknown> {
  const res = await fetch(`/api/entrance/webauthn/${kind}/options`);
  if (!res.ok) throw new Error(`options ${res.status}`);
  return res.json();
}

/**
 * HL-AUTH-002: passwordless unlock. Fetches assertion options, prompts the
 * authenticator, posts the assertion — on success the backend sets the same
 * session cookie as the password unlock and we reload.
 */
export async function gatePasskeyUnlock(): Promise<void> {
  const options = await fetchWebauthnOptions('authenticate');
  const cred = await navigator.credentials.get({ publicKey: options as PublicKeyCredentialRequestOptions });
  if (!cred || !(cred instanceof PublicKeyCredential)) throw new Error('No passkey credential returned');
  const res = await fetch('/api/entrance/webauthn/authenticate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(serializeCredential(cred)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Passkey unlock failed');
  }
}

/**
 * HL-AUTH-002: enrol this device. Requires an unlocked session (call from the
 * app). Throws Error with a human-readable message on failure.
 */
export async function gateRegisterPasskey(): Promise<void> {
  const options = await fetchWebauthnOptions('register');
  const cred = await navigator.credentials.create({ publicKey: options as PublicKeyCredentialCreationOptions });
  if (!cred || !(cred instanceof PublicKeyCredential)) throw new Error('No passkey credential returned');
  const res = await fetch('/api/entrance/webauthn/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(serializeCredential(cred)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Passkey registration failed');
  }
}

function buildGate(imageUrl: string | null, passkeyAvailable: boolean): HTMLElement {
  const gate = document.createElement('div');
  gate.id = GATE_ID;
  gate.innerHTML = `
    <div class="hl-gate-stage">
      ${imageUrl ? `<img class="hl-gate-img" src="${imageUrl}" alt="Entrance gate" />` : ''}
    </div>
    <div class="hl-gate-actions">
      <button id="hl-gate-enter" type="button">Enter</button>
      ${passkeyAvailable ? '<button id="hl-gate-passkey" type="button">🔑 Unlock with passkey</button>' : ''}
      <form id="hl-gate-form" hidden>
        <label>Password
          <input id="hl-gate-pass" type="password" autocomplete="current-password" />
        </label>
        <button id="hl-gate-submit" type="submit">Unlock Gate</button>
        <p id="hl-gate-error" role="alert"></p>
      </form>
    </div>`;
  return gate;
}

function showGate(imageUrl: string | null, passkeyAvailable = false): void {
  const gate = buildGate(imageUrl, passkeyAvailable);
  document.body.appendChild(gate);
  const img = gate.querySelector<HTMLImageElement>('.hl-gate-img');
  img?.addEventListener('error', () => img.remove());  // image missing: gate still works
  const error = gate.querySelector<HTMLElement>('#hl-gate-error')!;
  const enter = gate.querySelector<HTMLButtonElement>('#hl-gate-enter')!;
  const form = gate.querySelector<HTMLFormElement>('#hl-gate-form')!;
  const input = gate.querySelector<HTMLInputElement>('#hl-gate-pass')!;

  enter.addEventListener('click', () => {
    form.hidden = false;
    enter.hidden = true;
    input.focus();
  });

  const passkeyBtn = gate.querySelector<HTMLButtonElement>('#hl-gate-passkey');
  passkeyBtn?.addEventListener('click', async () => {
    error.textContent = '';
    passkeyBtn.disabled = true;
    try {
      await gatePasskeyUnlock();
      window.location.href = '/?view=home';  // fresh load with the session cookie
      return;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Passkey unlock failed';
      passkeyBtn.disabled = false;
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.textContent = '';
    try {
      const res = await fetch('/api/entrance/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      });
      if (res.ok) {
        window.location.href = '/?view=home';  // fresh load with the session cookie
        return;
      }
      const body = await res.json().catch(() => ({}));
      error.textContent = typeof body.error === 'string' ? body.error : 'Unlock failed';
    } catch {
      error.textContent = 'Gate service unreachable';
    }
  });
}

/**
 * HL-AUTH-001 logout: clears the gate session cookie server-side and reloads
 * onto the entrance (the gate overlay shows again on the fresh load). Safe to
 * call whether the gate is enabled or not — when disabled the backend 404s and
 * the reload simply runs with the current session.
 */
export async function gateLogout(): Promise<void> {
  try {
    await fetch('/api/entrance/logout', { method: 'POST' });
  } catch {
    // Cookie may still be cleared by the server even if the response is lost;
    // the reload below re-resolves the real status either way.
  }
  window.location.href = '/?view=home';
}

export async function initGate(): Promise<void> {
  if (!APP) return;
  try {
    const res = await fetch('/api/entrance/status');
    if (!res.ok) throw new Error(`status ${res.status}`);
    const state = await res.json();
    if (!state.enabled || state.authenticated) {
      releaseApp();
      return;
    }
    showGate(state.image_url ?? null, state.passkey_available === true);
  } catch {
    // Backend unreachable: keep the gate up (secure default) and say why.
    showGate(null);
    const error = document.getElementById('hl-gate-error');
    if (error) error.textContent = 'Gate service unreachable';
  }
}

initGate();
