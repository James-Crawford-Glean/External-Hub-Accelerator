"""Lambda@Edge viewer-request handler for the SPA distribution.

Routing only — no auth. Auth moved to Cognito: AppSync (OIDC) and the HTTP API
(JWT authorizer) verify Cognito-issued JWTs against the pool's JWKS, which is
the real enforcement boundary (that's where data lives). The static SPA shell
carries no secrets, so it's served openly; an unauthenticated user just gets
bounced to Cognito by the app the moment it calls the API.

We do NOT gate at the edge with a token: the SPA holds its OIDC tokens in
localStorage, not an edge-readable cookie, and a verifier key at the edge is
exactly the stealable-key risk we removed. If edge-level shell gating is ever
wanted, do it as a JWKS verify of a short-lived id-token cookie the SPA sets —
never a shared secret.

This handler: vanity host -> canonical host, root -> default app, trailing-slash ->
index.html, /api/* and static assets pass through, everything else under /<app>/ falls back
to that app's index.html (client-side routing).

Apps listed in `static_apps` are the exception: they are multi-page static sites
(e.g. a Docusaurus build) where every route is a real object — `<route>/index.html`
under a trailing-slash build. For those we do NOT SPA-fall-back to /<app>/index.html
(which would clobber the real pages); instead an extensionless sub-path 301s to its
canonical trailing-slash URL and real `.html` objects pass through. Apps not in the
set keep the exact SPA fallback below.

Lambda@Edge constraints: no env vars (config baked into the zip via
config.json), viewer-request returns a request (proceed to origin) or a
response (return directly), stdlib only.
"""

from __future__ import annotations

import json
import logging
import os

logging.basicConfig(level=logging.INFO, force=True)
log = logging.getLogger('edge')

with open(os.path.join(os.path.dirname(__file__), 'config.json'), encoding='utf-8') as _f:
    CONFIG = json.load(_f)

APPS = list(CONFIG.get('apps') or [])
DEFAULT_APP = CONFIG.get('default_app') or ''
PUBLIC_PATH_PREFIXES = list(CONFIG.get('public_path_prefixes') or ['/documents/', '/pub/'])
CANONICAL_HOST = (CONFIG.get('canonical_host') or '').lower()
REDIRECT_HOSTS = frozenset(h.lower() for h in (CONFIG.get('redirect_hosts') or []))
# Apps served as multi-page static sites instead of SPAs (see module docstring).
# Default empty -> every app keeps today's SPA fallback.
STATIC_APPS = frozenset(CONFIG.get('static_apps') or [])

STATIC_EXTENSIONS = frozenset({
    '.js', '.mjs', '.css', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.json',
    '.txt', '.xml', '.pdf', '.wasm',
})


def handler(event, context):
    request = event['Records'][0]['cf']['request']
    uri = request.get('uri', '/')
    qs = request.get('querystring', '') or ''

    # Vanity hosts (www) 301 to the canonical host before anything else, so the app only ever
    # runs on one origin — Cognito callbacks, RUM's domain check and localStorage all key off it.
    if REDIRECT_HOSTS and CANONICAL_HOST and _host_of(request) in REDIRECT_HOSTS:
        return _redirect(f'https://{CANONICAL_HOST}{uri}' + (f'?{qs}' if qs else ''), status='301')

    # Public app config — sub-apps hit /env.json at boot to learn the layout.
    if uri in ('/env.json', '/sso-config.json'):
        return _json_response(200, {'apps': APPS, 'default_app': DEFAULT_APP})

    # Root -> default app. Each SPA is built with base=/<app>/.
    if uri == '/' and DEFAULT_APP:
        return _redirect(f'/{DEFAULT_APP}/')

    # Trailing slash -> /index.html
    if uri.endswith('/'):
        request['uri'] = uri + 'index.html'
        uri = request['uri']

    # /api/* -> API origin (per-route auth at the API Gateway JWT authorizer).
    if uri.startswith('/api/'):
        return request

    # Static assets and intentionally-public prefixes pass straight through.
    if _ext_of(request['uri']) in STATIC_EXTENSIONS:
        return request
    if any(uri.startswith(p) for p in PUBLIC_PATH_PREFIXES):
        return request

    # /<app> -> 301 /<app>/ so the trailing slash is set before the SPA mounts.
    if (app := _match_app_prefix(uri)) is not None and uri == f'/{app}':
        return _redirect(f'/{app}/' + (f'?{qs}' if qs else ''))

    # Resolve within a matched app.
    if (app := _match_app_prefix(request['uri'])) is not None:
        if app in STATIC_APPS:
            # Multi-page static site (e.g. Docusaurus): serve real objects, do
            # NOT SPA-fall-back. A real .html object passes through; an
            # extensionless sub-path 301s to its canonical trailing-slash URL,
            # which the trailing-slash rule above resolves to .../index.html on
            # the next hit. (The bare /<app> -> /<app>/ 301 already happened.)
            if request['uri'].endswith('.html'):
                return request
            return _redirect(f"{request['uri']}/" + (f'?{qs}' if qs else ''))
        # Per-app SPA fallback: /<app>/<client-route> -> /<app>/index.html.
        request['uri'] = f'/{app}/index.html'

    return request


# ------------------------------------------------------------------ helpers --

def _ext_of(uri: str) -> str:
    dot = uri.rfind('.')
    slash = uri.rfind('/')
    return uri[dot:].lower() if dot > slash else ''


def _match_app_prefix(uri: str) -> str | None:
    if not uri or uri[0] != '/':
        return None
    rest = uri[1:]
    slash = rest.find('/')
    first = rest if slash == -1 else rest[:slash]
    return first if first and first in APPS else None


def _host_of(request) -> str:
    header = (request.get('headers') or {}).get('host') or []
    return header[0].get('value', '').lower() if header else ''


def _redirect(location: str, status: str = '302'):
    return {
        'status': status,
        'statusDescription': 'Moved Permanently' if status == '301' else 'Found',
        'headers': {
            'location': [{'key': 'Location', 'value': location}],
            'cache-control': [{'key': 'Cache-Control', 'value': 'no-store'}],
        },
    }


def _json_response(status: int, body):
    return {
        'status': str(status),
        'statusDescription': 'OK',
        'headers': {
            'content-type': [{'key': 'Content-Type', 'value': 'application/json'}],
            'cache-control': [{'key': 'Cache-Control', 'value': 'no-store'}],
        },
        'body': json.dumps(body),
    }
