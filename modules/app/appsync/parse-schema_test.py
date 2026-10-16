from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

_MOD_PATH = Path(__file__).resolve().parent / 'parse-schema.py'
_SPEC = importlib.util.spec_from_file_location('parse_schema', _MOD_PATH)
assert _SPEC and _SPEC.loader
ps = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ps)

_SCHEMA = '''
"Portal API"
type Query @aws_lambda @aws_iam {
  me: User!
  "List users (admin). Paginated: returns {items, nextToken}."
  users(limit: Int, nextToken: String): UserConnection!
  apiKeys: [ApiKey!]!
  item(id: ID!): Item
  items(filter: ItemFilter, "sort (name|updatedAt)" sort: String): [Item!]!
}

type Mutation @aws_lambda {
  createApiKey(name: String!, scopes: [String!]!): CreatedApiKey!
  "Revoke a key. Idempotent (already-revoked ids are skipped)."
  revokeApiKey(id: ID!): ApiKey!
}

type User { id: ID! email: String! }
'''


class ParseFieldsTest(unittest.TestCase):
    def test_query_fields_classify_by_return_type(self) -> None:
        fields = dict(ps.parse_fields(ps.type_block(_SCHEMA, 'Query')))
        self.assertEqual(fields['me'], 'User!')
        self.assertEqual(fields['users'], 'UserConnection!')
        self.assertEqual(fields['apiKeys'], '[ApiKey!]!')
        self.assertEqual(fields['item'], 'Item')
        self.assertTrue(ps.is_list(fields['apiKeys']))
        self.assertFalse(ps.is_list(fields['users']))

    def test_inline_description_with_parens_does_not_drop_the_field(self) -> None:
        fields = dict(ps.parse_fields(ps.type_block(_SCHEMA, 'Query')))
        self.assertEqual(fields['items'], '[Item!]!')

    def test_block_description_with_parens_does_not_drop_the_field(self) -> None:
        fields = dict(ps.parse_fields(ps.type_block(_SCHEMA, 'Mutation')))
        self.assertEqual(fields['revokeApiKey'], 'ApiKey!')

    def test_directives_on_the_type_line_are_tolerated(self) -> None:
        self.assertIn('me: User!', ps.type_block(_SCHEMA, 'Query'))
        self.assertIn('createApiKey', ps.type_block(_SCHEMA, 'Mutation'))

    def test_mutations_are_not_queries(self) -> None:
        query_names = {n for n, _ in ps.parse_fields(ps.type_block(_SCHEMA, 'Query'))}
        mutation_names = {n for n, _ in ps.parse_fields(ps.type_block(_SCHEMA, 'Mutation'))}
        self.assertIn('createApiKey', mutation_names)
        self.assertNotIn('createApiKey', query_names)
        self.assertNotIn('me', mutation_names)

    def test_missing_type_yields_empty_block(self) -> None:
        self.assertEqual(ps.type_block(_SCHEMA, 'Subscription'), '')


class ManifestTest(unittest.TestCase):
    def test_manifest_kinds(self) -> None:
        import io
        import sys
        import tempfile

        with tempfile.NamedTemporaryFile('w', suffix='.graphql', delete=False) as f:
            f.write(_SCHEMA)
            schema_path = f.name
        stdin, stdout = sys.stdin, sys.stdout
        sys.stdin, sys.stdout = io.StringIO(json.dumps({'schema_path': schema_path})), io.StringIO()
        try:
            ps.main()
            out = sys.stdout.getvalue()
        finally:
            sys.stdin, sys.stdout = stdin, stdout
        manifest = json.loads(json.loads(out)['manifest_json'])
        self.assertEqual(manifest['Query.me'], 'object')
        self.assertEqual(manifest['Query.users'], 'object')
        self.assertEqual(manifest['Query.apiKeys'], 'list')
        self.assertEqual(manifest['Query.items'], 'list')
        self.assertEqual(manifest['Mutation.createApiKey'], 'mutation')
        self.assertEqual(manifest['Mutation.revokeApiKey'], 'mutation')
        self.assertEqual(len(manifest), 7)


if __name__ == '__main__':
    unittest.main()
