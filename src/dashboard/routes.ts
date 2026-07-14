import { Router } from "express";
import fs from "node:fs";
import { buildCallDetailViewModel } from "./callDetails";
import { renderCallDetailPage, renderCallNotFoundPage } from "./views";
import { getCallRecord } from "../db/callRecords";
import { limitCallPageRequests, limitCallAudioRequests } from "../middleware/dashboardRateLimiter";

export const dashboardRouter = Router();

// Intentionally NO router-wide auth gate. Both routes below are meant to be
// link-shareable like an unlisted YouTube video: anyone holding the exact
// conversationId URL can view/hear it, no login. Do NOT reflexively add
// `dashboardRouter.use(requireAdminSession)` back here — that would break
// this intentionally-public design. The browsable, authenticated call list
// now lives in the React SPA (see src/api/businessRouter.ts's GET /calls,
// gated by requireApiSession) — this router only ever served the two public
// routes below plus a since-removed HTML list route.
//
// Since the URL itself is the only access control for these public routes,
// harden it the way an unlisted link needs: never indexable/discoverable,
// and never leaked to a third party via the Referer header when the page's
// one outbound link (to ServiceTitan) is clicked.
dashboardRouter.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
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
