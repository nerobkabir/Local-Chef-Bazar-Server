require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

/* =======================================
   Middleware
======================================= */
app.use(cors());
app.use(express.json());

/* =======================================
   MongoDB Connection
======================================= */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.f8ar27k.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

let usersCollection;
let mealsCollection;
let reviewsCollection;
let favoritesCollection;
let ordersCollection;
let roleRequestCollection;

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ MongoDB Connected Successfully!");

    const db = client.db("LocalChefBazaarDB");

    usersCollection = db.collection("users");
    mealsCollection = db.collection("meals");
    reviewsCollection = db.collection("reviews");
    favoritesCollection = db.collection("favorites");
    ordersCollection = db.collection("order_collection");
    roleRequestCollection = db.collection("role_requests");

  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
  }
}

connectDB();

/* =======================================
   Root Route
======================================= */
app.get("/", (req, res) => {
  res.send("🚀 LocalChefBazaar Server Running Successfully!");
});

/* =======================================
   Users Routes
======================================= */

// GET all users or single user by email
app.get("/users", async (req, res) => {
  try {
    const email = req.query.email;

    if (email) {
      const user = await usersCollection.findOne({ email });
      return res.send(user || {});
    }

    const users = await usersCollection.find().toArray();
    res.send(users);

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// POST create new user
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) {
      return res.send({ message: "User already exists" });
    }

    await usersCollection.insertOne(user);

    res.send({
      success: true,
      message: "User saved successfully",
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

/* =======================================
   Meals Routes
======================================= */

// GET all meals
app.get("/meals", async (req, res) => {
  try {
    const meals = await mealsCollection.find().toArray();
    res.send(meals);
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// POST create new meal
app.post("/create-meal", async (req, res) => {
  try {
    const meal = req.body;

    if (!meal.userEmail) {
      return res.status(400).send({
        success: false,
        message: "User email is required",
      });
    }

    if (!meal.chefId) {
      return res.status(400).send({
        success: false,
        message: "Chef ID is required",
      });
    }

    meal.createdAt = new Date();
    meal.rating = 0;

    const result = await mealsCollection.insertOne(meal);

    res.send({
      success: true,
      message: "Meal created successfully",
      data: result,
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

/* =======================================
   Reviews Routes
======================================= */

// GET all reviews
app.get("/reviews", async (req, res) => {
  try {
    const reviews = await reviewsCollection.find().toArray();
    res.send(reviews);
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// GET reviews by mealId
app.get("/reviews/:mealId", async (req, res) => {
  try {
    const { mealId } = req.params;

    const reviews = await reviewsCollection.find({ foodId: mealId }).toArray();
    res.send(reviews);

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// POST add review
app.post("/reviews", async (req, res) => {
  try {
    const review = req.body;
    review.date = new Date();

    await reviewsCollection.insertOne(review);

    res.send({
      success: true,
      message: "Review submitted successfully",
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

/* =======================================
   Favorites Routes
======================================= */

// POST add to favorites
app.post("/favorites", async (req, res) => {
  try {
    const fav = req.body;

    const exists = await favoritesCollection.findOne({
      userEmail: fav.userEmail,
      mealId: fav.mealId,
    });

    if (exists) {
      return res.send({
        success: false,
        message: "Meal already in favorites",
      });
    }

    fav.addedTime = new Date();
    await favoritesCollection.insertOne(fav);

    res.send({
      success: true,
      message: "Added to favorites successfully",
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

/* =======================================
   Orders Routes
======================================= */

// POST create order
app.post("/orders", async (req, res) => {
  try {
    const order = req.body;

    const requiredFields = [
      "foodId",
      "mealName",
      "price",
      "chefId",
      "userEmail",
      "userAddress",
    ];

    const missing = requiredFields.find((f) => !order[f]);
    if (missing) {
      return res.status(400).send({
        success: false,
        message: `Missing required field: ${missing}`,
      });
    }

    order.orderStatus = "pending";
    order.paymentStatus = "Pending";
    order.orderTime = new Date();

    const result = await ordersCollection.insertOne(order);

    res.send({
      success: true,
      message: "Order placed successfully",
      data: result,
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

/* =======================================
   Role Upgrade Request Routes
======================================= */

// POST role request (chef/admin)
app.post("/role-request", async (req, res) => {
  try {
    const request = req.body;

    if (!request.userName || !request.userEmail || !request.requestType) {
      return res.status(400).send({
        success: false,
        message: "Invalid request data",
      });
    }

    request.requestStatus = "pending";
    request.requestTime = new Date();

    const result = await roleRequestCollection.insertOne(request);

    res.send({
      success: true,
      message: "Role request submitted successfully",
      data: result,
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// ===============================
// GET: Orders by user email
// ===============================
app.get("/orders", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const orders = await ordersCollection
      .find({ userEmail: email })
      .sort({ orderTime: -1 })
      .toArray();

    res.send({ success: true, data: orders });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// ===============================
// POST: Save payment history
// ===============================
app.post("/payment-history", async (req, res) => {
  try {
    const payment = req.body;

    payment.paymentTime = new Date();

    const result = await client
      .db("LocalChefBazaarDB")
      .collection("payment_history")
      .insertOne(payment);

    // update order paymentStatus
    await ordersCollection.updateOne(
      { _id: new ObjectId(payment.orderId) },
      { $set: { paymentStatus: "paid" } }
    );

    res.send({ success: true, message: "Payment Saved", data: result });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


/* =======================================
   Start Server
======================================= */
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
