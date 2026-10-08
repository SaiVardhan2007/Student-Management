// Razorpay calls this itself (no login), so it is authenticated by the signature of the raw body instead.
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { razorpayWebhook } from '@/services/fee.service';

export async function POST(request: Request) {
  if (!env.razorpay) return NextResponse.json({ success: false, message: 'Not configured' }, { status: 503 });
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature') || ''))
    return NextResponse.json({ success: false, message: 'Invalid signature' }, { status: 400 });
  try {
    await connectDB();
    await razorpayWebhook(JSON.parse(raw));
  } catch (err: any) {
    // a 5xx makes Razorpay retry; an unknown order (404) is not worth retrying
    logger.error('Razorpay webhook failed', err);
    return NextResponse.json({ success: false }, { status: err?.statusCode === 404 ? 200 : 500 });
  }
  return NextResponse.json({ success: true });
}
