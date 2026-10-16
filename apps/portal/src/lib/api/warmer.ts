import { gql } from './graphql';

export interface WarmerConfig {
  enabled: boolean;
  concurrency: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

const FIELDS = `enabled concurrency updatedAt updatedBy`;

export async function fetchWarmerConfig(): Promise<WarmerConfig> {
  const data = await gql<{ warmerConfig: WarmerConfig }>(`query WarmerConfig { warmerConfig { ${FIELDS} } }`);
  return data.warmerConfig;
}

export async function setWarmerConfig(input: { enabled?: boolean; concurrency?: number }): Promise<WarmerConfig> {
  const data = await gql<{ setWarmerConfig: WarmerConfig }>(
    `mutation SetWarmerConfig($enabled: Boolean, $concurrency: Int) { setWarmerConfig(enabled: $enabled, concurrency: $concurrency) { ${FIELDS} } }`,
    input,
  );
  return data.setWarmerConfig;
}
