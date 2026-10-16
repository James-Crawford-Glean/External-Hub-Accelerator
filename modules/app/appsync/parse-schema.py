#!/usr/bin/env python3
"""schema.graphql -> manifest.json for AppSync TF.

Emits {key: kind} where:
  key  = "<TypeName>.<fieldName>" (e.g. "Query.users")
  kind = "list" | "object" | "mutation" | "custom"

custom is set when resolvers/custom/<key>.js exists, overriding the generic.

Handler lookup happens in the dispatcher Lambda at cold start (field name ->
registered resolver), so no static manifest is needed here.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def type_block(text: str, type_name: str) -> str:
    # Tolerate auth directives on the type line, e.g. `type Query @aws_iam @aws_oidc {`.
    m = re.search(rf'type\s+{type_name}\b[^{{]*\{{', text)
    if not m:
        return ''
    depth, i = 1, m.end()
    while i < len(text) and depth:
        c = text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        i += 1
    return text[m.end():i - 1]


# Strip "…" first: a `)` inside an inline description would truncate `[^)]*` and drop the field.
_STRING_RE = re.compile(r'"[^"]*"')
FIELD_RE = re.compile(r'^\s*(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+?)\s*$')


def parse_fields(body: str) -> list[tuple[str, str]]:
    fields = []
    for raw in body.splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line or line.startswith('"'):
            continue
        m = FIELD_RE.match(_STRING_RE.sub('', line))
        if m:
            fields.append((m.group(1), m.group(2)))
    return fields


def is_list(graphql_type: str) -> bool:
    return graphql_type.lstrip().startswith('[')


def main() -> None:
    args = json.loads(sys.stdin.read())
    schema_text = Path(args['schema_path']).read_text()
    custom_dir = Path(__file__).parent / 'resolvers' / 'custom'

    # Query fields classify list/object (template shapes the result); Mutation
    # fields use the mutation template (passthrough). A resolvers/custom/<key>.js
    # overrides either. type/field for the AppSync resolver come from the key.
    manifest: dict[str, str] = {}
    for type_name in ('Query', 'Mutation'):
        for field, return_type in parse_fields(type_block(schema_text, type_name)):
            key = f'{type_name}.{field}'
            if (custom_dir / f'{key}.js').exists():
                manifest[key] = 'custom'
            elif type_name == 'Mutation':
                manifest[key] = 'mutation'
            else:
                manifest[key] = 'list' if is_list(return_type) else 'object'

    print(json.dumps({'manifest_json': json.dumps(manifest)}))


if __name__ == '__main__':
    main()
