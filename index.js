import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";
import serviceAccount from "./firebase-adminsdk.json"with { type: "json" };

dotenv.config();
const app = express();
const port = process.env.PORT || 4000;

// firebase 
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// --- Middleware ---
app.use(cors());
app.use(express.json());

//  Middleware for Firebase Token Verification
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized - Missing Token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // user info stored in request
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    res.status(403).json({ message: "Invalid or expired token" });
  }
}

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
    const users = db.collection("users");
    const challenges = db.collection("challenges");
    const userChallenges = db.collection("userChallenges");
    const tips = db.collection("tips");
    const events = db.collection("events");

    console.log(" MongoDB connected successfully!");

    app.post("/api/user", verifyFirebaseToken, async (req, res) => {
  const { name, email } = req.body;
  const firebaseEmail = req.user.email;
  if (email !== firebaseEmail) {
    return res.status(403).json({ message: "Email mismatch" });
  }

  try {
    const existing = await users.findOne({ email });

    if (existing) {
      // update user lastLogin or name
      await users.updateOne(
        { email },
        { $set: { name, lastLogin: new Date() } }
      );
      return res.status(200).json({ message: "User updated" });
    }

    // create new user
    await users.insertOne({
      name,
      email,
      createdAt: new Date(),
      lastLogin: new Date(),
    });

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating user" });
  }
       });

// get current user information
  app.get("/api/user/:email", async (req, res) => {
    try {
      const email = req.params.email;

      const user = await users.findOne({ email });

      if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Server error" });
  }
});
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
      data.startDate = new Date();
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
       console.log(userId)
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
  try {
    const userId = req.params.userId;

    //  userChallenges fetch
    const userChallengesData = await userChallenges
      .find({ userId })
      .toArray();

    // challenge details fetch
    const challengesDetails = await Promise.all(
      userChallengesData.map(async (uc) => {
        const challengeData = await challenges.findOne({
          _id: new ObjectId(uc.challengeId),
        });

        return {
          ...uc,
          challenge: challengeData || null,
        };
      })
    );

    res.json(challengesDetails);
    console.log(challengesDetails)
  } catch (error) {
    console.error("Error fetching user challenges with details:", error);
    res.status(500).json({ message: "Server error" });
  }
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
