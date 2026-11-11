import { createLocalDataServices, type LocalDataServices } from '../data/local-data-service';
import { CredentialVault } from './credential-vault';
import { createProviderRegistry } from './provider-registry';

export interface ProviderRuntime {
  data: LocalDataServices;
  credentials: CredentialVault;
  close(): void;
}

export async function createProviderRuntime(): Promise<ProviderRuntime> {
  const data = await createLocalDataServices();
  try {
    return {
      data,
      credentials: new CredentialVault(data.credentials),
      close: () => data.close(),
    };
  } catch (error) {
    data.close();
    throw error;
  }
}

export const providerRegistry = createProviderRegistry();
