import { api } from '../../api';
import type { CreateManagedSubsiteInput, ManagedSubsite, MultiSubsiteSettings, UpdateManagedSubsiteInput } from './types';

export const multiSubsiteApi = {
  list: (): Promise<ManagedSubsite[]> => api.listManagedSubsites(),
  create: (input: CreateManagedSubsiteInput): Promise<ManagedSubsite> => api.createManagedSubsite(input),
  update: (id: number, input: UpdateManagedSubsiteInput): Promise<ManagedSubsite> => api.updateManagedSubsite(id, input),
  resetPassword: (id: number, adminPassword: string): Promise<{ success: boolean; message: string }> => api.resetSubsitePassword(id, adminPassword),
  delete: (id: number, purgeDatabase = false): Promise<{ success: boolean; slug: string; domain: string }> => api.deleteManagedSubsite(id, purgeDatabase),
  setEnabled: (id: number, enabled: boolean): Promise<ManagedSubsite> => api.setManagedSubsiteEnabled(id, enabled),
  getSettings: (): Promise<MultiSubsiteSettings> => api.getMultiSubsiteSettings(),
  saveSettings: (settings: MultiSubsiteSettings): Promise<MultiSubsiteSettings> => api.saveMultiSubsiteSettings(settings),
};
