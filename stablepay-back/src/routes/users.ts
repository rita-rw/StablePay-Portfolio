import { Router } from "express";
import { requireAuth, optionalAuth } from "../auth";
import { validate } from "../middleware/validate";
import { RegisterUserBody } from "../validators/userSchemas";
import { registerUser, getUser, updateUserProfile } from "../controllers/usersController";
import { UpdateUserBody } from "../validators/userSchemas";

const router = Router();

router.post("/register", requireAuth, validate(RegisterUserBody), registerUser);
router.get("/:address", optionalAuth, getUser);
router.put("/:address", requireAuth, validate(UpdateUserBody), updateUserProfile);

export default router;
