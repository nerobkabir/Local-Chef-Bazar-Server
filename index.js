require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin SDK
var admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      })
    });
    console.log("✅ Firebase Admin SDK initialized successfully");
  } catch (error) {
    console.error("❌ Firebase Admin initialization error:", error.message);
  }
}

/* =======================================
   Stripe Configuration
======================================= */
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ... বাকি code আগের মতোই

/* =======================================
   Middleware
======================================= */
app.use(cors());

// ⚠️ IMPORTANT: Raw body parser BEFORE express.json() for Stripe webhook
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderId = session.metadata.orderId;
      const userEmail = session.metadata.userEmail;
      const amountTotal = session.amount_total / 100; // Convert from cents

      console.log("✅ Payment successful for order:", orderId);

      try {
        // Update order payment status
        await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { paymentStatus: "paid" } }
        );

        // Save payment history
        await client
          .db("LocalChefBazaarDB")
          .collection("payment_history")
          .insertOne({
            orderId: orderId,
            amount: amountTotal,
            currency: session.currency,
            paymentMethod: "card",
            userEmail: userEmail,
            paymentTime: new Date(),
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent,
          });

        console.log("✅ Payment history saved successfully");
      } catch (error) {
        console.error("❌ Error updating payment status:", error);
      }
    }

    res.json({ received: true });
  }
);

// Regular JSON parser for other routes
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
      role: "user",
      status: "active",
      createdAt: new Date(),
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

// GET all users (Admin page)
app.get("/all-users", async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.send({ success: true, data: users });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});

// Make Fraud API
app.put("/users/fraud/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const user = await usersCollection.findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res
        .status(404)
        .send({ success: false, message: "User not found" });
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

    const meals = await mealsCollection.find().skip(skip).limit(limit).toArray();

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
      return res
        .status(404)
        .send({ success: false, message: "Meal not found" });
    }

    res.send({ success: true, data: meal });
  } catch (error) {
    res.status(500).send({ success: false, error });
  }
});




// POST create new meal - এই route এ
app.post("/create-meal", async (req, res) => {
  try {
    const meal = req.body;

    const chef = await usersCollection.findOne({
      email: meal.userEmail,
    });

    if (!chef || chef.role !== "chef") {
      return res.status(403).send({
        success: false,
        message: "Only chefs can create meals",
      });
    }

    if (chef.status === "fraud") {
      return res.status(403).send({
        success: false,
        message: "Fraud chefs cannot create meals",
      });
    }

    meal.chefId = chef.chefId;
    meal.createdAt = new Date();
    meal.rating = 0;
    
    // ✅ এই লাইন add করুন
    if (!Array.isArray(meal.ingredients)) {
      meal.ingredients = meal.ingredients 
        ? meal.ingredients.split(',').map(i => i.trim()) 
        : [];
    }

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

// GET meals created by a specific chef
app.get("/my-meals", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res
        .status(400)
        .send({ success: false, message: "Email is required" });
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
      result,
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

// GET reviews by user email
app.get("/my-reviews", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res
        .status(400)
        .send({ success: false, message: "Email is required" });
    }

    const myReviews = await reviewsCollection
      .find({ userEmail: email })
      .sort({ date: -1 })
      .toArray();

    res.send({ success: true, data: myReviews });
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

// DELETE Review by ID
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

// UPDATE Review by ID
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

// GET favorites by user email
app.get("/favorites", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res
        .status(400)
        .send({ success: false, message: "Email is required" });
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

// DELETE favorite by ID
app.delete("/favorites/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await favoritesCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Meal removed from favorites successfully",
      result,
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

// GET: Orders by user email
app.get("/orders", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res
        .status(400)
        .send({ success: false, message: "Email is required" });
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

// GET orders by chef email
app.get("/chef-orders", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Email is required",
      });
    }

    console.log("🔍 Fetching orders for chef email:", email);

    const chefMeals = await mealsCollection.find({ userEmail: email }).toArray();

    console.log("✅ Chef Meals Found:", chefMeals.length);

    if (chefMeals.length === 0) {
      return res.send({
        success: true,
        data: [],
        message: "No meals found for this chef",
      });
    }

    const mealIds = chefMeals.map((m) => m._id.toString());
    console.log("📋 Meal IDs:", mealIds);

    const orders = await ordersCollection
      .find({ foodId: { $in: mealIds } })
      .sort({ orderTime: -1 })
      .toArray();

    console.log("✅ Orders Found:", orders.length);

    res.send({
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error("❌ Error fetching chef orders:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// UPDATE order status
app.put("/orders/status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    if (!status) {
      return res
        .status(400)
        .send({ success: false, message: "Status is required" });
    }

    const updateDoc = {
      $set: { orderStatus: status },
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

// UPDATE payment status (payment success page থেকে call হবে)
app.put("/orders/payment/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { paymentStatus } = req.body;

    console.log(`🔄 Updating payment status for order: ${id}`);

    // Order টি আছে কিনা check করুন
    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).send({
        success: false,
        message: "Order not found",
      });
    }

    // Payment status update করুন
    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          paymentStatus: paymentStatus || "paid",
          paymentTime: new Date()
        } 
      }
    );

    // Payment history save করুন
    await client
      .db("LocalChefBazaarDB")
      .collection("payment_history")
      .insertOne({
        orderId: id,
        amount: order.price * order.quantity,
        currency: "bdt",
        paymentMethod: "card",
        userEmail: order.userEmail,
        paymentTime: new Date(),
        orderStatus: order.orderStatus,
      });

    console.log(`✅ Payment status updated successfully for order: ${id}`);

    res.send({
      success: true,
      message: "Payment status updated successfully",
      result,
    });
  } catch (error) {
    console.error("❌ Error updating payment status:", error);
    res.status(500).send({ 
      success: false, 
      error: error.message 
    });
  }
});

/* =======================================
   Payment Routes (Stripe)
======================================= */

// CREATE CHECKOUT SESSION
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).send({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await ordersCollection.findOne({
      _id: new ObjectId(orderId),
    });

    if (!order) {
      return res.status(404).send({
        success: false,
        message: "Order not found",
      });
    }

    if (order.orderStatus !== "accepted") {
      return res.status(400).send({
        success: false,
        message: "Order must be accepted before payment",
      });
    }

    if (order.paymentStatus === "paid") {
      return res.status(400).send({
        success: false,
        message: "Order is already paid",
      });
    }

    const totalAmount = order.price * order.quantity;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: {
              name: order.mealName,
              description: `Order from ${order.chefName || "Chef"}`,
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?orderId=${orderId}`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard/payment-cancel`,
      metadata: {
        orderId: orderId,
        userEmail: order.userEmail,
      },
    });

    res.send({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error("❌ Stripe Error:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

/* =======================================
   Role Request Routes
======================================= */

// POST role request
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

    const request = await roleRequestCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!request) {
      return res
        .status(404)
        .send({ success: false, message: "Request not found" });
    }

    let updateUserDoc = {};
    if (request.requestType === "chef") {
      const chefId = "chef-" + Math.floor(1000 + Math.random() * 9000);
      updateUserDoc = { role: "chef", chefId };
    }

    if (request.requestType === "admin") {
      updateUserDoc = { role: "admin" };
    }

    await usersCollection.updateOne(
      { email: request.userEmail },
      { $set: updateUserDoc }
    );

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

/* =======================================
   Admin Statistics
======================================= */

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