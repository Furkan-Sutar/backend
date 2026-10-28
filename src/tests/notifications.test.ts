import { describe, expect, it } from 'vitest';
import { dailyNotificationDedupeKey, notificationIsAllowed, roleCanReceiveNotification } from '../services/notification.service.js';
import { EmailProvider, NotificationProviderRegistry, SMSProvider, WhatsAppProvider } from '../services/notification-providers.js';
import { NOTIFICATION_TYPES } from '../models/notification.model.js';

describe('notification permissions and preferences', () => {
  it('defines a required permission for every notification type', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(10);
    for (const type of NOTIFICATION_TYPES) expect(['OWNER_ADMIN', 'COUNSELLOR', 'TEACHER', 'ACCOUNTANT', 'STUDENT'].some((role) => roleCanReceiveNotification(role, type))).toBe(true);
  });

  it('blocks recipients without the mapped permission and respects per-user notification preferences', () => {
    expect(roleCanReceiveNotification('STUDENT', 'PENDING_EXPENSE_APPROVAL')).toBe(false);
    expect(notificationIsAllowed('OWNER_ADMIN', 'PENDING_EXPENSE_APPROVAL', { inAppEnabled: false })).toBe(false);
    expect(notificationIsAllowed('OWNER_ADMIN', 'PENDING_EXPENSE_APPROVAL', { disabledTypes: ['PENDING_EXPENSE_APPROVAL'] })).toBe(false);
    expect(notificationIsAllowed('OWNER_ADMIN', 'PENDING_EXPENSE_APPROVAL', { inAppEnabled: true, disabledTypes: [] })).toBe(true);
  });

  it('uses a stable per-recipient notification key for retry-safe daily deduplication', () => {
    const key = dailyNotificationDedupeKey('MISSED_FOLLOW_UP', 'SN-FUP-2026-00001', '2026-10-17');
    expect(key).toBe('MISSED_FOLLOW_UP:SN-FUP-2026-00001:2026-10-17');
    expect(dailyNotificationDedupeKey('MISSED_FOLLOW_UP', 'SN-FUP-2026-00001', '2026-10-17')).toBe(key);
    expect(dailyNotificationDedupeKey('MISSED_FOLLOW_UP', 'SN-FUP-2026-00001', '2026-10-18')).not.toBe(key);
  });
});

describe('replaceable notification providers', () => {
  it('does not send through unconfigured external providers', async () => {
    const old = { emailUrl: process.env.EMAIL_PROVIDER_URL, emailKey: process.env.EMAIL_PROVIDER_API_KEY, smsUrl: process.env.SMS_PROVIDER_URL, smsKey: process.env.SMS_PROVIDER_API_KEY, waUrl: process.env.WHATSAPP_PROVIDER_URL, waKey: process.env.WHATSAPP_PROVIDER_API_KEY };
    delete process.env.EMAIL_PROVIDER_URL; delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.SMS_PROVIDER_URL; delete process.env.SMS_PROVIDER_API_KEY;
    delete process.env.WHATSAPP_PROVIDER_URL; delete process.env.WHATSAPP_PROVIDER_API_KEY;
    try {
      const registry = new NotificationProviderRegistry({ EMAIL: new EmailProvider(), SMS: new SMSProvider(), WHATSAPP: new WhatsAppProvider() });
      for (const channel of ['EMAIL', 'SMS', 'WHATSAPP'] as const) {
        const provider = registry.get(channel)!;
        expect(provider.isConfigured()).toBe(false);
        await expect(provider.send({ recipient: 'user@example.test', subject: 'test', message: 'test' })).resolves.toEqual({ status: 'SKIPPED_NOT_CONFIGURED' });
      }
    } finally {
      if (old.emailUrl !== undefined) process.env.EMAIL_PROVIDER_URL = old.emailUrl;
      if (old.emailKey !== undefined) process.env.EMAIL_PROVIDER_API_KEY = old.emailKey;
      if (old.smsUrl !== undefined) process.env.SMS_PROVIDER_URL = old.smsUrl;
      if (old.smsKey !== undefined) process.env.SMS_PROVIDER_API_KEY = old.smsKey;
      if (old.waUrl !== undefined) process.env.WHATSAPP_PROVIDER_URL = old.waUrl;
      if (old.waKey !== undefined) process.env.WHATSAPP_PROVIDER_API_KEY = old.waKey;
    }
  });
});
