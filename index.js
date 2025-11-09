import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";

dotenv.config();
const app = express();
const port = process.env.PORT || 4000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- MongoDB Connection ---
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("ecoTrackDB");

    // Collections
    const challenges = db.collection("challenges");
    const userChallenges = db.collection("userChallenges");
    const tips = db.collection("tips");
    const events = db.collection("events");

    console.log(" MongoDB connected successfully!");

    // Get all challenges
    app.get("/api/challenges", async (req, res) => {
      const filter = req.query.category ? { category: req.query.category } : {};
      const result = await challenges.find(filter).toArray();
      res.json(result);
    });

    // Get single challenge by id
    app.get("/api/challenges/:id", async (req, res) => {
      const id = req.params.id;
      const result = await challenges.findOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    // Create new challenge
    app.post("/api/challenges", async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      data.updatedAt = new Date();
      const result = await challenges.insertOne(data);
      res.json(result);
    });

    // Update a challenge
    app.patch("/api/challenges/:id", async (req, res) => {
      const id = req.params.id;
      const updated = req.body;
      updated.updatedAt = new Date();
      const result = await challenges.updateOne(
        { _id: new ObjectId(id) },
        { $set: updated }
      );
      res.json(result);
    });

    // Delete a challenge
    app.delete("/api/challenges/:id", async (req, res) => {
      const id = req.params.id;
      const result = await challenges.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    // Join challenge (increments participants + adds to UserChallenges)
    app.post("/api/challenges/join/:id", async (req, res) => {
      const challengeId = req.params.id;
      const { userId } = req.body;

      // participants +1
      await challenges.updateOne(
        { _id: new ObjectId(challengeId) },
        { $inc: { participants: 1 } }
      );

      // add to userChallenges collection
      const userChallenge = {
        userId,
        challengeId: new ObjectId(challengeId),
        status: "Not Started",
        progress: 0,
        joinDate: new Date(),
      };
      const result = await userChallenges.insertOne(userChallenge);

      res.json({ message: "Joined successfully!", result });
    });

    app.get("/api/tips", async (req, res) => {
      const result = await tips.find().toArray();
      res.json(result);
    });

    app.post("/api/tips", async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await tips.insertOne(data);
      res.json(result);
    });

    // Upvote a tip
    app.post("/api/tips/upvote", async (req, res) => {
      const { title } = req.body;
      const result = await tips.updateOne({ title }, { $inc: { upvotes: 1 } });
      res.json(result);
    });

    app.get("/api/events", async (req, res) => {
      const result = await events.find().toArray();
      res.json(result);
    });

    app.post("/api/events", async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await events.insertOne(data);
      res.json(result);
    });

    // Join Event
    app.post("/api/events/join/:id", async (req, res) => {
      const id = req.params.id;
      const result = await events.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { currentParticipants: 1 } }
      );
      res.json(result);
    });

    app.get("/api/user-challenges/:userId", async (req, res) => {
      const userId = req.params.userId;
      const result = await userChallenges.find({ userId }).toArray();
      res.json(result);
    });

    app.get("/", (req, res) => {
      res.send(" EcoTrack API is running successfully!");
    });

    // Ping the server
    await db.command({ ping: 1 });
    console.log(" Pinged MongoDB — connection verified.");
  } catch (error) {
    console.error(" Error connecting to MongoDB:", error);
  }
}

run().catch(console.dir);

// Start server
app.listen(port, () => {
  console.log(` Server running on http://localhost:${port}`);
});
