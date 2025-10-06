import { Router, type Request, type Response } from "express";
import prisma from "../utils/prisma";

const userRouter = Router();

userRouter.get("/:authId", async (req: Request, res: Response) => {
  try {
    const { authId } = req.params;
    if (!authId) {
      return res.status(400).json({ error: "Missing authId parameter" });
    }
    const user = await prisma.user.findUnique({
      where: { id: authId },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error: Error | unknown) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Unknown error" });
    }
  }
});

userRouter.get("/", async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany();
    console.log(users);
    res.json(users);
  } catch (error: Error | unknown) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Unknown error" });
    }
  }
});

userRouter.post("/", async (req: Request, res: Response) => {
  const { username, persona, authId, email } = req.body;
  if (!username) {
    return res.status(400).json({ error: "username is required" });
  }
  try {
    console.log("Creating user:", req.body);
    const user = await prisma.user.create({
      data: { username: username, email: email, persona: persona, createdAt: new Date(), id: authId },
    });
    res.status(201).json(user);
  } catch (error: Error | unknown) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Unknown error" });
    }
  }
});

userRouter.put("/:authId", async (req: Request, res: Response) => {
  const { authId } = req.params;
  const { username, persona } = req.body;
  if (!authId) {
    return res.status(400).json({ error: "id is required" });
  }
  if (!username) {
    return res.status(400).json({ error: "username is required" });
  }
  try {
    const user = await prisma.user.update({
      where: { id: authId },
      data: { username: username, persona: persona || null },
    });
    res.json(user);
  } catch (error: Error | unknown) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Unknown error" });
    }
  }
});

export default userRouter;
