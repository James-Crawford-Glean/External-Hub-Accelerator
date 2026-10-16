// Admin > AWS: console deep links for this environment, built from the
// VITE_AWS_* values the deploy workflow injects.
import { ExternalLink } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { APP_ENV, APP_VERSION, AWS_REGION } from '../lib/api/config';
import { awsLinks } from '../lib/awsLinks';

export function AwsView() {
  const links = awsLinks();
  return (
    <div>
      <header className="ps-page__header">
        <div>
        <h1 className="ps-page-title">AWS</h1>
        <p className="ps-page-subtitle">
          Environment <strong>{APP_ENV}</strong> · region {AWS_REGION} · build {APP_VERSION}
        </p>
        </div>
      </header>
      <Card>
        <CardHeader title="Console" subtitle="Dashboards and resources for this environment." />
        <CardBody flush>
          {links.length === 0 ? (
            <EmptyState title="No links configured" body="Set the VITE_AWS_* variables at build time to enable console deep links." />
          ) : (
            <table className="ps-table">
              <tbody>
                {links.map((l) => (
                  <tr key={l.label}>
                    <td style={{ fontWeight: 600 }}>{l.label}</td>
                    <td className="ps-text-subtle">{l.detail}</td>
                    <td style={{ textAlign: 'right' }}>
                      <a href={l.url} target="_blank" rel="noreferrer" aria-label={`Open ${l.label}`}>
                        <ExternalLink size={14} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
