import mongoose from 'mongoose';

const coursePlaylistSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  contentType: {
    type: String,
    enum: ['video', 'audio', 'document', 'text', 'full', 'reel'],
    required: true
  },
  category: { type: String, required: true },
  videoFile: { type: String }, // Filename of uploaded video/audio file
  thumbnail: { type: String, required: true }, // Filename of thumbnail image
  course: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Course', 
    required: true 
  },
  teacher: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  order: { type: Number, default: 1 }, // Order within the course playlist
  duration: { type: Number }, // Duration in seconds
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isFree: { type: Boolean, default: false }, // First intro video can be free
  // Soft delete flag
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date }
}, { timestamps: true });

export const CoursePlaylist = mongoose.model('CoursePlaylist', coursePlaylistSchema);
export default CoursePlaylist;
