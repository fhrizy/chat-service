import { Request, Response } from 'express';
import { startSession } from '../controllers/liveChatController';
import { Room } from '../models/Room';
import { Message } from '../models/Message';

// Mock the models
jest.mock('../models/Room');
jest.mock('../models/Message');

describe('startSession', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockReq = { body: {} };
    mockRes = { status: statusMock } as Partial<Response>;
    jest.clearAllMocks();
  });

  it('should return 400 if name is missing', async () => {
    mockReq.body = { email: 'test@example.com' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ message: 'Name is required' });
  });

  it('should return 400 if name is empty/whitespace only', async () => {
    mockReq.body = { name: '   ', email: 'test@example.com' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ message: 'Name is required' });
  });

  it('should return 400 if name exceeds 50 characters', async () => {
    mockReq.body = { name: 'a'.repeat(51), email: 'test@example.com' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ message: 'Name must be 50 characters or less' });
  });

  it('should return 400 if email is missing', async () => {
    mockReq.body = { name: 'John' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ message: 'Email is required' });
  });

  it('should return 400 if email format is invalid', async () => {
    mockReq.body = { name: 'John', email: 'not-an-email' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ message: 'Invalid email format' });
  });

  it('should create/upsert a room and return roomId + messages on valid input', async () => {
    const mockRoom = { _id: 'room123' };
    const mockMessages = [
      { _id: 'msg1', content: 'Hello', createdAt: new Date('2025-01-01') },
      { _id: 'msg2', content: 'Hi there', createdAt: new Date('2025-01-02') },
    ];

    (Room.findOneAndUpdate as jest.Mock).mockResolvedValue(mockRoom);
    (Message.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMessages),
        }),
      }),
    });

    mockReq.body = { name: 'John Doe', email: 'John@Example.COM' };

    await startSession(mockReq as Request, mockRes as Response);

    // Verify Room upsert with lowercased email
    expect(Room.findOneAndUpdate).toHaveBeenCalledWith(
      { visitorEmail: 'john@example.com', type: 'visitor' },
      {
        visitorName: 'John Doe',
        visitorEmail: 'john@example.com',
        type: 'visitor',
        active: true,
        members: ['john@example.com', 'admin'],
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Verify Message query
    expect(Message.find).toHaveBeenCalledWith({ roomId: 'room123' });

    // Verify response
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      roomId: 'room123',
      messages: mockMessages,
    });
  });

  it('should lowercase the email before lookup', async () => {
    const mockRoom = { _id: 'room456' };

    (Room.findOneAndUpdate as jest.Mock).mockResolvedValue(mockRoom);
    (Message.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockReq.body = { name: 'Jane', email: 'JANE@Test.COM' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(Room.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ visitorEmail: 'jane@test.com' }),
      expect.objectContaining({ visitorEmail: 'jane@test.com' }),
      expect.anything()
    );
  });

  it('should return 500 on database error', async () => {
    (Room.findOneAndUpdate as jest.Mock).mockRejectedValue(new Error('DB error'));

    mockReq.body = { name: 'John', email: 'john@example.com' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ message: 'Internal server error' });
  });

  it('should trim the visitor name before storing', async () => {
    const mockRoom = { _id: 'room789' };

    (Room.findOneAndUpdate as jest.Mock).mockResolvedValue(mockRoom);
    (Message.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockReq.body = { name: '  John Doe  ', email: 'john@example.com' };

    await startSession(mockReq as Request, mockRes as Response);

    expect(Room.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ visitorName: 'John Doe' }),
      expect.anything()
    );
  });
});
