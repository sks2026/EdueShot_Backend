import mongoose from "mongoose";

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  thumbnail: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
  },
  details: {
    duration: { type: String },
    level: { type: String, enum: ["Beginner", "Intermediate", "Advanced"] },
    requirements: [String],
    content: [String],
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false, // Made optional to allow admin-created courses without teacher
  },
  students: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  playlists: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CoursePlaylist",
    },
  ],
}, { timestamps: true });

const Course = mongoose.model("Course", courseSchema);

export { Course };
