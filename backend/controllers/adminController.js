import validator from "validator";
import bcrypt from "bcryptjs";
import { v2 as cloudinary } from "cloudinary";
import doctorModel from "../models/doctorModel.js";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import appointmentModel from "../models/appointmentModel.js";
import userModel from "../models/userModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to clean quotes from strings
const cleanQuotes = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/^"|"$/g, "").trim();
};

const addDoctor = async (req, res) => {
  try {
    // Clean quotes from all form fields
    const name = cleanQuotes(req.body.name);
    const email = cleanQuotes(req.body.email);
    const password = cleanQuotes(req.body.password);
    const speciality = cleanQuotes(req.body.speciality);
    const degree = cleanQuotes(req.body.degree);
    const experience = cleanQuotes(req.body.experience);
    const about = cleanQuotes(req.body.about);
    const fees = cleanQuotes(req.body.fees);
    const address = req.body.address; // Will handle this separately

    // Log cleaned data for debugging
    console.log("Cleaned data:", {
      name,
      email,
      speciality,
      degree,
      experience,
      about,
      fees,
      address,
    });

    // Check if file exists
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Image file is required" });
    }

    // checking for all required fields
    if (
      !name ||
      !email ||
      !password ||
      !speciality ||
      !degree ||
      !experience ||
      !about ||
      !fees ||
      !address
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing Details",
        received: {
          name: !!name,
          email: !!email,
          password: !!password,
          speciality: !!speciality,
          degree: !!degree,
          experience: !!experience,
          about: !!about,
          fees: !!fees,
          address: !!address,
        },
      });
    }

    // validating email format
    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email",
        receivedEmail: email,
      });
    }

    // validating strong password
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    // Check if doctor with email already exists
    const existingDoctor = await doctorModel.findOne({ email });
    if (existingDoctor) {
      return res.status(400).json({
        success: false,
        message: "Doctor with this email already exists",
      });
    }

    // hashing doctor password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // upload image to cloudinary
    const uploadsDir = path.join(__dirname, "..", "uploads");
    const imagePath = path.join(uploadsDir, req.file.filename);

    const imageUpload = await cloudinary.uploader.upload(imagePath, {
      resource_type: "image",
    });
    const imageUrl = imageUpload.secure_url;

    // Clean up the local file after upload to cloudinary
    fs.unlink(imagePath, (err) => {
      if (err) console.error("Error deleting local file:", err);
    });

    // Parse address
    let parsedAddress;
    try {
      parsedAddress =
        typeof address === "string" ? JSON.parse(address) : address;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid address format. Please provide a valid JSON object",
        receivedAddress: address,
      });
    }

    const doctorData = {
      name,
      email,
      image: imageUrl,
      password: hashedPassword,
      speciality,
      degree,
      experience,
      about,
      fees: Number(fees),
      address: parsedAddress,
      date: Date.now(),
    };

    const newDoctor = new doctorModel(doctorData);
    await newDoctor.save();

    res.status(201).json({
      success: true,
      message: "Doctor added successfully",
      doctor: {
        name: newDoctor.name,
        email: newDoctor.email,
        speciality: newDoctor.speciality,
        image: newDoctor.image,
      },
    });
  } catch (error) {
    console.error("Error in addDoctor:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// API For admin Login
const loginAdmin = async (req, res) => {
  console.log("🔒 Admin login attempt from:", req.headers.origin);
  try {
    const { email, password } = req.body;

    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign(email + password, process.env.JWT_SECRET);
      res.json({ success: true, token });
    } else {
      res.json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get all doctors list for admin panel
const allDoctors = async (req, res) => {
  try {
    const doctors = await doctorModel.find({}).select("-password");
    res.json({ success: true, doctors });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// API to get all appointments list

const appointmentsAdmin = async (req, res) => {
  try {
    const appointments = await appointmentModel.find({});
    res.json({ success: true, appointments });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// API for appointment cancellation

//  API to cancel appointment
const appointmentCancel = async (req, res) => {
  try {
    const { userId, appointmentId } = req.body;

    // Check if userId and appointmentId are provided
    if (!userId || !appointmentId) {
      return res.status(400).json({ success: false, message: "Missing userId or appointmentId" });
    }

    const appointmentData = await appointmentModel.findById(appointmentId);

    // Check if the appointment exists
    if (!appointmentData) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    // Check if appointmentData.userId exists
    if (!appointmentData.userId) {
      return res.status(500).json({ success: false, message: "Appointment data is corrupted" });
    }

    // Verify that the logged-in user is the owner of the appointment
    if (appointmentData.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized Action" });
    }

    await appointmentModel.findByIdAndUpdate(appointmentId, {
      cancelled: true,
    });

    // Releasing doctor's time slot
    const { docId, slotDate, slotTime } = appointmentData;
    const doctorData = await doctorModel.findById(docId);

    if (!doctorData) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }

    let slots_booked = doctorData.slots_booked || {};
    if (slots_booked[slotDate]) {
      slots_booked[slotDate] = slots_booked[slotDate].filter(
        (e) => e !== slotTime
      );
    }

    await doctorModel.findByIdAndUpdate(docId, { slots_booked });

    res.json({ success: true, message: "Appointment Cancelled" });
  } catch (error) {
    console.error("Error in appointmentCancel:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// API to get dashboard data for admin panel

const adminDashboard = async (req, res) => {
  try {
    const doctors = await doctorModel.find({});
    const users = await userModel.find({});
    const appointments = await appointmentModel.find({});

    const dashData = {
      doctors: doctors.length,
      appointments: appointments.length,
      patients: users.length,
      latestAppointments: appointments.reverse().slice(0, 5),
    };

    res.json({ success: true, dashData });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export {
  addDoctor,
  loginAdmin,
  allDoctors,
  appointmentsAdmin,
  appointmentCancel,
  adminDashboard,
};
