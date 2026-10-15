"""Unit tests for the Lambda@Edge viewer-request handler (edge.py).

Two guarantees, both critical because this function fronts production `ps`:

  1. SPA apps (not in `static_apps`) behave EXACTLY as before — every
     extensionless deep link falls back to /<app>/index.html.
  2. Static apps (in `static_apps`, e.g. the Docusaurus dev portal) resolve as
     real multi-page sites — per-route index.html, .html pass-through — and
     never SPA-clobber to /<app>/index.html.

edge.py reads config.json (a Terraform-rendered artifact) at import time, so we
load a fresh copy of the module from a temp dir with a fixture config baked in,
leaving the real source untouched. Stdlib only — no pytest/config required:

    python3 -m unittest test_edge -v
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_EDGE_SRC = os.path.join(_HERE, 'edge.py')


def _load_edge(config: dict):
    """Load edge.py as an isolated module with `config` as its config.json."""
    tmp = tempfile.mkdtemp(prefix='edge-test-')
    shutil.copy(_EDGE_SRC, os.path.join(tmp, 'edge.py'))
    with open(os.path.join(tmp, 'config.json'), 'w', encoding='utf-8') as f:
        json.dump(config, f)
    spec = importlib.util.spec_from_file_location(f'edge_{id(config)}', os.path.join(tmp, 'edge.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.__test_tmpdir__ = tmp  # kept for cleanup
    return module


def _event(uri: str, host: str = 'example.portal.example.com', qs: str = ''):
    return {
        'Records': [
            {
                'cf': {
                    'request': {
                        'uri': uri,
                        'querystring': qs,
                        'headers': {'host': [{'key': 'Host', 'value': host}]},
                    }
                }
            }
        ]
    }


def _call(edge, uri: str, qs: str = ''):
    return edge.handler(_event(uri, qs=qs), None)


def _is_redirect(result) -> bool:
    return isinstance(result, dict) and result.get('status') in ('301', '302')


def _location(result) -> str:
    return result['headers']['location'][0]['value']


# Config mirroring the intended dev-env layout: ps is an SPA, dev is static.
CONFIG = {
    'apps': ['ps', 'dev'],
    'static_apps': ['dev'],
    'default_app': 'ps',
    'public_path_prefixes': ['/documents/', '/pub/'],
    'canonical_host': '',
    'redirect_hosts': [],
}


class SpaAppUnchanged(unittest.TestCase):
    """`ps` must behave byte-for-byte as before the static_apps change."""

    @classmethod
    def setUpClass(cls):
        cls.edge = _load_edge(CONFIG)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(getattr(cls.edge, '__test_tmpdir__', ''), ignore_errors=True)

    def test_root_redirects_to_default_app(self):
        r = _call(self.edge, '/')
        self.assertTrue(_is_redirect(r))
        self.assertEqual(_location(r), '/ps/')

    def test_bare_app_prefix_gets_trailing_slash(self):
        r = _call(self.edge, '/ps')
        self.assertTrue(_is_redirect(r))
        self.assertEqual(_location(r), '/ps/')

    def test_app_root_serves_index(self):
        r = _call(self.edge, '/ps/')
        self.assertEqual(r['uri'], '/ps/index.html')

    def test_deep_link_falls_back_to_index(self):
        # The defining SPA behavior: an extensionless client route -> index.html.
        r = _call(self.edge, '/ps/accounts')
        self.assertEqual(r['uri'], '/ps/index.html')

    def test_nested_deep_link_falls_back_to_index(self):
        r = _call(self.edge, '/ps/accounts/12345')
        self.assertEqual(r['uri'], '/ps/index.html')

    def test_hashed_asset_passes_through_untouched(self):
        r = _call(self.edge, '/ps/assets/index-a1b2c3.js')
        self.assertEqual(r['uri'], '/ps/assets/index-a1b2c3.js')

    def test_api_passthrough(self):
        r = _call(self.edge, '/api/partners')
        self.assertEqual(r['uri'], '/api/partners')


class StaticAppResolves(unittest.TestCase):
    """`dev` (static) must resolve real multi-page objects, never SPA-clobber."""

    @classmethod
    def setUpClass(cls):
        cls.edge = _load_edge(CONFIG)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(getattr(cls.edge, '__test_tmpdir__', ''), ignore_errors=True)

    def test_bare_app_prefix_gets_trailing_slash(self):
        r = _call(self.edge, '/dev')
        self.assertTrue(_is_redirect(r))
        self.assertEqual(_location(r), '/dev/')

    def test_app_root_serves_index(self):
        r = _call(self.edge, '/dev/')
        self.assertEqual(r['uri'], '/dev/index.html')

    def test_subdir_trailing_slash_serves_its_index(self):
        # Docusaurus trailingSlash build: /dev/graphql/ -> /dev/graphql/index.html.
        r = _call(self.edge, '/dev/graphql/')
        self.assertEqual(r['uri'], '/dev/graphql/index.html')

    def test_extensionless_subpath_redirects_to_canonical_slash(self):
        # NOT clobbered to /dev/index.html: 301 to the trailing-slash URL, which
        # the next hit resolves to .../index.html.
        r = _call(self.edge, '/dev/graphql/overview')
        self.assertTrue(_is_redirect(r))
        self.assertEqual(_location(r), '/dev/graphql/overview/')

    def test_extensionless_subpath_preserves_querystring(self):
        r = _call(self.edge, '/dev/mcp/tools', qs='q=search')
        self.assertTrue(_is_redirect(r))
        self.assertEqual(_location(r), '/dev/mcp/tools/?q=search')

    def test_real_html_object_passes_through(self):
        # A bare .html is a real object for a static site — never rewritten.
        r = _call(self.edge, '/dev/404.html')
        self.assertEqual(r['uri'], '/dev/404.html')

    def test_hashed_asset_passes_through_untouched(self):
        r = _call(self.edge, '/dev/assets/js/main.deadbeef.js')
        self.assertEqual(r['uri'], '/dev/assets/js/main.deadbeef.js')


class StaticAppsDefaultEmpty(unittest.TestCase):
    """With no static_apps (the default), every app keeps SPA behavior."""

    @classmethod
    def setUpClass(cls):
        cls.edge = _load_edge({
            'apps': ['ps', 'dev'],
            'default_app': 'ps',
            # no 'static_apps' key at all -> STATIC_APPS empty
        })

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(getattr(cls.edge, '__test_tmpdir__', ''), ignore_errors=True)

    def test_absent_flag_yields_empty_set(self):
        self.assertEqual(self.edge.STATIC_APPS, frozenset())

    def test_dev_falls_back_like_an_spa_when_not_static(self):
        r = _call(self.edge, '/dev/graphql/overview')
        self.assertEqual(r['uri'], '/dev/index.html')


if __name__ == '__main__':
    unittest.main()
