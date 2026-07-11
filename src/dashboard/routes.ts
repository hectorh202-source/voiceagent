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
  res.setHeader("Content-Type", "audio/mpeg");
  fs.createReadStream(record.audio_path).pipe(res);
});
