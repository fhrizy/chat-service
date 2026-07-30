import * as fc from 'fast-check';
import { Request, Response } from 'express';
import { startSession } from '../../controllers/liveChatController';
import { Room } from '../../models/Room';
import { Message } from '../../models/Message';

jest.mock('../../models/Room');
jest.mock('../../models/Message');

const mockedRoom = Room as jest.Mocked<typeof Room>;
const mockedMessage = Message as jest.Mocked<typeof Message>;

/**
 * Helper to create a mock Express Request
 */
function mockRequest(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

/**
 * Helper to create a mock Express Response that captures status and json calls
 */
function mockResponse(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
  } as unknown as Response & { _status: number; _json: unknown };
  return res;
}

/**
 * Arbitrary for valid email addresses that pass the controller's validation:
 * non-empty local, non-empty domain, tld at least 2 chars, no spaces or @.
 */
const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9._+-]{1,10}$/),
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z]{2,5}$/)
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Arbitrary for valid visitor names: 1-50 characters that are not whitespace-only after trim
 */
const validNameArb = fc
  .stringMatching(/^[a-zA-Z ]{1,50}$/)
  .filter((s: string) => s.trim().length > 0 && s.trim().length <= 50);

describe('Feature: live-chat, Property 1: Room identity idempotence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Validates: Requirements 2.2
   *
   * For any valid email address, calling start-session multiple times with that email
   * SHALL always return the same roomId, regardless of the name provided.
   */
  it('same email always returns same roomId', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validNameArb,
        validNameArb,
        async (email: string, name1: string, name2: string) => {
          // Generate a stable roomId for this email
          const stableRoomId = `room_${email.toLowerCase()}`;

          // Mock Room.findOneAndUpdate to always return the same room for same email
          (mockedRoom.findOneAndUpdate as jest.Mock).mockResolvedValue({
            _id: { toString: () => stableRoomId },
            visitorEmail: email.toLowerCase(),
            visitorName: name2.trim(),
            type: 'visitor',
            active: true,
            members: [email.toLowerCase(), 'admin'],
          });

          // Mock Message.find to return a chainable query
          const mockQuery = {
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
          };
          (mockedMessage.find as jest.Mock).mockReturnValue(mockQuery);

          // First call
          const req1 = mockRequest({ name: name1, email });
          const res1 = mockResponse();
          await startSession(req1, res1);

          // Second call with same email, different name
          const req2 = mockRequest({ name: name2, email });
          const res2 = mockResponse();
          await startSession(req2, res2);

          // Both should return same roomId
          expect(res1._status).toBe(200);
          expect(res2._status).toBe(200);
          const json1 = res1._json as { roomId: string };
          const json2 = res2._json as { roomId: string };
          expect(json1.roomId).toBe(json2.roomId);
          expect(json1.roomId).toBe(stableRoomId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: live-chat, Property 5: Visitor name upsert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Validates: Requirements 2.6
   *
   * For any email and any sequence of session starts with names [n1, n2, ..., nK],
   * the stored visitorName for the Room associated with that email SHALL equal nK
   * (the last name provided).
   */
  it('stored name equals last submitted name', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        fc.array(validNameArb, { minLength: 1, maxLength: 5 }),
        async (email: string, names: string[]) => {
          let storedVisitorName = '';

          // Mock Room.findOneAndUpdate to track the latest visitorName
          (mockedRoom.findOneAndUpdate as jest.Mock).mockImplementation(
            (_filter: unknown, update: { visitorName: string }) => {
              storedVisitorName = update.visitorName;
              return Promise.resolve({
                _id: { toString: () => `room_${email.toLowerCase()}` },
                visitorEmail: email.toLowerCase(),
                visitorName: storedVisitorName,
                type: 'visitor',
                active: true,
                members: [email.toLowerCase(), 'admin'],
              });
            }
          );

          // Mock Message.find chainable query
          const mockQuery = {
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
          };
          (mockedMessage.find as jest.Mock).mockReturnValue(mockQuery);

          // Call startSession for each name in sequence
          for (const name of names) {
            const req = mockRequest({ name, email });
            const res = mockResponse();
            await startSession(req, res);
            expect(res._status).toBe(200);
          }

          // The stored name should equal the last name provided (trimmed)
          const lastNameTrimmed = names[names.length - 1].trim();
          expect(storedVisitorName).toBe(lastNameTrimmed);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: live-chat, Property 4: Message history limit and ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Validates: Requirements 2.5
   *
   * For any Room containing N messages (N >= 0), loading the message history SHALL
   * return exactly min(N, 50) messages, and those messages SHALL be ordered by
   * createdAt timestamp ascending (oldest first).
   */
  it('returns min(N, 50) messages in ascending order', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validNameArb,
        fc.integer({ min: 0, max: 100 }),
        async (email: string, name: string, messageCount: number) => {
          const roomId = `room_${email.toLowerCase()}`;

          // Generate N messages with sequential timestamps
          const allMessages = Array.from({ length: messageCount }, (_, i) => ({
            _id: `msg_${i}`,
            roomId,
            content: `Message ${i}`,
            senderType: i % 2 === 0 ? 'visitor' : 'admin',
            senderName: i % 2 === 0 ? name : 'Admin',
            senderEmail: i % 2 === 0 ? email : 'admin@test.com',
            readBy: [email],
            createdAt: new Date(2024, 0, 1, 0, 0, i), // Sequential timestamps
          }));

          // The controller uses .sort({ createdAt: 1 }).limit(50).lean()
          // So it returns the first 50 (oldest) messages sorted ascending
          const expectedMessages = allMessages.slice(0, Math.min(messageCount, 50));

          // Mock Room.findOneAndUpdate
          (mockedRoom.findOneAndUpdate as jest.Mock).mockResolvedValue({
            _id: { toString: () => roomId },
            visitorEmail: email.toLowerCase(),
            visitorName: name.trim(),
            type: 'visitor',
            active: true,
            members: [email.toLowerCase(), 'admin'],
          });

          // Mock Message.find with chainable query that respects sort + limit
          const mockQuery = {
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue(expectedMessages),
          };
          (mockedMessage.find as jest.Mock).mockReturnValue(mockQuery);

          const req = mockRequest({ name, email });
          const res = mockResponse();
          await startSession(req, res);

          expect(res._status).toBe(200);
          const json = res._json as { roomId: string; messages: Array<{ createdAt: Date }> };

          // Verify message count is min(N, 50)
          expect(json.messages.length).toBe(Math.min(messageCount, 50));

          // Verify messages are in ascending order by createdAt
          for (let i = 1; i < json.messages.length; i++) {
            const prev = new Date(json.messages[i - 1].createdAt).getTime();
            const curr = new Date(json.messages[i].createdAt).getTime();
            expect(curr).toBeGreaterThanOrEqual(prev);
          }

          // Verify Message.find was called with correct roomId and sort/limit
          expect(mockedMessage.find).toHaveBeenCalledWith({ roomId });
          expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: 1 });
          expect(mockQuery.limit).toHaveBeenCalledWith(50);
        }
      ),
      { numRuns: 100 }
    );
  });
});
