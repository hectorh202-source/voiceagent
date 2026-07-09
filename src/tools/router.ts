import { Router } from "express";
import { verifyToolSecret } from "../middleware/verifyToolSecret";
import { handleLookupCustomer } from "./lookupCustomer";
import { handleCheckAvailability } from "./checkAvailability";
import { handleCreateLead } from "./createLead";

export const toolsRouter = Router();

toolsRouter.use(verifyToolSecret);
toolsRouter.post("/lookup-customer", handleLookupCustomer);
toolsRouter.post("/check-availability", handleCheckAvailability);
toolsRouter.post("/create-lead", handleCreateLead);
