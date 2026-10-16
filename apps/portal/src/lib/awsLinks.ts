// Admin > AWS console deep links, built from the VITE_AWS_* env. Any link whose
// required value is empty is dropped rather than rendered broken.
import { APP_ENV, AWS_ACCOUNT_ID, AWS_BILLING_DASHBOARD_NAME, AWS_DASHBOARD_NAME, AWS_REGION, PORTAL_NAME } from './api/config';

export interface AwsLink {
  label: string;
  detail: string;
  url: string;
}

const dashboardUrl = (region: string, name: string) =>
  `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#dashboards/dashboard/${name}`;

export function awsLinks(): AwsLink[] {
  const env = APP_ENV === 'local' ? '' : APP_ENV;
  const project = PORTAL_NAME.toLowerCase();
  const links: Array<AwsLink | null> = [
    AWS_DASHBOARD_NAME
      ? { label: 'Overview dashboard', detail: AWS_DASHBOARD_NAME, url: dashboardUrl(AWS_REGION, AWS_DASHBOARD_NAME) }
      : null,
    env ? { label: 'Performance dashboard', detail: `${project}-${env}-perf`, url: dashboardUrl(AWS_REGION, `${project}-${env}-perf`) } : null,
    AWS_BILLING_DASHBOARD_NAME
      ? { label: 'Billing dashboard', detail: AWS_BILLING_DASHBOARD_NAME, url: dashboardUrl('us-east-1', AWS_BILLING_DASHBOARD_NAME) }
      : null,
    env
      ? {
          label: 'Lambda functions',
          detail: `${project}-*-${env}`,
          url: `https://${AWS_REGION}.console.aws.amazon.com/lambda/home?region=${AWS_REGION}#/functions?fo=and&k0=functionName&o0=%3A&v0=-${env}`,
        }
      : null,
    env
      ? {
          label: 'Aurora cluster',
          detail: `${project}-aurora-${env}`,
          url: `https://${AWS_REGION}.console.aws.amazon.com/rds/home?region=${AWS_REGION}#database:id=${project}-aurora-${env};is-cluster=true`,
        }
      : null,
    env
      ? {
          label: 'RUM (web vitals)',
          detail: `${project}-rum-${env}`,
          url: `https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#rum:dashboard/${project}-rum-${env}`,
        }
      : null,
    AWS_ACCOUNT_ID
      ? { label: 'Cost Explorer', detail: `account ${AWS_ACCOUNT_ID}`, url: `https://us-east-1.console.aws.amazon.com/cost-management/home#/cost-explorer` }
      : null,
  ];
  return links.filter((l): l is AwsLink => l !== null);
}
