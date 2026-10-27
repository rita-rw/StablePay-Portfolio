import { Router } from "express";
import { requireAuth, requirePlatform } from "../auth";
import { validate } from "../middleware/validate";
import { getAdminProjects, getAdminDisputes, getAdminDisputeDetail, saveResolutionNote } from "../controllers/adminController";
import { ResolutionNoteBody } from "../validators/projectSchemas";

// Factory settings (fee, timers, tokens) have no routes here: the platform wallet
// calls the factory directly from the browser, so the backend holds no private key.

const router = Router();

router.get("/projects", requireAuth, requirePlatform, getAdminProjects);
router.get("/disputes", requireAuth, requirePlatform, getAdminDisputes);
router.get("/disputes/:escrowAddress", requireAuth, requirePlatform, getAdminDisputeDetail);
router.post("/disputes/:escrowAddress/milestones/:index/resolution-note", requireAuth, requirePlatform, validate(ResolutionNoteBody), saveResolutionNote);

export default router;
