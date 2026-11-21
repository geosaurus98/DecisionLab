/**
 * Review reminders. DecisionLab has no server, so it cannot push notifications on its own;
 * instead, when the app is opened (or the installed PWA is launched) it shows at most one
 * local notification per day listing how many decisions are due for review. Opt-in only.
 * The notification text never contains amounts or decision details.
 */
import { db } from './db';
import { getSetting, setSetting } from './settings';
import { todayIso } from '@/domain/dates';

export const REMINDER_KEY = 'reviewReminders';

export interface ReminderSettings {
  enabled: boolean;
  lastNotified?: string;
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function countDueReviews(today = todayIso()): Promise<number> {
  return db.decisions
    .where('reviewDate')
    .belowOrEqual(today)
    .filter((d) => d.status === 'decided' || d.status === 'completed')
    .count();
}

/** Ask for permission and enable reminders. Returns whether notifications are now allowed. */
export async function enableReminders(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  const ok = permission === 'granted';
  await setSetting<ReminderSettings>(REMINDER_KEY, { enabled: ok });
  return ok;
}

export async function disableReminders(): Promise<void> {
  await setSetting<ReminderSettings>(REMINDER_KEY, { enabled: false });
}

/** Called on start-up: notify once per day if reminders are on and reviews are due. */
export async function maybeNotifyDueReviews(today = todayIso()): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const settings = await getSetting<ReminderSettings>(REMINDER_KEY, { enabled: false });
  if (!settings.enabled || settings.lastNotified === today) return;
  const due = await countDueReviews(today);
  if (due === 0) return;
  const title = 'DecisionLab';
  const body = due === 1 ? 'A decision is due for review.' : `${due} decisions are due for review.`;
  const options: NotificationOptions = { body, icon: './icon-192.png', tag: 'decisionlab-reviews' };
  const registration = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);
  if (registration) await registration.showNotification(title, options);
  else new Notification(title, options);
  await setSetting<ReminderSettings>(REMINDER_KEY, { ...settings, lastNotified: today });
}
