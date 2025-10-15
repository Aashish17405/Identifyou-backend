import { Router, type Request, type Response } from "express";
import prisma from "../utils/prisma";

const router = Router();

router.get("/questions/:authId", async (req: Request, res: Response) => {
  const { authId } = req.params;
  console.log(authId);

  if (!authId) {
    return res.status(400).json({ error: "Missing authId parameter" });
  }

  try {
    const questionnaireResponse = await prisma.questionnaireResponse.findFirst({
      where: { userId: authId },
    });
    const questionnaireId = questionnaireResponse?.questionnaireId;

    if (!questionnaireId) {
      return res
        .status(404)
        .json({ error: "Questionnaire not found for the given authId" });
    }

    const questions = await prisma.question.findMany({
      where: questionnaireId
        ? {
            questionnaireId: questionnaireId,
          }
        : {},
      include: {
        options: true,
      },
    });
    res.json(questions);
  } catch (error) {
    console.error("Error fetching questionnaire questions:", error);
    res.status(500).json({ error: "Failed to fetch questionnaire questions" });
  }
});

// Store questionnaire responses
router.post("/responses/create", async (req: Request, res: Response) => {
  try {
    const { userId, questionnaireId } = req.body;

    const existingResponse = await prisma.questionnaireResponse.findFirst({
      where: { userId: userId, questionnaireId: questionnaireId },
    });

    if (existingResponse) {
      const lastQuestion = await prisma.question.findFirst({
        where: { questionnaireId: questionnaireId , order: 6 }
      })
      console.log("Last question:", lastQuestion);
      if(!lastQuestion) {
        return res
        .status(500)
        .json({ error: "Failed to verify questionnaire completion" });
      }
      const answerId = await prisma.answer.findFirst({
        where: { responseId: existingResponse.id, questionId: lastQuestion?.id }
      })
      if (answerId) {
        return res
        .status(409)
        .json({ error: "Questionnaire already completed for this user" });
      }
      return res
        .status(206)
        .json({ error: "Questionnaire response exists, but user has to answer all the questions" });
    }

    const questionnaireResponse = await prisma.questionnaireResponse.create({
      data: {
        userId: userId,
        questionnaireId: questionnaireId,
      },
    });

    res.status(201).json(questionnaireResponse);
  } catch (error) {
    console.error("Error storing questionnaire response:", error);
    res.status(500).json({ error: "Failed to store questionnaire responses" });
  }
});

// Get questionnaire responses for a user
router.get("/responses/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }

    const responses = await prisma.questionnaireResponse.findMany({
      where: { userId: userId },
    });

    res.json(responses);
  } catch (error) {
    console.error("Error fetching questionnaire responses:", error);
    res.status(500).json({ error: "Failed to fetch questionnaire responses" });
  }
});

router.post("/responses", async (req: Request, res: Response) => {
  try {
    const { questionId, authId, selectedOption } = req.body;

    if (!questionId || !authId || !selectedOption) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const userResponse = await prisma.questionnaireResponse.findFirst({
      where: { userId: authId },
    });

    const responseId = userResponse?.id;
    if (!responseId) {
      return res
        .status(404)
        .json({
          error: "Questionnaire response not found for the given authId",
        });
    }

    // Handle both single select and multi-select questions
    const selectedOptions = Array.isArray(selectedOption) ? selectedOption : [selectedOption];
    
    console.log(`📝 Saving ${selectedOptions.length} answer(s) for question ${questionId}`);

    // Delete existing answers for this question (to handle answer changes)
    await prisma.answer.deleteMany({
      where: {
        responseId: responseId,
        questionId: questionId,
      },
    });

    // Create new answers (one for each selected option in multi-select)
    const createdAnswers = await Promise.all(
      selectedOptions.map((optionId) =>
        prisma.answer.create({
          data: {
            responseId: responseId,
            questionId: questionId,
            selectedOptionId: optionId,
          },
        })
      )
    );

    console.log(`✅ Created ${createdAnswers.length} answer(s)`);

    res.status(201).json({
      success: true,
      answers: createdAnswers,
      count: createdAnswers.length,
    });
  } catch (error) {
    console.error("Error storing questionnaire answer:", error);
    res.status(500).json({ error: "Failed to store questionnaire answer" });
  }
});

// Generate and store room recommendations based on questionnaire answers
router.post("/recommendations", async (req: Request, res: Response) => {
  try {
    const { authId } = req.body;

    if (!authId) {
      return res.status(400).json({ error: "Missing authId parameter" });
    }

    console.log("🎯 Generating room recommendations for user:", authId);

    // 1. Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: authId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 2. Get user's questionnaire response
    const questionnaireResponse = await prisma.questionnaireResponse.findFirst({
      where: { userId: authId },
      include: {
        answers: {
          include: {
            question: true,
            selectedOption: true,
          },
        },
      },
    });

    if (!questionnaireResponse) {
      return res.status(404).json({
        error: "No questionnaire responses found for this user",
      });
    }

    console.log(
      "📝 Found questionnaire response with answers:",
      questionnaireResponse.answers.length
    );

    // 2.5. Verify user has answered ALL questions in the questionnaire
    const totalQuestions = await prisma.question.count({
      where: { questionnaireId: questionnaireResponse.questionnaireId },
    });

    const answeredQuestions = questionnaireResponse.answers.length;

    console.log(
      `📊 Questions status: ${answeredQuestions}/${totalQuestions} answered`
    );

    if (answeredQuestions < totalQuestions) {
      return res.status(400).json({
        error: "Questionnaire incomplete",
        message: `Please answer all questions before generating recommendations. Answered: ${answeredQuestions}/${totalQuestions}`,
        answeredQuestions,
        totalQuestions,
        remainingQuestions: totalQuestions - answeredQuestions,
      });
    }

    console.log("✅ All questions answered - proceeding with recommendations");

    // 3. Parse answers into a usable format
    const answers: Record<string, any> = {};
    const multiSelectAnswers: Record<string, string[]> = {};

    for (const answer of questionnaireResponse.answers) {
      const questionText = answer.question.questionText;
      const optionValue = answer.selectedOption?.optionValue;

      // Map question text to field names (based on OnboardingQuestionnaire component)
      if (questionText.includes("age range")) {
        answers.age = optionValue;
      } else if (questionText.includes("How do you identify")) {
        answers.gender = optionValue;
      } else if (questionText.includes("main area of concern")) {
        answers.mainConcern = optionValue;
      } else if (questionText.includes("type of support")) {
        answers.supportType = optionValue;
      } else if (questionText.includes("similar platforms")) {
        answers.experience = optionValue;
      } else if (questionText.includes("hope to achieve")) {
        // Multi-select - collect all goals
        if (!multiSelectAnswers.goals) {
          multiSelectAnswers.goals = [];
        }
        if (optionValue) {
          multiSelectAnswers.goals.push(optionValue);
        }
      }
    }

    answers.goals = multiSelectAnswers.goals || [];
    console.log("📊 Parsed answers:", answers);

    // 4. Generate room recommendations based on answers (same logic as frontend)
    const recommendedRoomNames: string[] = [];

    // Based on main concern
    if (answers.mainConcern === "bullying") {
      recommendedRoomNames.push("Anti Bullying");
    }
    if (answers.mainConcern === "domestic-issues") {
      recommendedRoomNames.push("Domestic Issues");
    }
    if (answers.mainConcern === "identity-crisis") {
      recommendedRoomNames.push("Get Identified");
    }
    if (answers.mainConcern === "academic-stress") {
      recommendedRoomNames.push("Study Group");
    }
    if (answers.mainConcern === "mental-health") {
      recommendedRoomNames.push("Mental Health Support");
    }
    if (answers.mainConcern === "relationships") {
      recommendedRoomNames.push("Relationship Advice");
    }

    // Always include introductions for newcomers
    if (!recommendedRoomNames.includes("Introductions")) {
      recommendedRoomNames.push("Introductions");
    }

    // Add rooms based on support type
    if (answers.supportType === "peer-support") {
      if (!recommendedRoomNames.includes("General Support")) {
        recommendedRoomNames.push("General Support");
      }
    }
    if (answers.supportType === "professional-guidance") {
      if (!recommendedRoomNames.includes("Professional Help")) {
        recommendedRoomNames.push("Professional Help");
      }
    }
    if (answers.supportType === "anonymous-chat") {
      if (!recommendedRoomNames.includes("Anonymous Chat")) {
        recommendedRoomNames.push("Anonymous Chat");
      }
    }
    if (answers.supportType === "resource-sharing") {
      if (!recommendedRoomNames.includes("Resource Sharing")) {
        recommendedRoomNames.push("Resource Sharing");
      }
    }

    // Add rooms based on goals
    if (answers.goals && Array.isArray(answers.goals)) {
      if (answers.goals.includes("find-community")) {
        if (!recommendedRoomNames.includes("General Support")) {
          recommendedRoomNames.push("General Support");
        }
      }
      if (answers.goals.includes("help-others")) {
        if (!recommendedRoomNames.includes("Volunteer Hub")) {
          recommendedRoomNames.push("Volunteer Hub");
        }
      }
      if (answers.goals.includes("learn-coping")) {
        if (!recommendedRoomNames.includes("Coping Strategies")) {
          recommendedRoomNames.push("Coping Strategies");
        }
      }
      if (answers.goals.includes("build-confidence")) {
        if (!recommendedRoomNames.includes("Confidence Building")) {
          recommendedRoomNames.push("Confidence Building");
        }
      }
    }

    // Ensure we have at least some default rooms
    const finalRoomNames =
      recommendedRoomNames.length > 0
        ? recommendedRoomNames
        : ["Introductions", "General Support"];

    console.log("🎯 Recommended rooms:", finalRoomNames);

    // 5. Find or create these rooms in the database
    const rooms = [];
    const userRoomMemberships = [];

    for (const roomName of finalRoomNames) {
      // Check if room exists (public rooms)
      let room = await prisma.room.findFirst({
        where: {
          name: roomName,
          type: "RECOMMENDED",
        },
      });

      // If room doesn't exist, create it
      if (!room) {
        console.log(`📦 Creating new room: ${roomName}`);
        room = await prisma.room.create({
          data: {
            name: roomName,
            type: "RECOMMENDED",
            roomId: roomName.toLowerCase().replace(/\s+/g, "-"),
            createdBy: null, // System-created room
          },
        });
      }

      rooms.push(room);

      // 6. Add user to the room (if not already a member)
      const existingMembership = await prisma.userRoom.findFirst({
        where: {
          userId: authId,
          roomId: room.id,
        },
      });

      if (!existingMembership) {
        console.log(`➕ Adding user to room: ${roomName}`);
        const membership = await prisma.userRoom.create({
          data: {
            userId: authId,
            roomId: room.id,
          },
        });
        userRoomMemberships.push(membership);
      } else {
        console.log(`✓ User already member of room: ${roomName}`);
        userRoomMemberships.push(existingMembership);
      }
    }

    console.log(
      `✅ Successfully recommended and added user to ${rooms.length} rooms`
    );

    // 7. Return the recommended rooms
    res.status(200).json({
      success: true,
      message: `Successfully recommended ${rooms.length} rooms`,
      recommendedRooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        roomId: room.roomId,
        type: room.type,
      })),
      userRoomMemberships: userRoomMemberships.map((membership) => ({
        id: membership.id,
        roomId: membership.roomId,
        joinedAt: membership.joinedAt,
      })),
    });
  } catch (error) {
    console.error("❌ Error generating room recommendations:", error);
    res.status(500).json({
      error: "Failed to generate room recommendations",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Get recommended rooms for a user
router.get("/recommendations/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const userRooms = await prisma.userRoom.findMany({
      where: { userId: String(userId) },
      include: {
        room: true,
      },
    });

    res.json(userRooms);
  } catch (error) {
    console.error("Error fetching room recommendations:", error);
    res.status(500).json({ error: "Failed to fetch room recommendations" });
  }
});

export const questionnaireRouter = router;
