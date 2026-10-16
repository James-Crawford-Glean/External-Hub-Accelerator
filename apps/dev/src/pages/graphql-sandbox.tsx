import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

// The GraphQL Sandbox route. The Apollo embed touches the DOM and reads the
// signed-in session, so the real component is loaded client-only via
// <BrowserOnly> — nothing here runs during Docusaurus's static build.
export default function GraphqlSandboxPage(): React.ReactNode {
  return (
    <Layout title="GraphQL Sandbox" description="Interactive GraphQL client for the portal API" noFooter>
      <BrowserOnly fallback={<div style={{ padding: '1.5rem' }}>Loading sandbox…</div>}>
        {() => {
          const GraphqlSandbox = require('@site/src/components/GraphqlSandbox').default;
          return <GraphqlSandbox />;
        }}
      </BrowserOnly>
    </Layout>
  );
}
