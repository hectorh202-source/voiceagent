import { listCallRecords } from "../db/callRecords";
import type { CallDateRange } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import type { CreateLeadLogRow } from "../db/callLog";
import { deriveStatus, deriveCallHandler } from "./callDetails";
import type { Business } from "../db/businesses";

export interface CallMetrics {
  totalCalls: number;
  // booked / (booked + not_booked) — Excused calls excluded from the
  // denominator; null (not 0) when there's no booking attempt at all to
  // compute a rate from, so the UI can show "—" instead of a misleading 0%.
  bookedRate: number | null;
  avgDurationSecs: number | null;
  callsPerDay: { date: string; count: number }[];
  // (emergency calls that were transferred) / totalCalls.
  emergencyTransferRate: number;
  // Minutes-usage tracking (billing visibility) — totalDurationSecs is the
  // headline number ("how many minutes did we use this period"), and
  // deliberately INCLUDES forwarded/transferred call time, not just AI-only
  // time. forwardedDurationSecs/aiOnlyDurationSecs split that same total
  // into the two handler types so a business can see how much of its usage
  // came from calls that got handed off to a human.
  totalDurationSecs: number;
  aiOnlyDurationSecs: number;
  forwardedDurationSecs: number;
  forwardedCallCount: number;
  durationSecsPerDay: { date: string; durationSecs: number }[];
}

// Effectively "every call in range" for metrics purposes — far above any
// realistic per-business call volume for a single date-range query.
const METRICS_QUERY_LIMIT = 10000;

// isEmergency only exists on calls that reached create_lead/book_job (it
// rides along in that tool call's own request body) — a call with neither
// has no signal and is treated as non-emergency here, same limitation
// computeCallFlags/buildCallDetailViewModel already have.
function parseIsEmergency(log: CreateLeadLogRow | undefined): boolean {
  if (!log) return false;
  try {
    const request = JSON.parse(log.request_json) as { isEmergency?: boolean };
    return request.isEmergency ?? false;
  } catch {
    return false;
  }
}

export function computeMetrics(business: Business, range: CallDateRange): CallMetrics {
  const records = listCallRecords(business.id, METRICS_QUERY_LIMIT, range);
  const totalCalls = records.length;

  let bookedCount = 0;
  let notBookedCount = 0;
  let durationSum = 0;
  let durationCount = 0;
  let emergencyTransferredCount = 0;
  let totalDurationSecs = 0;
  let forwardedDurationSecs = 0;
  let forwardedCallCount = 0;
  const perDay = new Map<string, number>();
  const durationPerDay = new Map<string, number>();

  for (const record of records) {
    const leadLog = findCreateLeadLogByConversationId(business.id, record.conversation_id);
    const jobLog = leadLog ? undefined : findBookJobLogByConversationId(business.id, record.conversation_id);

    const status = deriveStatus(leadLog, jobLog);
    if (status === "booked") bookedCount++;
    else if (status === "not_booked") notBookedCount++;

    const handler = deriveCallHandler(record);
    const isForwarded = handler === "ai_human";
    if (isForwarded) forwardedCallCount++;

    if (record.duration_secs !== null) {
      durationSum += record.duration_secs;
      durationCount++;
      // Deliberately included, not excluded — a forwarded call's AI-handled
      // portion is still real usage, and the caller wants a total that
      // matches what they'd actually be billed for.
      totalDurationSecs += record.duration_secs;
      if (isForwarded) forwardedDurationSecs += record.duration_secs;

      const day = record.received_at.slice(0, 10);
      durationPerDay.set(day, (durationPerDay.get(day) ?? 0) + record.duration_secs);
    }

    const isEmergency = parseIsEmergency(leadLog ?? jobLog);
    if (isEmergency && isForwarded) emergencyTransferredCount++;

    const day = record.received_at.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const bookedDenominator = bookedCount + notBookedCount;

  return {
    totalCalls,
    bookedRate: bookedDenominator > 0 ? bookedCount / bookedDenominator : null,
    avgDurationSecs: durationCount > 0 ? durationSum / durationCount : null,
    callsPerDay: Array.from(perDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    emergencyTransferRate: totalCalls > 0 ? emergencyTransferredCount / totalCalls : 0,
    totalDurationSecs,
    aiOnlyDurationSecs: totalDurationSecs - forwardedDurationSecs,
    forwardedDurationSecs,
    forwardedCallCount,
    durationSecsPerDay: Array.from(durationPerDay.entries())
      .map(([date, durationSecs]) => ({ date, durationSecs }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
