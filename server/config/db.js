import mongoose from "mongoose";

const connectDB = async () => {
  mongoose.connection.on('connected', () => console.log("Database Connected"))
  try {
    await mongoose.connect(process.env.MONGODB_URI)
  } catch (error) {
    // Don't swallow this - if the DB connection fails, every query later on
    // will fail anyway with a confusing "buffering timed out" error instead
    // of the real reason. Log the real error clearly and rethrow so the
    // caller (server.js) knows startup actually failed.
    console.error("❌ Database connection failed:", error.message);
    throw error;
  }
};

export default connectDB;