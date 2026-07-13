import { Router } from "express";
import fs from "node:fs";
import { buildCallDetailViewModel, computeCallFlags, matchesBadgeFilters } from "./callDetails";
import type { CallListFilters } from "./callDetails";
import { renderCallDetailPage, renderCallNotFoundPage, renderCallListPage } from "./views";
import { getCallRecord, listCallRecords } from "../db/callRecords";
import { findCreateLeadLogByConversationId, findBookJobLogByConversationId } from "../db/callLog";
import { limitCallPageRequests, limitCallAudioRequests } from "../middleware/dashboardRateLimiter";
import { requireAdminSession } from "../middleware/requireAdminSession";

export const dashboardRouter = Router();

// Intentionally NO router-wide auth gate. The detail/audio routes below are
// meant to be link-shareable like an unlisted YouTube video: anyone holding
// the exact conversationId URL can view/hear it, no login. Do NOT reflexively
// add `dashboardRouter.use(requireAdminSession)` back here — that would
// break those two intentionally-public routes. The `/calls` list route below
// is a fundamentally different exposure (a browsable list of every call) and
// brings its own explicit `requireAdminSession` for that reason.
//
// Since the URL itself is the only access control for the public routes,
// harden it the way an unlisted link needs: never indexable/discoverable,
// and never leaked to a third party via the Referer header when the page's
// one outbound link (to ServiceTitan) is clicked.
dashboardRouter.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

dashboardRouter.get("/calls", requireAdminSession, (req, res) => {
  const { business } = req;
  if (!business) {
    res.status(404).end();
    return;
  }

  const query = req.query as Record<string, string | undefined>;
  const filters: CallListFilters = {
    failedTransfer: query.failedTransfer === "1",
    noBookingCreated: query.noBookingCreated === "1",
    endedEarly: query.endedEarly === "1",
    from: query.from || undefined,
    to: query.to || undefined,
  };

  const records = listCallRecords(business.id, 50, { from: filters.from, to: filters.to });
  const rows = records
    .map((record) => ({
      record,
      flags: computeCallFlags(business, record),
      leadLog: findCreateLeadLogByConversationId(business.id, record.conversation_id),
      jobLog: findBookJobLogByConversationId(business.id, record.conversation_id),
    }))
    .filter((row) => matchesBadgeFilters(row.flags, filters));

  res.send(renderCallListPage(business, rows, filters));
});

dashboardRouter.get("/calls/:conversationId", limitCallPageRequests, (req, res) => {
  const { business } = req;
  const { conversationId } = req.params;
  if (!business) {
    res.status(404).end();
    return;
  }
  const viewModel = buildCallDetailViewModel(business, conversationId);
  if (!viewModel) {
    res.status(404).send(renderCallNotFoundPage(conversationId));
    return;
  }
  res.send(renderCallDetailPage(viewModel));
});

dashboardRouter.get("/calls/:conversationId/audio", limitCallAudioRequests, (req, res) => {
  const { business } = req;
  const { conversationId } = req.params;
  if (!business) {
    res.status(404).end();
    return;
  }
  const record = getCallRecord(business.id, conversationId);
  if (!record?.audio_path || !fs.existsSync(record.audio_path)) {
    res.status(404).end();
    return;
  }

  // Browsers stream <audio> via HTTP Range requests (fetching the file in
  // chunks rather than all at once) — serving the full file with a plain 200
  // regardless of the Range header caused playback to stop after only the
  // first chunk the browser requested. Must respond 206 with the exact
  // requested byte range for playback to work past the first few seconds.
  const fileSize = fs.statSync(record.audio_path).size;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": fileSize,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(record.audio_path).pipe(res);
    return;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  if (start >= fileSize || end >= fileSize || start > end) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  res.writeHead(206, {
    "Content-Type": "audio/mpeg",
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
  });
  fs.createReadStream(record.audio_path, { start, end }).pipe(res);
});
