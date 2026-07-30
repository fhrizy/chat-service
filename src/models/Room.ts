import mongoose, { Schema, Document } from 'mongoose';

export interface IPinInfo {
  userId: string;
  pinnedAt: Date;
}

export interface IRoom extends Document {
  active: boolean;
  name: string;
  type: 'private' | 'group' | 'visitor';
  members: string[];
  visitorName?: string;
  visitorEmail?: string;
  // Chat enhancement fields
  pinnedBy?: IPinInfo[];
  createdAt: Date;
  updatedAt: Date;
}

const PinInfoSchema = new Schema<IPinInfo>(
  {
    userId: { type: String, required: true },
    pinnedAt: { type: Date, required: true },
  },
  { _id: false }
);

const RoomSchema = new Schema<IRoom>(
  {
    active: { type: Boolean, default: true },
    name: { type: String, default: '' },
    type: { type: String, enum: ['private', 'group', 'visitor'], required: true },
    members: { type: [String], required: true },
    visitorName: {
      type: String,
      required: function (this: IRoom) {
        return this.type === 'visitor';
      },
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    visitorEmail: {
      type: String,
      required: function (this: IRoom) {
        return this.type === 'visitor';
      },
      trim: true,
      lowercase: true,
    },
    // Chat enhancement fields
    pinnedBy: { type: [PinInfoSchema], default: undefined },
  },
  { timestamps: true }
);

// Unique sparse index: unique among documents that have visitorEmail set,
// but allows null/missing values (for existing private/group rooms)
RoomSchema.index({ visitorEmail: 1 }, { unique: true, sparse: true });

// Index for efficient pinned room queries
RoomSchema.index({ 'pinnedBy.userId': 1 });

export const Room = mongoose.model<IRoom>('Room', RoomSchema);
