import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  username: string;
  hash: string;
  role: string;
  contacts: Array<{
    id: string;
    name: string;
    username: string;
    role: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    hash: { type: String, required: true },
    role: { type: String, required: true },
    contacts: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);
