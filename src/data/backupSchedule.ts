/**
 * Backup reminders and one-click backups.
 *
 * - The passphrase is never stored; it can be kept in memory for the current session only.
 * - Where the browser supports the File System Access API (desktop Chrome/Edge), a chosen
 *   folder is remembered (its handle is stored locally, never exported) and backups are written
 *   there; otherwise the backup is downloaded.
 */
import { db } from './db';
import { encryptJson, exportBackup } from './backup';
import { SETTING_KEYS } from './settings';
import { daysBetween, todayIso } from '@/domain/dates';

export interface BackupState {
  lastBackupAt?: string; // ISO timestamp
  /** Remind after this many days; 0 = never remind. */
  intervalDays: number;
  /** Display name of the chosen folder (the handle itself is stored separately). */
  folderName?: string;
}

export const DEFAULT_BACKUP_STATE: BackupState = { intervalDays: 14 };
export const FOLDER_HANDLE_KEY = 'backupFolderHandle';

/** Days since the last backup (null = never), and whether a reminder is due. */
export function backupStatus(state: BackupState, today: string, hasData: boolean): { daysSince: number | null; due: boolean } {
  const daysSince = state.lastBackupAt ? Math.max(0, daysBetween(state.lastBackupAt.slice(0, 10), today)) : null;
  const due = hasData && state.intervalDays > 0 && (daysSince === null || daysSince >= state.intervalDays);
  return { daysSince, due };
}

export async function getBackupState(): Promise<BackupState> {
  const rec = await db.settings.get(SETTING_KEYS.backup);
  return { ...DEFAULT_BACKUP_STATE, ...((rec?.value as Partial<BackupState>) ?? {}) };
}

export async function setBackupState(patch: Partial<BackupState>): Promise<void> {
  await db.settings.put({ key: SETTING_KEYS.backup, value: { ...(await getBackupState()), ...patch } });
}

export function folderBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export async function chooseBackupFolder(): Promise<string | null> {
  if (!folderBackupSupported()) return null;
  const handle = (await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' })) as DirHandle;
  await db.settings.put({ key: FOLDER_HANDLE_KEY, value: handle });
  await setBackupState({ folderName: handle.name });
  return handle.name;
}

export async function forgetBackupFolder(): Promise<void> {
  await db.settings.delete(FOLDER_HANDLE_KEY);
  await setBackupState({ folderName: undefined });
}

/** Session-only passphrase memory (cleared on reload). */
let sessionPassphrase: string | null = null;
export const rememberPassphraseForSession = (p: string | null) => {
  sessionPassphrase = p;
};
export const sessionPassphraseAvailable = () => sessionPassphrase !== null;

export interface BackupOutcome {
  fileName: string;
  savedTo: 'folder' | 'download';
  encrypted: boolean;
}

/**
 * Create a backup (encrypted when a passphrase is given or remembered for the session) and
 * save it to the chosen folder if permitted, otherwise return it for download.
 */
export async function runBackup(opts: { passphrase?: string | null; encrypt: boolean; download: (name: string, text: string) => void }): Promise<BackupOutcome> {
  const passphrase = opts.passphrase ?? sessionPassphrase;
  if (opts.encrypt && !passphrase) throw new Error('Enter a passphrase to create an encrypted backup.');
  const backup = await exportBackup();
  const text = opts.encrypt ? JSON.stringify(await encryptJson(backup, passphrase!)) : JSON.stringify(backup);
  const fileName = `decisionlab-${todayIso()}.decisionlab-backup${opts.encrypt ? '.enc' : ''}.json`;
  let savedTo: BackupOutcome['savedTo'] = 'download';
  const handle = (await db.settings.get(FOLDER_HANDLE_KEY))?.value as DirHandle | undefined;
  if (handle && folderBackupSupported()) {
    let perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
    if (perm === 'prompt') perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm === 'granted') {
      const file = await handle.getFileHandle(fileName, { create: true });
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
      savedTo = 'folder';
    }
  }
  if (savedTo === 'download') opts.download(fileName, text);
  await setBackupState({ lastBackupAt: new Date().toISOString() });
  return { fileName, savedTo, encrypted: opts.encrypt };
}
