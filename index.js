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

    const newUser = {
      ...user,
      role: "user",        // ✅ default role
      status: "active",    // ✅ default status
      createdAt: new Date()
    };

    await usersCollection.insertOne(newUser);

    res.send({
      success: true,
      message: "User saved successfully",
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// GET all users (Admin page
app.get("/all-users", async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.send({ success: true, data: users });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// Make Fraud API (CORE FEATURE)
app.put("/users/fraud/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const user = await usersCollection.findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    if (user.role === "admin") {
      return res.send({
        success: false,
        message: "Admin cannot be fraud",
      });
    }

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "fraud" } }
    );

    res.send({
      success: true,
      message: "User marked as fraud successfully",
      result,
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


/* =======================================
   Meals Routes
======================================= */

app.get("/meals", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const meals = await mealsCollection
      .find()
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalMeals = await mealsCollection.countDocuments();

    res.send({
      success: true,
      data: meals,
      totalMeals,
      currentPage: page,
      totalPages: Math.ceil(totalMeals / limit),
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// GET single meal by ID
app.get("/meals/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });

    if (!meal) {
      return res.status(404).send({ success: false, message: "Meal not found" });
    }

    res.send({ success: true, data: meal });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});



// POST create new meal
app.post("/create-meal", async (req, res) => {
  try {
    const meal = req.body;

    const chef = await usersCollection.findOne({ email: meal.userEmail });

    if (chef?.status === "fraud") {
      return res.status(403).send({
        success: false,
        message: "Fraud chefs cannot create meals",
      });
    }


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

    const user = await usersCollection.findOne({ email: order.userEmail });

    if (user?.status === "fraud") {
      return res.status(403).send({
        success: false,
        message: "Fraud users cannot place orders",
      });
    }


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

// GET reviews by user email
app.get("/my-reviews", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const myReviews = await reviewsCollection
      .find({ userEmail: email })   // FIXED (previously reviewerEmail)
      .sort({ date: -1 })
      .toArray();

    res.send({ success: true, data: myReviews });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});



// Delete Review by ID
const { ObjectId } = require("mongodb");

app.delete("/reviews/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await reviewsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({ success: true, message: "Review deleted successfully", result });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

//  Update Review by ID
app.put("/reviews/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;

    const result = await reviewsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.send({ success: true, message: "Review updated successfully", result });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});



// Delete favorite by ID
app.delete("/favorites/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await favoritesCollection.deleteOne({ _id: new ObjectId(id) });

    res.send({ success: true, message: "Meal removed from favorites successfully", result });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// GET favorites by user email
app.get("/favorites", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const favorites = await favoritesCollection
      .find({ userEmail: email })
      .sort({ addedTime: -1 })
      .toArray();

    res.send({ success: true, data: favorites });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// GET meals created by a specific chef
app.get("/my-meals", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const meals = await mealsCollection
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ success: true, data: meals });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// DELETE Meal by ID

app.delete("/meals/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await mealsCollection.deleteOne({ _id: new ObjectId(id) });

    res.send({
      success: true,
      message: "Meal deleted successfully",
      result
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// UPDATE Meal by ID

app.put("/meals/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;

    const result = await mealsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.send({
      success: true,
      message: "Meal updated successfully",
      result,
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// UPDATE order status: pending -> accepted/cancelled/delivered
app.put("/orders/status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    if (!status) {
      return res.status(400).send({ success: false, message: "Status is required" });
    }

    const updateDoc = {
      $set: { orderStatus: status }
    };

    if (status === "delivered") {
      updateDoc.$set.deliveryTime = new Date();
    }

    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    res.send({
      success: true,
      message: `Order ${status} successfully`,
      result,
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});



// GET orders by chefId (chef request page)
app.get("/chef-orders", async (req, res) => {
  try {
    const chefId = req.query.chefId;

    if (!chefId) {
      return res.status(400).send({ success: false, message: "chefId is required" });
    }

    const orders = await ordersCollection
      .find({ chefId })
      .sort({ orderTime: -1 })
      .toArray();

    res.send({ success: true, data: orders });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// GET all role requests
app.get("/role-requests", async (req, res) => {
  try {
    const requests = await roleRequestCollection
      .find()
      .sort({ requestTime: -1 })
      .toArray();

    res.send({ success: true, data: requests });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// APPROVE role request
app.put("/role-requests/approve/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const request = await roleRequestCollection.findOne({ _id: new ObjectId(id) });

    if (!request) {
      return res.status(404).send({ success: false, message: "Request not found" });
    }

    // Generate chefId if chef
    let updateUserDoc = {};
    if (request.requestType === "chef") {
      const chefId = "chef-" + Math.floor(1000 + Math.random() * 9000);
      updateUserDoc = { role: "chef", chefId };
    }

    if (request.requestType === "admin") {
      updateUserDoc = { role: "admin" };
    }

    // Update user role
    await usersCollection.updateOne(
      { email: request.userEmail },
      { $set: updateUserDoc }
    );

    // Update request status
    await roleRequestCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { requestStatus: "approved" } }
    );

    res.send({
      success: true,
      message: "Request approved successfully",
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});


// REJECT role request
app.put("/role-requests/reject/:id", async (req, res) => {
  try {
    const id = req.params.id;

    await roleRequestCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { requestStatus: "rejected" } }
    );

    res.send({
      success: true,
      message: "Request rejected successfully",
    });

  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// ===============================
// GET Platform Statistics (Admin)
// ===============================
app.get("/admin-stats", async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();

    const pendingOrders = await ordersCollection.countDocuments({
      orderStatus: "pending",
    });

    const deliveredOrders = await ordersCollection.countDocuments({
      orderStatus: "delivered",
    });

    const payments = await client
      .db("LocalChefBazaarDB")
      .collection("payment_history")
      .aggregate([
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },       
          },
        },
      ])
      .toArray();

    const totalPaymentAmount = payments[0]?.totalAmount || 0;

    res.send({
      success: true,
      data: {
        totalUsers,
        pendingOrders,
        deliveredOrders,
        totalPaymentAmount,
      },
    });
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
