import { Router } from "express";
import fs from "node:fs";
import { requireAdminSession } from "../middleware/requireAdminSession";
import { buildCallDetailViewModel } from "./callDetails";
import { renderCallDetailPage, renderCallNotFoundPage } from "./views";
import { getCallRecord } from "../db/callRecords";

export const dashboardRouter = Router();

dashboardRouter.use(requireAdminSession);

dashboardRouter.get("/calls/:conversationId", (req, res) => {
  const { conversationId } = req.params;
  const viewModel = buildCallDetailViewModel(conversationId);
  if (!viewModel) {
    res.status(404).send(renderCallNotFoundPage(conversationId));
    return;
  }
  res.send(renderCallDetailPage(viewModel));
});

dashboardRouter.get("/calls/:conversationId/audio", (req, res) => {
  const { conversationId } = req.params;
  const record = getCallRecord(conversationId);
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
