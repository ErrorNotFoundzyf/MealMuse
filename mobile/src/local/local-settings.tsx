import React from 'react';
import { LocalBackupSettings } from './backup-settings';
import { useLocalDatabase } from './local-provider';

export function LocalSettings() {
  const local=useLocalDatabase();
  if(!local)return null;
  return <><LocalBackupSettings db={local.db} onRestored={local.restored} /></>;
}
