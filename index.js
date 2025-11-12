import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";
import serviceAccount from "./firebase-adminsdk.json" with { type: "json" };

dotenv.config();
const app = express();
const port = process.env.PORT || 4000;

// firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- Middleware ---
app.use(cors());
app.use(express.json());

//  Middleware for Firebase Token Verification
async function verifyFirebaseToken(req, res, next) {
  console.log("hit verifyFirebase Middleware");
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized - Missing Token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;

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
    }); // in use

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
    }); // in use
    // Get all challenges
    app.get("/api/challenges", async (req, res) => {
      const filter = req.query.category ? { category: req.query.category } : {};
      const result = await challenges
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    }); // in use
    // GET upcoming challenges
    app.get("/api/challenges/upcoming", async (req, res) => {
      try {
        const now = new Date().toISOString().split("T")[0];

        const upcomingChallenges = await challenges
          .find({ startDate: { $gt: now } })
          .sort({ startDate: 1 })
          .toArray();

        res.status(200).json(upcomingChallenges);
      } catch (err) {
        console.error("Error fetching upcoming challenges:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // get running challenges
    app.get("/api/challenges/running", async (req, res) => {
      try {
        const today = new Date();
        const allChallenges = await challenges.find({}).toArray();
        const runningChallenges = allChallenges.filter((c) => {
          const start = new Date(c.startDate);
          const end = new Date(c.endDate);
          return start <= today && end >= today;
        });
        res.status(200).json(runningChallenges);
      } catch (err) {
        console.error("Error fetching running challenges:", err);
        res.status(500).json({ message: "Server error" });
      }
    }); // in use

    // Get single challenge by id
    app.get("/api/challenges/:id", async (req, res) => {
      const id = req.params.id;
      const result = await challenges.findOne({ _id: new ObjectId(id) });
      res.json(result);
    }); // in use

    // Create new challenge
    app.post("/api/challenges", verifyFirebaseToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      data.updatedAt = new Date();
      const result = await challenges.insertOne(data);
      res.json(result);
    }); // in use

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
    app.delete("/api/challenges/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await challenges.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    // Join challenge (increments participants + adds to UserChallenges)
    app.post(
      "/api/challenges/join/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const authorEmail = req.user?.email;
        const challengeId = req.params.id;
        const { userId } = req.body;
        console.log(userId);
        // participants +1
        await challenges.updateOne(
          { _id: new ObjectId(challengeId) },
          { $inc: { participants: 1 } }
        );
        const challenge = await db
          .collection("challenges")
          .findOne({ _id: new ObjectId(challengeId) });
        // add to userChallenges collection
        const userChallenge = {
          email: authorEmail,
          userId,
          challengeId: new ObjectId(challengeId),
          status: "Not Started",
          progress: 0,
          actionsCompleted: 0,
          totalActions: challenge.totalActions || 0,
          co2Saved: 0,
          plasticReduced: 0,
          joinDate: new Date(),
        };
        const result = await userChallenges.insertOne(userChallenge);

        res.json({ message: "Joined successfully!", result });
      }
    ); // in use

    // tips apis
    app.get("/api/tips", async (req, res) => {
      const result = await tips.find().toArray();
      res.json(result);
    }); //in use
    app.get("/api/tips/:author", verifyFirebaseToken, async (req, res) => {
      try {
        const author = req.params.author;

        const result = await tips.find({ author: author }).toArray();

        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching tips:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    }); // in use

    app.post("/api/tips", verifyFirebaseToken, async (req, res) => {
      console.log("hit tip post ");
      const data = req.body;
      data.createdAt = new Date();
      const result = await tips.insertOne(data);
      res.json(result);
    }); // in use
    app.put("/api/tips/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { title, category, content } = req.body;

        if (!title || !category || !content) {
          return res.status(400).json({ message: "All fields are required" });
        }

        const result = await tips.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              title,
              category,
              content,
            },
          }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: "Tip not found or unchanged" });
        }

        res.json({ message: "Tip updated successfully!" });
      } catch (error) {
        console.error("PUT /api/tips/:id error:", error);
        res.status(500).json({ message: "Server error during update" });
      }
    });
    //  Upvote a tip
    app.put("/api/tips/:id/upvote", verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const userEmail = req.user.email;

        const tip = await tips.findOne({ _id: new ObjectId(id) });
        if (!tip) {
          return res.status(404).json({ message: "Tip not found" });
        }

        // নিজের পোস্টে ভোট দেওয়া বন্ধ
        if (tip.author === userEmail) {
          return res
            .status(400)
            .json({ message: "You can't upvote your own tip" });
        }

        // 🔍 upvotedUsers ফিল্ড না থাকলে initialize করে দাও
        if (!Array.isArray(tip.upvotedUsers)) {
          tip.upvotedUsers = [];
        }

        const alreadyVoted = tip.upvotedUsers.includes(userEmail);

        if (alreadyVoted) {
          // 🟡 যদি আগে ভোট দিয়ে থাকে → Vote cancel
          await tips.updateOne(
            { _id: new ObjectId(id) },
            {
              $inc: { upvotes: -1 },
              $pull: { upvotedUsers: userEmail },
            }
          );
          return res.json({ message: "Vote removed", voted: false });
        } else {
          await tips.updateOne(
            { _id: new ObjectId(id) },
            {
              $inc: { upvotes: 1 },
              $addToSet: { upvotedUsers: userEmail },
            }
          );
          return res.json({ message: "Voted successfully", voted: true });
        }
      } catch (error) {
        console.error("PUT /api/tips/:id/upvote error:", error);
        res.status(500).json({ message: "Server error during upvote" });
      }
    }); // in use

    app.delete("/api/tips/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        console.log(id);
        const result = await tips.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Tip not found" });
        }

        res.json({ message: "Tip deleted successfully!" });
      } catch (error) {
        console.error("DELETE /api/tips/:id error:", error);
        res.status(500).json({ message: "Server error during deletion" });
      }
    }); //in use
    // Upvote a tip

    // Event get
    app.get("/api/events", async (req, res) => {
      const result = await events.find().toArray();
      res.json(result);
    }); //in use
    // Event upcomming  get
    app.get("/api/events/upcomming", async (req, res) => {
      try {
        const now = new Date().toISOString().split("T")[0];

        const upcomingEvent = await events
          .find({ date: { $gt: now } })
          .sort({ date: 1 })
          .toArray();

        res.status(200).json(upcomingEvent);
      } catch (err) {
        console.error("Error fetching upcoming challenges:", err);
        res.status(500).json({ message: "Server error" });
      }
    }); //in use
    app.post("/api/events", verifyFirebaseToken, async (req, res) => {
      const data = req.body;
      const authorEmail = req.user?.email;
      data.organizer = authorEmail;
      data.createdAt = new Date();
      const result = await events.insertOne(data);
      res.json(result);
    }); //in use
    app.get("/api/total-joined", async (req, res) => {
      try {
        const totalJoins = await userChallenges.countDocuments({});
        res.json({ totalJoined: totalJoins });
      } catch (error) {
        console.error("Error fetching total joined challenges:", error);
        res.status(500).json({ message: "Server error" });
      }
    }); //in use
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
        console.log(challengesDetails);
      } catch (error) {
        console.error("Error fetching user challenges with details:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Update user challenge progress
    app.patch(
      "/api/user-challenges/update/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const {
            actionsCompleted,
            totalActions,
            co2PerAction,
            plasticPerAction,
          } = req.body;

          // find current data
          const existing = await userChallenges.findOne({
            _id: new ObjectId(id),
          });
          if (!existing) {
            return res
              .status(404)
              .json({ message: "User challenge not found" });
          }

          // calculate new progress and impact
          const newActionsCompleted =
            existing.actionsCompleted + (actionsCompleted || 0);
          const newProgress = Math.min(
            (newActionsCompleted / (totalActions || existing.totalActions)) *
              100,
            100
          );
          const newCo2Saved = existing.co2Saved + (co2PerAction || 0);
          const newPlasticReduced =
            existing.plasticReduced + (plasticPerAction || 0);

          // update data
          const result = await userChallenges.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                progress: newProgress,
                actionsCompleted: newActionsCompleted,
                co2Saved: newCo2Saved,
                plasticReduced: newPlasticReduced,
                status: newProgress === 100 ? "Completed" : "In Progress",
                lastUpdated: new Date(),
              },
            }
          );

          res.json({ message: "Progress updated successfully", result });
        } catch (error) {
          console.error("Error updating progress:", error);
          res.status(500).json({ message: "Server error" });
        }
      }
    );
    // Get live statistics (total CO2 saved and plastic reduced)
    app.get("/api/statistics", async (req, res) => {
      try {
        const stats = await userChallenges
          .aggregate([
            {
              $group: {
                _id: null,
                totalCO2: { $sum: "$co2Saved" },
                totalPlastic: { $sum: "$plasticReduced" },
              },
            },
          ])
          .toArray();

        const result = stats[0] || { totalCO2: 0, totalPlastic: 0 };

        res.json({
          message: "Live statistics fetched successfully",
          totalCO2: result.totalCO2,
          totalPlastic: result.totalPlastic,
        });
      } catch (error) {
        console.error("Error fetching statistics:", error);
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
