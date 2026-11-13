import type { SQLiteDatabase } from 'expo-sqlite';
import { CATALOG_COLUMNS } from './catalog-seed.ts';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;
const COLUMNS: Readonly<Record<string, readonly string[]>> = {
  ...CATALOG_COLUMNS,
  family_meal_profile: ['id', 'people_count', 'category_counts_json', 'updated_at'],
  meal_records: ['id', 'meal_date', 'people_count', 'dishes', 'creation_key', 'last_request_key', 'payload_hash', 'revision', 'confirmed_at', 'updated_at', 'deleted_at'],
};
export type LocalBackup = { format: 'meal-muse-backup'; version: 1; created_at: string; tables: Record<string, Row[]> };

export async function createLocalBackup(db: SQLiteDatabase): Promise<LocalBackup> {
  const tables: Record<string, Row[]> = {};
  await db.withExclusiveTransactionAsync(async tx => {
    for (const [name, columns] of Object.entries(COLUMNS)) {
      tables[name] = await tx.getAllAsync<Row>(`SELECT ${columns.join(',')} FROM ${name}`);
    }
  });
  return { format: 'meal-muse-backup', version: 1, created_at: new Date().toISOString(), tables };
}

export function validateLocalBackup(input: unknown): asserts input is LocalBackup {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('备份文件格式不正确');
  const backup = input as Partial<LocalBackup>;
  if (backup.format !== 'meal-muse-backup' || backup.version !== 1 || typeof backup.created_at !== 'string' || !backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) throw new Error('备份文件格式或版本不支持');
  const expected = Object.keys(COLUMNS);
  const tables = backup.tables;
  if (Object.keys(tables).length !== expected.length || expected.some(name => !Object.hasOwn(tables, name))) throw new Error('备份文件缺少必要的数据表');
  for (const [name, columns] of Object.entries(COLUMNS)) {
    const rows = tables[name];
    if (!Array.isArray(rows) || rows.length > 50000) throw new Error('备份文件数据不正确');
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== columns.length || columns.some(c => !Object.hasOwn(row, c) || row[c] !== null && typeof row[c] !== 'string' && (typeof row[c] !== 'number' || !Number.isFinite(row[c])))) throw new Error('备份文件数据不正确');
    }
  }
}

/** Replace existing local data only after the caller has obtained confirmation and made a separate backup. */
export async function restoreLocalBackup(db: SQLiteDatabase, input: unknown): Promise<void> {
  validateLocalBackup(input);
  await db.withExclusiveTransactionAsync(async tx => {
    // Plan rows may reference meal records. Drafts are deliberately not part of a backup.
    for (const table of ['rule_plans', 'meal_records', 'recipe_ingredients', 'ingredient_names', 'recipes', 'ingredients', 'family_meal_profile', 'dish_categories']) await tx.runAsync(`DELETE FROM ${table}`);
    for (const [name, columns] of Object.entries(COLUMNS)) {
      const sql = `INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
      for (const row of input.tables[name] ?? []) await tx.runAsync(sql, columns.map(c => row[c] ?? null));
    }
    const invalid = await tx.getFirstAsync('PRAGMA foreign_key_check');
    if (invalid) throw new Error('备份数据关联不完整，未进行恢复');
    await tx.runAsync("INSERT OR REPLACE INTO local_metadata(key,value) VALUES ('catalog_seed_installed','1')");
  });
}
