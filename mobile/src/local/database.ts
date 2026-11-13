import * as SQLite from 'expo-sqlite';
import { LOCAL_SCHEMA_V1, LOCAL_SCHEMA_VERSION } from './schema';

let opening: Promise<SQLite.SQLiteDatabase> | undefined;

/** Open only the new on-device database, never the existing development backend. */
export function openLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) opening = initialize().catch(error => { opening = undefined; throw error; });
  return opening;
}

async function initialize(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('meal-muse-local.db');
  try {
    await db.execAsync('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    if (version > LOCAL_SCHEMA_VERSION) throw new Error('本地数据由较新版本创建，请先更新 App');
    if (version === 0) {
      await db.withExclusiveTransactionAsync(async tx => {
        // Check again inside the transaction so concurrent initialization cannot overwrite data.
        const current = (await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
        if (current !== 0) return;
        await tx.execAsync(LOCAL_SCHEMA_V1);
        await tx.execAsync(`PRAGMA user_version=${LOCAL_SCHEMA_VERSION}`);
      });
    }
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}
