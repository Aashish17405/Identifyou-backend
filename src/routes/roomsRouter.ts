import { Router, type Request, type Response } from "express";
import prisma from "../utils/prisma";

const roomsRouter = Router();

// Get room details by roomId
roomsRouter.get("/room/:roomId", async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ error: "Missing roomId parameter" });
    }
    
    console.log("Fetching room details for roomId:", roomId);
    const room = await prisma.room.findFirst({
      where: { roomId: roomId },
    });
    
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    console.log("Room found:", room);
    res.json(room);
  } catch (error) {
    console.error("Error fetching room details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

roomsRouter.get("/existing", async (req: Request, res: Response) => {
  try {
    const { userId, roomName, roomType } = req.query;

    console.log("Checking existing room with details:", { userId, roomName, roomType });

    if (!userId || !roomName || !roomType) {
      return res.status(400).json({ error: "Missing userId, roomName, or roomType query parameter" });
    }

    const existingRoom = await prisma.room.findFirst({
      where: { name: String(roomName), createdBy: String(userId), type: String(roomType) as "PUBLIC" | "PRIVATE" },
    });

    if(!existingRoom) {
      console.log("No existing room found with this name for the user.");
      res.json({ existingRoom: false });
      return;
    }

    res.json({ existingRoom: !!existingRoom });
  } catch (error) {
    console.error("Error checking existing room:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

roomsRouter.get("/:userId", async (req: Request, res: Response) => {
  try {
    // Fetch rooms from the database
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }
    console.log("Fetching rooms for user:", userId);
    const rooms = await prisma.userRoom.findMany({
      where: { userId: userId },
      include: { room: true },
    });
    const roomsCreatedByUser = await prisma.room.findMany({
      where: { createdBy: userId },
    });
    rooms.push(
      ...roomsCreatedByUser.map((room) => ({
        id: `${room.id}`,
        userId: userId,
        roomId: `${room.roomId}`,
        joinedAt: room.createdAt,
        leftAt: null,
        room: room,
      }))
    );
    const privateRooms = rooms
      .filter((ur) => ur.room.type === "PRIVATE")
      .map((ur) => ur.room);
    const publicRooms = rooms
      .filter((ur) => ur.room.type === "PUBLIC")
      .map((ur) => ur.room);
    const recommendedRooms = rooms
      .filter((ur) => ur.room.type === "RECOMMENDED")
      .map((ur) => ur.room);
    console.log("Private rooms:", privateRooms);
    console.log("Public rooms:", publicRooms);
    console.log("Recommended rooms:", recommendedRooms);
    res.json({ privateRooms, publicRooms, recommendedRooms });
  } catch (error) {
    console.error("Error fetching rooms:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

roomsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { userId, roomId, roomName, roomType } = req.body;
    if (!userId || !roomId || !roomName || !roomType) {
      return res.status(400).json({ error: "Missing userId, roomId, roomName, or roomType" });
    }

    const existingRoom = await prisma.room.findFirst({
      where: { name: roomName, createdBy: userId, type: roomType },
    });

    if (existingRoom) {
      console.log("Room with this name already exists for the user.");
      return res.status(409).json({ error: "Room with this details already exists." });
    }

    // Create a new userRoom entry
    const userRoom = await prisma.room.create({
      data: {
        name: roomName,
        type: roomType,
        createdBy: userId,
        roomId,
      },
    });
    res.status(201).json(userRoom);
  } catch (error) {
    console.error("Error creating user room:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

roomsRouter.delete("/", async (req: Request, res: Response) => {
  try {
    const { userId, roomId } = req.body;
    if (!userId || !roomId) {
      return res.status(400).json({ error: "Missing userId or roomId" });
    }

    // Delete the userRoom entry
    await prisma.room.deleteMany({
      where: { createdBy: userId, roomId: roomId },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting user room:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default roomsRouter;
