import type { SQLiteDatabase } from 'expo-sqlite';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;
type SeedTable = { name: string; columns: readonly string[]; rows: Row[] };

// Only catalogue tables can enter a distributable seed: never meal history or keys.
export const CATALOG_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  dish_categories: ['id', 'name', 'sort_order', 'is_active'],
  ingredients: ['id', 'name', 'ingredient_category', 'seasons_json', 'source', 'is_hidden', 'created_at', 'updated_at', 'deleted_at'],
  ingredient_names: ['normalized_name', 'ingredient_id', 'display_name', 'kind'],
  recipes: ['id', 'name', 'normalized_name', 'category_id', 'is_hearty', 'source', 'steps', 'notes', 'cook_time_minutes', 'flavor_tags', 'scene_tags', 'constraint_facts', 'is_hidden', 'created_at', 'updated_at', 'deleted_at'],
  recipe_ingredients: ['recipe_id', 'ingredient_id', 'is_main', 'quantity', 'unit', 'position'],
};

export async function installInitialCatalog(db: SQLiteDatabase, tables: SeedTable[]): Promise<boolean> {
  const names = Object.keys(CATALOG_COLUMNS);
  if (tables.length !== names.length || tables.some((table, index) => {
    const expected = names[index];
    return !expected || table.name !== expected || JSON.stringify(table.columns) !== JSON.stringify(CATALOG_COLUMNS[expected]);
  })) throw new Error('初始菜谱数据格式无效');

  let installed = false;
  await db.withExclusiveTransactionAsync(async tx => {
    if (await tx.getFirstAsync('SELECT value FROM local_metadata WHERE key=?', 'catalog_seed_installed')) return;
    // Never seed into a database containing user data from another source.
    for (const name of names) {
      const count = await tx.getFirstAsync<{ count: number }>(`SELECT count(*) AS count FROM ${name}`);
      if ((count?.count ?? 0) !== 0) throw new Error('已有食材或菜谱，不能覆盖初始化');
    }
    for (const table of tables) {
      const placeholders = table.columns.map(() => '?').join(',');
      const statement = `INSERT INTO ${table.name} (${table.columns.join(',')}) VALUES (${placeholders})`;
      for (const row of table.rows) {
        const values = table.columns.map(column => {
          const value = row[column];
          if (value === undefined || !['string', 'number'].includes(typeof value) && value !== null) throw new Error('初始菜谱数据格式无效');
          return value;
        });
        await tx.runAsync(statement, values);
      }
    }
    if (await tx.getFirstAsync('PRAGMA foreign_key_check')) throw new Error('初始菜谱数据关联不完整');
    await tx.runAsync('INSERT INTO local_metadata(key,value) VALUES (?,?)', 'catalog_seed_installed', '1');
    installed = true;
  });
  return installed;
}

/** Apply a one-time verified season correction without replacing phone edits. */
export async function applySeasonCorrections(db:SQLiteDatabase, corrections:{id:string;before:string[];after:string[]}[]):Promise<number> {
  let changed=0;
  const same=(a:string[],b:string[])=>a.length===b.length&&a.every(v=>b.includes(v));
  await db.withExclusiveTransactionAsync(async tx=>{
    if(await tx.getFirstAsync('SELECT value FROM local_metadata WHERE key=?','season_correction_20261108'))return;
    for(const item of corrections){
      const row=await tx.getFirstAsync<{seasons_json:string}>('SELECT seasons_json FROM ingredients WHERE id=?',item.id);
      if(!row)continue;
      const current=JSON.parse(row.seasons_json) as string[];
      if(same(current,item.before)&&!same(current,item.after)){
        await tx.runAsync('UPDATE ingredients SET seasons_json=?,updated_at=? WHERE id=?',JSON.stringify(item.after),new Date().toISOString(),item.id);changed++;
      }
    }
    await tx.runAsync('INSERT INTO local_metadata(key,value) VALUES (?,?)','season_correction_20261108',String(changed));
  });
  return changed;
}
