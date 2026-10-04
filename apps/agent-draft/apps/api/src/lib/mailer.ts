import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

export interface Mailer {
  readonly configured: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

/**
 * SMTP mailer. When SMTP is not configured, `configured` is false and callers
 * fall back to surfacing the link to the admin instead of pretending to send.
 */
export function createMailer(config: Pick<AppConfig, 'SMTP_URL' | 'SMTP_FROM'>, log: Logger): Mailer {
  if (!config.SMTP_URL) {
    return {
      configured: false,
      send: () => Promise.reject(new Error('SMTP is not configured')),
    };
  }
  const transport: Transporter = nodemailer.createTransport(config.SMTP_URL);
  const from = config.SMTP_FROM ?? 'agent-platform@localhost';
  return {
    configured: true,
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text });
      log.info({ to, subject }, 'email sent');
    },
  };
}
