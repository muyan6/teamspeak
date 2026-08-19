export interface ManagedSubsite {
  id: number;
  slug: string;
  displayName: string;
  domain: string;
  ts3Host: string;
  queryPort: number;
  serverPort: number;
  serverId: number;
  username: string;
  publicHost: string;
  publicPort: number;
  enabled: boolean;
  connected: boolean;
  url: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateManagedSubsiteInput {
  displayName: string;
  slug: string;
  domain?: string;
  ts3Host: string;
  queryPort: number;
  serverPort: number;
  serverId: number;
  username: string;
  password: string;
  publicHost?: string;
  publicPort?: number;
  adminPassword: string;
}

export interface MultiSubsiteSettings {
  baseDomain: string;
}
