import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVICE_CONFIG, type ServiceConfig } from '../../../config/services';

const { loadServiceConfigMock } = vi.hoisted(() => ({
  loadServiceConfigMock: vi.fn(),
}));

vi.mock('../../../config/onboarding', () => ({
  loadServiceConfig: loadServiceConfigMock,
}));

import { clearCaches, getClient, getConfiguredAccounts } from '../client';

class MockClientA {
  constructor(readonly config: { region: string; credentials?: unknown }) {}
}

class MockClientB {
  constructor(readonly config: { region: string; credentials?: unknown }) {}
}

function buildServiceConfig(): ServiceConfig {
  return {
    ...DEFAULT_SERVICE_CONFIG,
    aws: {
      accounts: [{ name: 'default', regions: ['us-west-2'], isDefault: true }],
      defaultRegion: 'us-west-2',
    },
  };
}

describe('AWS client config caching', () => {
  beforeEach(() => {
    clearCaches();
    loadServiceConfigMock.mockReset();
    loadServiceConfigMock.mockResolvedValue(buildServiceConfig());
  });

  it('reuses cached service config across client creations', async () => {
    await getClient(MockClientA);
    await getClient(MockClientB);

    expect(loadServiceConfigMock).toHaveBeenCalledTimes(1);
  });

  it('clearCaches invalidates cached service config', async () => {
    await getConfiguredAccounts();
    await getConfiguredAccounts();

    expect(loadServiceConfigMock).toHaveBeenCalledTimes(1);

    clearCaches();
    await getConfiguredAccounts();
    expect(loadServiceConfigMock).toHaveBeenCalledTimes(2);
  });
});
