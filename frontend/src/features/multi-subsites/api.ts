import { api } from '../../api';
import type { CreateManagedSubsiteInput, ManagedSubsite, MultiSubsiteSettings } from './types';

export const multiSubsiteApi = {
  list: (): Promise<ManagedSubsite[]> => api.listManagedSubsites(),
  create: (input: CreateManagedSubsiteInput): Promise<ManagedSubsite> => api.createManagedSubsite(input),
  setEnabled: (id: number, enabled: boolean): Promise<ManagedSubsite> => api.setManagedSubsiteEnabled(id, enabled),
  getSettings: (): Promise<MultiSubsiteSettings> => api.getMultiSubsiteSettings(),
  saveSettings: (settings: MultiSubsiteSettings): Promise<MultiSubsiteSettings> => api.saveMultiSubsiteSettings(settings),
};
