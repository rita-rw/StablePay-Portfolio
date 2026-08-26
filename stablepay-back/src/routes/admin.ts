import { Router } from "express";
import { requireAuth, requirePlatform } from "../auth";
import { validate } from "../middleware/validate";
import { getAdminProjects, getAdminDisputes, getAdminDisputeDetail } from "../controllers/adminController";
import {
  getFactorySettings,
  updatePlatformFee,
  updateAutoApprovalDays,
  updateDisputeTimeoutDays,
  updateCorrectionWindowDays,
  addApprovedToken,
  deleteApprovedToken,
} from "../controllers/adminSettingsController";
import {
  SetFeeBpsBody,
  SetAutoApprovalDaysBody,
  SetDisputeTimeoutDaysBody,
  SetCorrectionWindowDaysBody,
  ApproveTokenBody,
  RemoveTokenBody,
} from "../validators/adminSettingsSchemas";

const router = Router();

router.get("/projects", requireAuth, requirePlatform, getAdminProjects);
router.get("/disputes", requireAuth, requirePlatform, getAdminDisputes);
router.get("/disputes/:escrowAddress", requireAuth, requirePlatform, getAdminDisputeDetail);

router.get("/settings", requireAuth, requirePlatform, getFactorySettings);
router.post("/settings/fee", requireAuth, requirePlatform, validate(SetFeeBpsBody), updatePlatformFee);
router.post("/settings/auto-approval", requireAuth, requirePlatform, validate(SetAutoApprovalDaysBody), updateAutoApprovalDays);
router.post("/settings/dispute-timeout", requireAuth, requirePlatform, validate(SetDisputeTimeoutDaysBody), updateDisputeTimeoutDays);
router.post("/settings/correction-window", requireAuth, requirePlatform, validate(SetCorrectionWindowDaysBody), updateCorrectionWindowDays);
router.post("/settings/tokens/approve", requireAuth, requirePlatform, validate(ApproveTokenBody), addApprovedToken);
router.post("/settings/tokens/remove", requireAuth, requirePlatform, validate(RemoveTokenBody), deleteApprovedToken);

export default router;
