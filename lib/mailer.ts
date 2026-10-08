// Sends email through SMTP (nodemailer). When SMTP is not configured the message is written to the log instead,
// so local development works without a mail server.
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

let transport: Transporter | null = null;

/** Send a plain-text email. Never throws: a mail failure is logged and reported as `false`. */
export async function sendMail(to: string | string[], subject: string, text: string): Promise<boolean> {
  const smtp = env.smtp;
  if (!smtp) {
    logger.info(`[MAIL not sent - SMTP_HOST is not set] to=${[to].flat().join(',')} subject="${subject}"\n${text}`);
    return false;
  }
  try {
    transport ??= nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    await transport.sendMail({ from: env.mailFrom, to, subject, text });
    return true;
  } catch (err: any) {
    logger.error(`Failed to send mail to ${[to].flat().join(',')}: ${err.message}`);
    return false;
  }
}
