import { Router } from "express";
import { verifyToolSecret } from "../middleware/verifyToolSecret";
import { handleLookupCustomer } from "./lookupCustomer";
import { handleCheckAvailability } from "./checkAvailability";
import { handleCreateLead } from "./createLead";
import { handleBookJob } from "./bookJob";
import { handleCreatePotentialLead } from "./createPotentialLead";

export const toolsRouter = Router();

toolsRouter.use(verifyToolSecret);
toolsRouter.post("/lookup-customer", handleLookupCustomer);
toolsRouter.post("/check-availability", handleCheckAvailability);
toolsRouter.post("/create-lead", handleCreateLead);
toolsRouter.post("/book-job", handleBookJob);
toolsRouter.post("/create-potential-lead", handleCreatePotentialLead);
