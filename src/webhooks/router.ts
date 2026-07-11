import { Router } from "express";
import { handlePostCallWebhook } from "./postCall";

export const webhooksRouter = Router();

webhooksRouter.post("/elevenlabs/post-call", handlePostCallWebhook);
