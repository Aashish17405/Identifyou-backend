// src/index.ts
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import userRouter from "./routes/userRoutes.js";
import roomsRouter from "./routes/roomsRouter.js";
import { questionnaireRouter } from "./routes/questionnaireRouter.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/questionnaire", questionnaireRouter);

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({ error: "Not Found" });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
