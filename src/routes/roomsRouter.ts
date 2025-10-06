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

roomsRouter.get("/:userId", async (req: Request, res: Response) => {
  try {
    // Fetch rooms from the database
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }
    console.log("Fetching authId for user:", userId);
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
    console.log("Private rooms:", privateRooms);
    console.log("Public rooms:", publicRooms);
    res.json({ privateRooms, publicRooms });
  } catch (error) {
    console.error("Error fetching rooms:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

roomsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { userId, roomId, roomName, roomType } = req.body;
    if (!userId || !roomId) {
      return res.status(400).json({ error: "Missing userId or roomId" });
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

export default roomsRouter;
