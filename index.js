require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin SDK
var admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })
}


const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Middleware
app.use(cors());


app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderId = session.metadata.orderId;
      const userEmail = session.metadata.userEmail;
      const amountTotal = session.amount_total / 100;

      console.log("Payment successful for order:", orderId);

      try {
        await connectDB();
        
        await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { paymentStatus: "paid" } }
        );

        await db.collection("payment_history").insertOne({
          orderId: orderId,
          amount: amountTotal,
          currency: session.currency,
          paymentMethod: "card",
          userEmail: userEmail,
          paymentTime: new Date(),
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
        });

        console.log("Payment history saved successfully");
      } catch (error) {
        console.error("Error updating payment status:", error);
      }
    }

    res.json({ received: true });
  }
);

app.use(express.json());


// MongoDB Connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.f8ar27k.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

let db;
let usersCollection;
let mealsCollection;
let reviewsCollection;
let favoritesCollection;
let ordersCollection;
let roleRequestCollection;

async function connectDB() {
  try {
    if (!db) {
      await client.connect();
      db = client.db("LocalChefBazaarDB");
      
      usersCollection = db.collection("users");
      mealsCollection = db.collection("meals");
      reviewsCollection = db.collection("reviews");
      favoritesCollection = db.collection("favorites");
      ordersCollection = db.collection("order_collection");
      roleRequestCollection = db.collection("role_requests");
      
      console.log("MongoDB Connected Successfully!");
    }
    return db;
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
    throw error;
  }
}


// Root Route
app.get("/", (req, res) => {
  res.send("LocalChefBazaar Server Running Successfully!");
});


// Add this route to your Express server (index.js)

// Update User Profile Route
app.put("/users/update/:email", async (req, res) => {
  try {
    await connectDB();
    
    const email = req.params.email;
    const { displayName, photoURL, address } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Email is required"
      });
    }

    // Check if user exists
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found"
      });
    }

    // Build update object - only include fields that are provided
    const updateDoc = {};
    if (displayName !== undefined) updateDoc.displayName = displayName;
    if (photoURL !== undefined) updateDoc.photoURL = photoURL;
    if (address !== undefined) updateDoc.address = address;
    
    // Add update timestamp
    updateDoc.updatedAt = new Date();

    // Update user
    const result = await usersCollection.updateOne(
      { email },
      { $set: updateDoc }
    );

    if (result.modifiedCount === 0) {
      return res.send({
        success: true,
        message: "No changes were made"
      });
    }

    // Get updated user
    const updatedUser = await usersCollection.findOne({ email });

    res.send({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).send({
      success: false,
      error: error.message,
      message: "Failed to update profile"
    });
  }
});



// Users Routes
app.get("/users", async (req, res) => {
  try {
    await connectDB();
    
    const email = req.query.email;

    if (email) {
      const user = await usersCollection.findOne({ email });
      return res.send(user || {});
    }

    const users = await usersCollection.find().toArray();
    res.send(users);
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.post("/users", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/all-users", async (req, res) => {
  try {
    await connectDB();
    
    const users = await usersCollection.find().toArray();
    res.send({ success: true, data: users });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.put("/users/fraud/:id", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

// Meals Routes

// app.get("/meals", async (req, res) => {
//   try {
//     await connectDB();
    
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     const meals = await mealsCollection.find().skip(skip).limit(limit).toArray();
//     const totalMeals = await mealsCollection.countDocuments();

//     res.send({
//       success: true,
//       data: meals,
//       totalMeals,
//       currentPage: page,
//       totalPages: Math.ceil(totalMeals / limit),
//     });
//   } catch (error) {
//     console.error("Meals fetch error:", error.message);
//     res.status(500).send({ 
//       success: false, 
//       error: error.message,
//       message: "Failed to fetch meals"
//     });
//   }
// });



// Get filter options endpoint 
app.get("/meals/filters", async (req, res) => {
  try {
    await connectDB();
    
    const count = await mealsCollection.countDocuments();
    
    if (count === 0) {
      return res.send({
        success: true,
        data: {
          maxPrice: 500,
          minPrice: 0,
          maxRating: 5,
          minRating: 0,
          categories: [],
          deliveryAreas: []
        }
      });
    }

    const filters = await mealsCollection.aggregate([
      {
        $group: {
          _id: null,
          maxPrice: { $max: "$price" },
          minPrice: { $min: "$price" },
          maxRating: { $max: "$rating" },
          minRating: { $min: "$rating" },
          categories: { $addToSet: "$category" },
          deliveryAreas: { $addToSet: "$deliveryArea" }
        }
      }
    ]).toArray();

    if (!filters || filters.length === 0) {
      return res.send({
        success: true,
        data: {
          maxPrice: 500,
          minPrice: 0,
          maxRating: 5,
          minRating: 0,
          categories: [],
          deliveryAreas: []
        }
      });
    }

    const result = {
      maxPrice: filters[0].maxPrice || 500,
      minPrice: filters[0].minPrice || 0,
      maxRating: filters[0].maxRating || 5,
      minRating: filters[0].minRating || 0,
      categories: filters[0].categories || [],
      deliveryAreas: filters[0].deliveryAreas || []
    };

    console.log("Filter options retrieved successfully:", result);

    res.send({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Filter options error:", error);
    
    res.status(200).send({ 
      success: true, 
      data: {
        maxPrice: 500,
        minPrice: 0,
        maxRating: 5,
        minRating: 0,
        categories: [],
        deliveryAreas: []
      },
      message: "Using default filter values"
    });
  }
});


app.get("/meals", async (req, res) => {
  try {
    
    await connectDB();
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search?.trim() || "";
    const minPrice = parseFloat(req.query.minPrice);
    const maxPrice = parseFloat(req.query.maxPrice);
    const minRating = parseFloat(req.query.minRating) || 0;
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    console.log("=== Meals Query Parameters ===");
    console.log("Page:", page, "Limit:", limit);
    console.log("Search:", search);
    console.log("Price Range:", minPrice, "-", maxPrice);
    console.log("Min Rating:", minRating);
    console.log("Sort By:", sortBy, "Order:", sortOrder === 1 ? "asc" : "desc");

    let query = {};

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      
      query.$or = [
        { foodName: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { chefName: { $regex: searchRegex } },
        { category: { $regex: searchRegex } },
        { deliveryArea: { $regex: searchRegex } },
        { ingredients: { $regex: searchRegex } }
      ];
    }

    if (!isNaN(minPrice) && !isNaN(maxPrice)) {
      query.price = {
        $gte: minPrice,
        $lte: maxPrice
      };
    } else if (!isNaN(minPrice)) {
      query.price = { $gte: minPrice };
    } else if (!isNaN(maxPrice)) {
      query.price = { $lte: maxPrice };
    }

    if (minRating > 0) {
      query.rating = { $gte: minRating };
    }

    console.log("MongoDB Query:", JSON.stringify(query, null, 2));

    let sort = {};
    if (sortBy === "price") {
      sort.price = sortOrder;
      sort.createdAt = -1; 
    } else if (sortBy === "rating") {
      sort.rating = sortOrder;
      sort.createdAt = -1; 
    } else if (sortBy === "createdAt") {
      sort.createdAt = sortOrder;
    } else {
      sort.createdAt = -1; 
    }

    console.log("Sort Object:", sort);

    const meals = await mealsCollection
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const totalMeals = await mealsCollection.countDocuments(query);
    const totalPages = Math.ceil(totalMeals / limit);

    console.log("Results Found:", meals.length, "Total Matching:", totalMeals);

    res.send({
      success: true,
      data: meals,
      totalMeals,
      currentPage: page,
      totalPages,
      filters: {
        search,
        minPrice,
        maxPrice,
        minRating,
        sortBy,
        sortOrder: sortOrder === 1 ? "asc" : "desc"
      }
    });
  } catch (error) {
    console.error("❌ Meals fetch error:", error);
    res.status(500).send({ 
      success: false, 
      error: error.message,
      message: "Failed to fetch meals",
      data: [],
      totalMeals: 0,
      totalPages: 0
    });
  }
});

app.get("/meals/test", async (req, res) => {
  try {
    await connectDB();
    
    const totalCount = await mealsCollection.countDocuments();
    const sampleMeal = await mealsCollection.findOne();
    
    res.send({
      success: true,
      totalMeals: totalCount,
      sampleMeal: sampleMeal,
      message: "Database connection working"
    });
  } catch (error) {
    res.status(500).send({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get("/meals/:id", async (req, res) => {
  try {
    await connectDB();
    
    const { id } = req.params;
    const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });

    if (!meal) {
      return res
        .status(404)
        .send({ success: false, message: "Meal not found" });
    }

    res.send({ success: true, data: meal });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.post("/create-meal", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/my-meals", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.delete("/meals/:id", async (req, res) => {
  try {
    await connectDB();
    
    const id = req.params.id;
    const result = await mealsCollection.deleteOne({ _id: new ObjectId(id) });

    res.send({
      success: true,
      message: "Meal deleted successfully",
      result,
    });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.put("/meals/:id", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

// Reviews Routes

app.get("/reviews", async (req, res) => {
  try {
    await connectDB();
    
    const reviews = await reviewsCollection.find().toArray();
    res.send(reviews);
  } catch (error) {
    console.error("Reviews fetch error:", error.message);
    res.status(500).send({ 
      success: false, 
      error: error.message,
      message: "Failed to fetch reviews"
    });
  }
});

app.get("/reviews/:mealId", async (req, res) => {
  try {
    await connectDB();
    
    const { mealId } = req.params;
    const reviews = await reviewsCollection.find({ foodId: mealId }).toArray();
    res.send(reviews);
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/my-reviews", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.post("/reviews", async (req, res) => {
  try {
    await connectDB();
    
    const review = req.body;
    review.date = new Date();

    await reviewsCollection.insertOne(review);

    res.send({
      success: true,
      message: "Review submitted successfully",
    });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.delete("/reviews/:id", async (req, res) => {
  try {
    await connectDB();
    
    const id = req.params.id;

    const result = await reviewsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send({ success: true, message: "Review deleted successfully", result });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.put("/reviews/:id", async (req, res) => {
  try {
    await connectDB();
    
    const id = req.params.id;
    const updatedData = req.body;

    const result = await reviewsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    res.send({ success: true, message: "Review updated successfully", result });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

// Favorites Routes
app.post("/favorites", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/favorites", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.delete("/favorites/:id", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

// Orders Routes

app.post("/orders", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/orders", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/chef-orders", async (req, res) => {
  try {
    await connectDB();
    
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Email is required",
      });
    }

    console.log("Fetching orders for chef email:", email);

    const chefMeals = await mealsCollection.find({ userEmail: email }).toArray();

    console.log("Chef Meals Found:", chefMeals.length);

    if (chefMeals.length === 0) {
      return res.send({
        success: true,
        data: [],
        message: "No meals found for this chef",
      });
    }

    const mealIds = chefMeals.map((m) => m._id.toString());
    console.log("Meal IDs:", mealIds);

    const orders = await ordersCollection
      .find({ foodId: { $in: mealIds } })
      .sort({ orderTime: -1 })
      .toArray();

    console.log("Orders Found:", orders.length);

    res.send({
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error("Error fetching chef orders:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

app.put("/orders/status/:id", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.put("/orders/payment/:id", async (req, res) => {
  try {
    await connectDB();
    
    const id = req.params.id;
    const { paymentStatus } = req.body;

    console.log(`Updating payment status for order: ${id}`);

    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).send({
        success: false,
        message: "Order not found",
      });
    }

    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          paymentStatus: paymentStatus || "paid",
          paymentTime: new Date()
        } 
      }
    );

    await db.collection("payment_history").insertOne({
      orderId: id,
      amount: order.price * order.quantity,
      currency: "bdt",
      paymentMethod: "card",
      userEmail: order.userEmail,
      paymentTime: new Date(),
      orderStatus: order.orderStatus,
    });

    console.log(`Payment status updated successfully for order: ${id}`);

    res.send({
      success: true,
      message: "Payment status updated successfully",
      result,
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).send({ 
      success: false, 
      error: error.message 
    });
  }
});

// Payment Routes (Stripe)

app.post("/create-checkout-session", async (req, res) => {
  try {
    await connectDB();
    
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
    console.error("Stripe Error:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// Role Request Routes

app.post("/role-request", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.get("/role-requests", async (req, res) => {
  try {
    await connectDB();
    
    const requests = await roleRequestCollection
      .find()
      .sort({ requestTime: -1 })
      .toArray();

    res.send({ success: true, data: requests });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

app.put("/role-requests/approve/:id", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

app.put("/role-requests/reject/:id", async (req, res) => {
  try {
    await connectDB();
    
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
    res.status(500).send({ success: false, error: error.message });
  }
});

// Admin Stats Route

app.get("/admin-stats", async (req, res) => {
  try {
    await connectDB();
    
    const totalUsers = await usersCollection.countDocuments();

    const pendingOrders = await ordersCollection.countDocuments({
      orderStatus: "pending",
    });

    const deliveredOrders = await ordersCollection.countDocuments({
      orderStatus: "delivered",
    });

    const payments = await db
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
    res.status(500).send({ success: false, error: error.message });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});