// Per-app Lambda bundling. Each app exposes src/lambda.ts (the handler shim);
// esbuild emits one CJS bundle per app under dist/<app>/index.js, externalizing
// only the AWS SDK (provided by the Lambda Node runtime). Zipping is done by the
// Terraform archive_file at apply.
import { build } from 'esbuild';
import { readdirSync, existsSync } from 'node:fs';

const APPS_DIR = 'apps';

function discoverApps() {
  const entries = [];
  for (const app of readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const direct = `${APPS_DIR}/${app.name}/src/lambda.ts`;
    if (existsSync(direct)) {
      entries.push({ name: app.name, entry: direct });
      continue;
    }
    // one level of nesting (apps/workers/<worker>/src/lambda.ts)
    const sub = `${APPS_DIR}/${app.name}`;
    for (const child of readdirSync(sub, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const nested = `${sub}/${child.name}/src/lambda.ts`;
      if (existsSync(nested)) entries.push({ name: `${app.name}/${child.name}`, entry: nested });
    }
  }
  return entries;
}

const apps = discoverApps();
await Promise.all(
  apps.map(({ name, entry }) =>
    build({
      entryPoints: [entry],
      outfile: `dist/${name}/index.js`,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      minify: true,
      sourcemap: true,
      tsconfig: 'tsconfig.json',
      // AWS SDK v3 + the Lambda runtime globals are provided by the runtime.
      external: ['@aws-sdk/*'],
      loader: { '.html': 'text', '.mjml': 'text' },
    }),
  ),
);
console.log(`bundled ${apps.length} app(s): ${apps.map((a) => a.name).join(', ')}`);
