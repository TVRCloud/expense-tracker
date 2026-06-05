import mongoose from "mongoose";
import { config } from "./config";

declare global {
  var mongooseGlobal: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

const globalAny = global as typeof globalThis & {
  mongooseGlobal?: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
};

if (!globalAny.mongooseGlobal) {
  globalAny.mongooseGlobal = { conn: null, promise: null };
}

const cached = globalAny.mongooseGlobal;

export default async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(config.mongodb.uri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 10000,
      })
      .then((instance) => {
        console.warn("✅ MongoDB connected:", instance.connection.name);
        return instance;
      })
      .catch((err) => {
        console.error("❌ MongoDB connection failed:", err.message);
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
