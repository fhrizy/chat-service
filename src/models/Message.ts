import mongoose, { Schema, Document } from 'mongoose';

// Legacy content sub-document structure (for backward compatibility with old messages)
export interface IMessageContent {
  type: string;
  name: string;
  username: string;
  message: string;
  readBy: string[];
  timeSend: string;
  timeReceived: Date;
}

export interface IAttachment {
  url: string;
  fileName: string;
  fileSize: number; // bytes
  mimeType: string;
  isImage: boolean;
  width?: number; // for images
  height?: number; // for images
}

export interface IStarredInfo {
  userId: string;
  starredAt: Date;
}

export interface IMessage extends Document {
  from: string;
  roomId: string;
  // Legacy: content as sub-document for old messages
  content: IMessageContent | string;
  // New live-chat fields
  senderType?: 'visitor' | 'admin';
  senderName?: string;
  senderEmail?: string;
  readBy: string[];
  // Chat enhancement fields
  attachments?: IAttachment[];
  starredBy?: IStarredInfo[];
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, required: true },
    isImage: { type: Boolean, required: true },
    width: { type: Number },
    height: { type: Number },
  },
  { _id: false }
);

const StarredInfoSchema = new Schema<IStarredInfo>(
  {
    userId: { type: String, required: true },
    starredAt: { type: Date, required: true },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    from: { type: String, required: true },
    roomId: { type: String, required: true, index: true },
    // Mixed type to support both legacy sub-document and new plain string content
    content: { type: Schema.Types.Mixed, required: true },
    // New live-chat fields (optional for backward compatibility)
    senderType: { type: String, enum: ['visitor', 'admin'] },
    senderName: { type: String },
    senderEmail: { type: String },
    readBy: { type: [String], default: [] },
    // Chat enhancement fields
    attachments: { type: [AttachmentSchema], default: undefined },
    starredBy: { type: [StarredInfoSchema], default: undefined },
  },
  { timestamps: true }
);

// Compound index for efficient history queries (roomId + createdAt)
MessageSchema.index({ roomId: 1, createdAt: 1 });

// Index for efficient starred message queries
MessageSchema.index({ 'starredBy.userId': 1 });

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
