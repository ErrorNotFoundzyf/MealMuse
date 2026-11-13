import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createLocalBackup, restoreLocalBackup, validateLocalBackup, type LocalBackup } from './backup.ts';

const MAX_BYTES=30*1024*1024;
const filename=(prefix:string)=>`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}-${Crypto.randomUUID()}.json`;

/** Let Android grant access to one chosen folder, then save and read back. */
export async function saveLocalBackup(db:SQLiteDatabase):Promise<string> {
  const folder=await Directory.pickDirectoryAsync();
  const contents=JSON.stringify(await createLocalBackup(db));
  const file=folder.createFile(filename('meal-muse-backup'),'application/json');
  await file.write(contents);
  if(await file.text()!==contents)throw new Error('备份文件保存后校验失败，请重试');
  return file.name;
}

/** Opens Android's share sheet. The user must select a destination to keep the file. */
export async function shareLocalBackup(db:SQLiteDatabase):Promise<void> {
  if(!await Sharing.isAvailableAsync())throw new Error('当前设备无法分享备份文件');
  const file=new File(Paths.cache,filename('meal-muse-backup'));
  file.create({overwrite:false});
  await file.write(JSON.stringify(await createLocalBackup(db)));
  await Sharing.shareAsync(file.uri,{mimeType:'application/json',dialogTitle:'保存吃饭灵感备份'});
}

/** Select and validate first; the caller must show a confirmation before replacing any data. */
export async function pickLocalBackup():Promise<LocalBackup|null> {
  const result=await DocumentPicker.getDocumentAsync({type:['application/json','text/json','*/*'],copyToCacheDirectory:true,multiple:false});
  if(result.canceled)return null;
  const asset=result.assets[0];
  if(!asset)throw new Error('未读取到备份文件');
  const file=new File(asset.uri),size=asset.size??file.size;
  if(size===null||size>MAX_BYTES)throw new Error('备份文件过大或无法读取');
  let value:unknown;
  try{value=JSON.parse(await file.text());}catch{throw new Error('备份文件不是有效的 JSON');}
  validateLocalBackup(value);return value;
}

/** Keep a verified copy of current data before the transactional replacement. */
export async function restoreWithSafetyCopy(db:SQLiteDatabase,backup:LocalBackup):Promise<string> {
  validateLocalBackup(backup);
  const previous=JSON.stringify(await createLocalBackup(db));
  const safety=new File(Paths.document,filename('before-restore'));
  safety.create({overwrite:false});
  await safety.write(previous);
  if(await safety.text()!==previous)throw new Error('恢复前备份校验失败，数据未更改');
  await restoreLocalBackup(db,backup);
  return safety.uri;
}
