"""Cognito pre-sign-up trigger — domain allowlist + auto-confirm federated users.

Fires when a new user is created. For Google-federated sign-ins the source is
PreSignUp_ExternalProvider. We enforce the email-domain allowlist here as the
authoritative gate (defense in depth with the Google IdP itself) and
auto-confirm/verify so federated users don't sit in an unconfirmed state.
"""

from __future__ import annotations

import os
from typing import Any

ALLOWED = frozenset(d.strip().lower() for d in os.environ.get('ALLOWED_EMAIL_DOMAINS', '').split(',') if d.strip())


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    attrs = (event.get('request') or {}).get('userAttributes') or {}
    email = (attrs.get('email') or '').lower()
    domain = email.rsplit('@', 1)[-1] if '@' in email else ''

    if ALLOWED and domain not in ALLOWED:
        # Raising rejects the sign-up; Cognito surfaces it as an auth failure.
        raise Exception(f'Email domain not allowed: {domain or "(none)"}')

    resp = event.setdefault('response', {})
    resp['autoConfirmUser'] = True
    resp['autoVerifyEmail'] = True
    return event
