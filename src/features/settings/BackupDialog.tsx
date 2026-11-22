import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Checkbox, Field, Input, Modal, Notice } from '@/ui/components';
import { db } from '@/data/db';
import { SETTING_KEYS } from '@/data/settings';
import { MIN_PASSPHRASE_LENGTH } from '@/data/backup';
import { backupStatus, DEFAULT_BACKUP_STATE, rememberPassphraseForSession, runBackup, sessionPassphraseAvailable, type BackupState } from '@/data/backupSchedule';
import { todayIso } from '@/domain/dates';
import { downloadText } from '@/ui/download';
import { useToast } from '@/ui/toast';

export function useBackupState(): BackupState {
  const rec = useLiveQuery(() => db.settings.get(SETTING_KEYS.backup), []);
  return { ...DEFAULT_BACKUP_STATE, ...((rec?.value as Partial<BackupState>) ?? {}) };
}

export function BackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const state = useBackupState();
  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const haveSession = sessionPassphraseAvailable();
  const needPass = encrypt && !haveSession;

  async function go() {
    setError(null);
    setBusy(true);
    try {
      if (needPass && passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      if (needPass && remember) rememberPassphraseForSession(passphrase);
      const out = await runBackup({ encrypt, passphrase: needPass ? passphrase : null, download: (n, t) => downloadText(n, t) });
      setPassphrase('');
      toast({ message: out.savedTo === 'folder' ? `Backup saved to “${state.folderName}” as ${out.fileName}.` : `Backup downloaded: ${out.fileName}.`, tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Back up now"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={go}>
            {busy ? 'Backing up…' : 'Back up'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <p className="text-ink-2">
          {state.folderName ? `Saves to your chosen folder “${state.folderName}”.` : 'Downloads a backup file. Keep it somewhere safe, away from this device.'}
        </p>
        <Checkbox label="Encrypt with a passphrase (recommended)" checked={encrypt} onChange={setEncrypt} />
        {needPass && (
          <>
            <Field label="Passphrase" htmlFor="bkd-pass" hint="If you forget it, the backup cannot be recovered. It is never stored.">
              <Input id="bkd-pass" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </Field>
            <Checkbox label="Remember it until I close this tab" hint="Kept in memory only, never written to disk." checked={remember} onChange={setRemember} />
          </>
        )}
        {encrypt && haveSession && <p className="text-xs text-muted">Using the passphrase you entered earlier in this session.</p>}
        {!encrypt && <Notice tone="warn">An unencrypted backup is a readable file containing all your financial data.</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}

/** Overview banner when a backup is due. */
export function BackupReminder({ hasData }: { hasData: boolean }) {
  const state = useBackupState();
  const [open, setOpen] = useState(false);
  const { daysSince, due } = backupStatus(state, todayIso(), hasData);
  if (!due) return null;
  return (
    <>
      <Notice tone="warn" title={daysSince === null ? 'You haven’t backed up yet' : `Last backup ${daysSince} days ago`}>
        Your data lives only in this browser; clearing site data or losing the device loses it.{' '}
        <button className="font-semibold text-accent underline" onClick={() => setOpen(true)}>
          Back up now
        </button>
      </Notice>
      <BackupDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
