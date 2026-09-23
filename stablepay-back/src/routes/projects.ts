import { Router } from "express";
import { requireAuth, optionalAuth } from "../auth";
import { validate } from "../middleware/validate";
import {
  SeedProjectBody,
  MetadataBody,
  RenameTitleBody,
  DeliveryBody,
  DisputeBody,
} from "../validators/projectSchemas";
import {
  seedProject,
  saveMetadata,
  renameProjectTitle,
  getProjectDetail,
  getProjectsByAddress,
  getMilestones,
  getEvents,
  saveDelivery,
  saveDisputeReason,
  saveEscalationReason,
} from "../controllers/projectsController";

const router = Router();

router.post("/seed", requireAuth, validate(SeedProjectBody), seedProject);
router.post("/metadata", requireAuth, validate(MetadataBody), saveMetadata);
router.get("/detail/:escrowAddress", optionalAuth, getProjectDetail);
router.patch("/:escrowAddress/title", requireAuth, validate(RenameTitleBody), renameProjectTitle);
router.get("/:address", optionalAuth, getProjectsByAddress);
router.get("/:escrowAddress/milestones", optionalAuth, getMilestones);
router.get("/:escrowAddress/events", getEvents);
router.post("/:escrowAddress/milestones/:index/delivery", requireAuth, validate(DeliveryBody), saveDelivery);
router.post("/:escrowAddress/milestones/:index/dispute", requireAuth, validate(DisputeBody), saveDisputeReason);
router.post("/:escrowAddress/milestones/:index/escalation-reason", requireAuth, saveEscalationReason);

export default router;
