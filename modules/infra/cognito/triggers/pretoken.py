"""Cognito pre-token-generation trigger (V2) — copy `email` onto the access token.

Cognito access tokens carry `sub`, `client_id`, and `scope` but no email. The MCP
resource server resolves roster roles and row visibility by email, so the
claim has to ride on the access token the MCP client presents. The ID token is
left untouched.
"""

from __future__ import annotations

from typing import Any


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    attrs = (event.get('request') or {}).get('userAttributes') or {}
    email = (attrs.get('email') or '').lower()
    if not email:
        return event

    # Cognito sends response.claimsAndScopeOverrideDetails as null, so build it outright.
    resp = event.setdefault('response', {})
    details = resp.get('claimsAndScopeOverrideDetails') or {}
    access = details.get('accessTokenGeneration') or {}
    claims = access.get('claimsToAddOrOverride') or {}
    resp['claimsAndScopeOverrideDetails'] = {
        **details,
        'accessTokenGeneration': {**access, 'claimsToAddOrOverride': {**claims, 'email': email}},
    }
    return event
