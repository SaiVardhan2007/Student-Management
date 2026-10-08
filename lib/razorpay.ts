// Razorpay gateway helpers: create an order (REST API) and check the signatures Razorpay sends back.
// No SDK: the API is one authenticated POST, and signatures are plain HMAC-SHA256.
import crypto from 'crypto';
import { env } from './env';
import { AppError } from './errors';

/** Keys from the environment, or a 503 when online payment is not configured. */
export function razorpayConfig() {
  const cfg = env.razorpay;
  if (!cfg) throw new AppError('Online payment is not configured', 503);
  return cfg;
}

/** Create a Razorpay order. `amount` is in rupees; Razorpay wants paise. */
export async function createRazorpayOrder(amount: number, receipt: string, notes: Record<string, string>) {
  const { keyId, keySecret } = razorpayConfig();
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt, notes }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new AppError(`Could not start the payment: ${data?.error?.description || res.statusText}`, 502);
  }
  return data as { id: string; amount: number; currency: string };
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Checkout signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const { keySecret } = razorpayConfig();
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC-SHA256 of the raw request body with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string) {
  const { webhookSecret } = razorpayConfig();
  if (!webhookSecret) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
