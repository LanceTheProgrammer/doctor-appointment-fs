import express from "express";
import cors from "cors";
import "dotenv/config";
import connectDB from "./config/mongodb.js";
import connectCloudinary from "./config/cloudinary.js";
import adminRouter from "./routes/adminRoute.js";
import doctorRouter from "./routes/doctorRoute.js";
import userRouter from "./routes/userRoute.js";
import Stripe from "stripe";
import Appointment from "./models/appointmentModel.js";

const app = express();
const port = process.env.PORT || 4000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);



connectDB();
connectCloudinary();

// Define allowed origins
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://doctor-appointment-frontend-eta.vercel.app"  // Your production frontend URL
  ];
  
  // Single CORS configuration
  app.use(cors({
    origin: function(origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        console.log('❌ CORS blocked for origin:', origin);
        return callback(new Error('Not allowed by CORS'));
      }
      
      console.log('✅ CORS allowed for origin:', origin);
      return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization','token'],
    credentials: true
  }));
  
  // Important: Raw body parser must come before JSON parser for webhooks
  const webhookPath = "/webhook";
  app.post(webhookPath, express.raw({ type: "application/json" }));
  app.use((req, res, next) => {
    if (req.path === webhookPath && req.method === "POST") {
      next();
    } else {
      express.json()(req, res, next);
    }
  });

app.use("/api/admin", adminRouter);
app.use("/api/doctor", doctorRouter);
app.use("/api/user", userRouter);

// Stripe Checkout Session
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { appointmentId } = req.body;
    console.log('📝 Creating checkout session for appointment:', appointmentId);

    if (!appointmentId) {
      throw new Error('Missing appointmentId in request body');
    }

    const baseUrl =
      process.env.NODE_ENV === "production"
        ? "https://doctor-appointment-frontend-eta.vercel.app"
        : req.headers.origin || "http://localhost:5173";
    
    console.log('🌐 Using base URL:', baseUrl);

    const sessionConfig = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Appointment Booking",
            },
            unit_amount: 5000,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel`,
      metadata: {
        appointmentId: appointmentId,
      },
    };

    console.log('💳 Creating Stripe session with config:', {
      ...sessionConfig,
      success_url: sessionConfig.success_url,
      cancel_url: sessionConfig.cancel_url,
    });

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log('✅ Checkout session created:', {
      sessionId: session.id,
      metadata: session.metadata,
    });

    res.json({ success: true, sessionId: session.id });
  } catch (error) {
    console.error("❌ Error creating checkout session:", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enhanced Webhook Handler
app.post(webhookPath, async (req, res) => {
  console.log('🔔 Webhook received');
  console.log('📨 Webhook headers:', {
    'stripe-signature': !!req.headers['stripe-signature'],
    'content-type': req.headers['content-type'],
  });

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    console.log('📝 Webhook secret exists:', !!webhookSecret);
    
    if (!webhookSecret) {
      throw new Error("Missing Stripe webhook secret");
    }

    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('✅ Webhook verified, event type:', event.type);
    
  } catch (err) {
    console.error(`⚠️ Webhook signature verification failed:`, {
      error: err.message,
      stack: err.stack,
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log('💳 Processing completed checkout session:', {
          sessionId: session.id,
          metadata: session.metadata,
        });
        
        const appointmentId = session.metadata.appointmentId;
        console.log('🏥 Appointment ID from metadata:', appointmentId);

        if (!appointmentId) {
          throw new Error("No appointmentId found in session metadata");
        }

        // Update appointment payment status
        const updatedAppointment = await Appointment.findByIdAndUpdate(
          appointmentId,
          { payment: true },
          { new: true }
        );

        if (!updatedAppointment) {
          throw new Error(`Appointment ${appointmentId} not found`);
        }

        console.log(`✅ Payment successful for appointment:`, {
          appointmentId: updatedAppointment._id,
          payment: updatedAppointment.payment,
          updatedAt: updatedAppointment.updatedAt,
        });
        break;
      }
      default:
        console.log(`⚠️ Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error(`❌ Error processing webhook:`, {
      message: error.message,
      stack: error.stack,
      eventType: event?.type,
      appointmentId: event?.data?.object?.metadata?.appointmentId,
    });
    // Still return 200 to acknowledge receipt
    res.json({ received: true, error: error.message });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.send("API WORKING");
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server started on port ${port}`);
  console.log(`📡 Webhook endpoint: ${webhookPath}`);
});