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

// app config
const app = express();
const port = process.env.PORT || 4000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

connectDB();
connectCloudinary();

// middlewares
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://doctor-appointment-frontend-eta.vercel.app'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true // If you’re using cookies or authentication
  }));

// Use raw body parser for webhook route
app.use('/webhook', express.raw({type: 'application/json'}));

// Use JSON parser for all other routes
app.use(express.json());

app.use("/api/admin", adminRouter);
app.use("/api/doctor", doctorRouter);
app.use("/api/user", userRouter);

// Stripe Checkout API endpoint
app.post("/api/create-checkout-session", async (req, res) => {
    try {
      console.log("Received request for checkout session:", req.body);
      const { appointmentId } = req.body;
      
      const baseUrl = req.headers.origin || "http://localhost:5173";
      
      console.log("Creating Stripe checkout session...");
      const session = await stripe.checkout.sessions.create({
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
          appointmentId: appointmentId
        }
      });
      
      console.log("Stripe session created successfully:", session.id);
      console.log("Success URL:", `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`);
      console.log("Cancel URL:", `${baseUrl}/cancel`);
  
      res.json({ success: true, sessionId: session.id });
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ success: false, error: error.message });
    }
});

// Stripe Webhook handler
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Received webhook event:', event.type);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Checkout session completed:', session.id);
      console.log('Metadata:', session.metadata);
      
      const appointmentId = session.metadata.appointmentId;
      
      try {
        console.log('Updating appointment:', appointmentId);
        const updatedAppointment = await Appointment.findByIdAndUpdate(
          appointmentId,
          { payment: true },
          { new: true }
        );
        
        if (updatedAppointment) {
          console.log(`Payment for appointment ${appointmentId} marked as successful`);
          console.log('Updated appointment:', updatedAppointment);
        } else {
          console.error(`Appointment ${appointmentId} not found`);
        }
      } catch (error) {
        console.error('Error updating appointment payment status:', error);
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a response to acknowledge receipt of the event
  res.json({received: true});
});

// API health check endpoint
app.get("/", (req, res) => {
  res.send("API WORKING");
});

app.listen(port, () => console.log("Server Started", port));