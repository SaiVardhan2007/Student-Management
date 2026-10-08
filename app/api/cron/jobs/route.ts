import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { sendDeadlineReminders } from '@/services/jobs';
import { announceDueNotices } from '@/services/notice.service';

export const dynamic = 'force-dynamic';

// Scheduled-jobs endpoint for serverless hosts (Vercel Cron), where the in-process hourly timer cannot run.
// Vercel sends "Authorization: Bearer $CRON_SECRET" automatically when CRON_SECRET is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  await connectDB();
  const [reminded] = await Promise.all([sendDeadlineReminders(), announceDueNotices()]);
  return NextResponse.json({ success: true, reminded });
}
