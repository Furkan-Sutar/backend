export type DeliveryChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export interface NotificationPayload { recipient: string; subject: string; message: string; metadata?: Record<string, unknown> }
export interface NotificationProvider { readonly channel: DeliveryChannel; isConfigured(): boolean; send(payload: NotificationPayload): Promise<{ status: 'SENT' | 'SKIPPED_NOT_CONFIGURED'; providerMessageId?: string }> }

abstract class ConfigurableProvider implements NotificationProvider {
  abstract readonly channel: DeliveryChannel;
  protected abstract configurationPresent(): boolean;
  isConfigured() { return this.configurationPresent(); }
  async send(_payload: NotificationPayload) {
    if (!this.isConfigured()) return { status: 'SKIPPED_NOT_CONFIGURED' as const };
    // Configuration alone is not treated as delivery: a concrete replaceable transport adapter is still required.
    throw new Error(`${this.channel}_TRANSPORT_ADAPTER_NOT_INSTALLED`);
  }
}
export class EmailProvider extends ConfigurableProvider { readonly channel = 'EMAIL' as const; protected configurationPresent() { return Boolean(process.env.EMAIL_PROVIDER_URL && process.env.EMAIL_PROVIDER_API_KEY); } }
export class SMSProvider extends ConfigurableProvider { readonly channel = 'SMS' as const; protected configurationPresent() { return Boolean(process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_API_KEY); } }
export class WhatsAppProvider extends ConfigurableProvider { readonly channel = 'WHATSAPP' as const; protected configurationPresent() { return Boolean(process.env.WHATSAPP_PROVIDER_URL && process.env.WHATSAPP_PROVIDER_API_KEY); } }
export class NotificationProviderRegistry {
  constructor(private providers: Partial<Record<DeliveryChannel, NotificationProvider>> = {}) {}
  get(channel: DeliveryChannel) { return this.providers[channel]; }
  register(provider: NotificationProvider) { this.providers[provider.channel] = provider; }
}
export const notificationProviders = new NotificationProviderRegistry({ EMAIL: new EmailProvider(), SMS: new SMSProvider(), WHATSAPP: new WhatsAppProvider() });
