# Chat Service (Realtime Messaging)

Realtime chat/messaging service that powers the live chat widget on the portfolio website. Visitors can start conversations, and the admin can respond from the admin panel.

## Purpose

This service enables live communication between portfolio visitors and the site owner:

- **Visitors** can start a chat session via the widget on the portfolio site
- **Admin** receives and responds to messages from the admin panel
- Messages are persisted in MongoDB for history
- Supports file attachments (images, PDFs)
- Rooms can be pinned, deleted, and messages can be starred

## Architecture

```
┌─────────────────┐         ┌──────────────────┐
│  Portfolio Site  │         │   Admin Panel    │
│  (Chat Widget)  │         │  (Chat Page)     │
└────────┬────────┘         └────────┬─────────┘
         │                           │
         │  Socket.IO                │  Socket.IO
         │  (visitor namespace)      │  (admin namespace)
         │                           │
         ▼                           ▼
┌─────────────────────────────────────────────┐
│            Chat Service (port 4000)          │
│                                             │
│  ┌───────────┐  ┌───────────┐  ┌────────┐  │
│  │  Express  │  │ Socket.IO │  │ Multer │  │
│  │  (REST)   │  │ (Realtime)│  │(Upload)│  │
│  └─────┬─────┘  └─────┬─────┘  └────┬───┘  │
│        │               │              │      │
│        └───────────────┼──────────────┘      │
│                        │                     │
│                        ▼                     │
│              ┌──────────────────┐            │
│              │     MongoDB      │            │
│              │  (Rooms, Messages,│            │
│              │   Users)         │            │
│              └──────────────────┘            │
└─────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express 5
- **Language**: TypeScript
- **Database**: MongoDB (Mongoose 8)
- **Realtime**: Socket.IO 4
- **Auth**: JWT
- **File Upload**: Multer (images + PDFs)
- **Testing**: Jest + Supertest + mongodb-memory-server + fast-check

## How It Works

### Visitor Chat Flow

1. Visitor opens the chat widget on the portfolio site
2. Enters name and email → POST `/api/chat/start-session`
3. Server creates/finds a Room and returns a session token + room ID
4. Visitor connects to Socket.IO `visitor` namespace with the token
5. Visitor sends messages → server persists and broadcasts to admin namespace
6. Admin replies → server persists and emits to visitor's room

### Admin Chat Flow

1. Admin logs in and navigates to Chat page
2. Admin authenticates with JWT → connects to Socket.IO `admin` namespace
3. Room list loads via GET `/api/chat/rooms`
4. Admin selects a room → messages load via GET `/api/chat/rooms/:roomId/messages`
5. Admin types a reply → emitted via Socket.IO → persisted → emitted to visitor
6. Admin can pin/unpin rooms, star messages, delete rooms

### File Upload Flow

1. Authenticated user (visitor or admin) sends file via POST `/api/chat/upload`
2. Multer saves file to `uploads/chat/` directory
3. Server returns file metadata (URL, filename, size, dimensions for images)
4. Client includes attachment data in the next message

## API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/signup` | — | Register user |
| POST | `/api/signin` | — | Login user |
| GET | `/api/auth` | JWT | Verify token |

### Live Chat (Visitor)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/chat/start-session` | — | Start a visitor chat session |

### Live Chat (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/chat/rooms` | Admin | List all chat rooms |
| GET | `/api/chat/rooms/:roomId/messages` | Admin | Get room messages |
| POST | `/api/chat/rooms/:roomId/read` | Admin | Mark room as read |
| DELETE | `/api/chat/rooms/:roomId` | Admin | Delete a room |

### Pin / Star

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/chat/rooms/:roomId/pin` | Admin | Pin a room |
| DELETE | `/api/chat/rooms/:roomId/pin` | Admin | Unpin a room |
| POST | `/api/chat/messages/:messageId/star` | Admin | Star a message |
| DELETE | `/api/chat/messages/:messageId/star` | Admin | Unstar a message |
| GET | `/api/chat/starred-messages` | Admin | Get all starred messages |

### File Upload

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/chat/upload` | JWT | Upload files (images/PDFs) |

## Socket.IO Namespaces

### `/visitor` (Visitor Namespace)

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-room` | Client → Server | Join a chat room |
| `send-message` | Client → Server | Send a message |
| `new-message` | Server → Client | Receive a message |
| `typing` | Bidirectional | Typing indicator |

### `/admin` (Admin Namespace)

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-room` | Client → Server | Join a room to listen |
| `send-message` | Client → Server | Reply to visitor |
| `new-message` | Server → Client | Receive new message |
| `new-room` | Server → Client | New visitor started a session |
| `typing` | Bidirectional | Typing indicator |

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env`:

```env
PORT=4000
DATABASE_URL=mongodb+srv://...
JWT_SECRET=your-random-secret-string
PORTFOLIO_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174
```

### Run Development Server

```bash
npm run dev
```

### Build for Production

```bash
npm run build
npm start
```

### Run Tests

```bash
npm test
```

## Project Structure

```
src/
├── config/          # Database connection, env vars
├── controllers/     # Route handlers (auth, chat, upload, pin, star)
├── middlewares/      # Auth middleware (JWT + admin check)
├── models/          # Mongoose schemas (Room, Message, User)
├── routes/          # Route registration
├── socket/          # Socket.IO setup (admin + visitor namespaces)
├── utils/           # Validation, admin profile helper
└── index.ts         # Server entry point
uploads/
└── chat/            # Uploaded chat attachments
```

## Data Models

### Room
- `visitorName`, `visitorEmail` — visitor info
- `lastMessage`, `lastMessageAt` — for room list preview
- `unreadCount` — unread messages for admin
- `isPinned` — pinned to top of room list
- `sessionToken` — visitor's session authentication

### Message
- `roomId` — associated room
- `sender` (`visitor` | `admin`)
- `content` — text content
- `attachments[]` — file attachments (url, filename, type, size)
- `isStarred` — bookmarked by admin

### User
- `username`, `password` (bcrypt hashed)
- `role` (`admin` | `user`)
