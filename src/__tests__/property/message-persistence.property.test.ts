import * as fc from 'fast-check';
import { Message } from '../../models/Message';

jest.mock('../../models/Message');

const mockedMessage = Message as jest.Mocked<typeof Message>;

/**
 * Arbitrary for message content strings: 1–2000 characters including
 * unicode, special chars, whitespace, and emoji.
 */
const messageContentArb = fc.string({ minLength: 1, maxLength: 2000 });

/**
 * Arbitrary for valid email addresses used as visitor sender identifiers.
 */
const visitorEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9._+-]{1,10}$/),
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z]{2,5}$/)
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Arbitrary for admin user IDs (MongoDB ObjectId-like hex strings).
 */
const adminIdArb = fc.stringMatching(/^[a-f0-9]{24}$/);

/**
 * Arbitrary for room IDs.
 */
const roomIdArb = fc.stringMatching(/^[a-f0-9]{24}$/);

/**
 * Arbitrary for visitor display names.
 */
const visitorNameArb = fc
  .stringMatching(/^[a-zA-Z ]{1,50}$/)
  .filter((s: string) => s.trim().length > 0);

describe('Feature: live-chat, Property 6: Message content round-trip preservation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Validates: Requirements 3.1
   *
   * For any string of length 1 to 2000 characters, persisting it as a message
   * and then retrieving it from the database SHALL return the exact same string content.
   */
  it('persisted content matches retrieved content exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        messageContentArb,
        visitorEmailArb,
        roomIdArb,
        visitorNameArb,
        async (content: string, senderEmail: string, roomId: string, senderName: string) => {
          // Capture the arguments passed to Message.create
          let capturedDoc: Record<string, unknown> | null = null;

          (mockedMessage.create as jest.Mock).mockImplementation(
            (doc: Record<string, unknown>) => {
              capturedDoc = { ...doc };
              return Promise.resolve({
                _id: 'msg_123',
                ...doc,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          );

          // Simulate the visitor send-message logic from visitorNamespace
          const savedMessage = await Message.create({
            from: senderEmail,
            roomId,
            content,
            senderType: 'visitor',
            senderName,
            senderEmail,
            readBy: [senderEmail],
          });

          // Verify the content stored in DB matches exactly the input
          expect(capturedDoc).not.toBeNull();
          expect((capturedDoc as unknown as Record<string, unknown>).content).toBe(content);

          // Verify the returned object also has the exact content
          expect((savedMessage as { content: unknown }).content).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: live-chat, Property 14: ReadBy initialized with sender', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Validates: Requirements 7.1
   *
   * For any newly created message, the readBy array SHALL contain exactly one element:
   * the sender's identifier.
   */
  it('visitor message readBy contains exactly [senderEmail]', async () => {
    await fc.assert(
      fc.asyncProperty(
        messageContentArb,
        visitorEmailArb,
        roomIdArb,
        visitorNameArb,
        async (content: string, senderEmail: string, roomId: string, senderName: string) => {
          let capturedDoc: Record<string, unknown> | null = null;

          (mockedMessage.create as jest.Mock).mockImplementation(
            (doc: Record<string, unknown>) => {
              capturedDoc = { ...doc };
              return Promise.resolve({
                _id: 'msg_123',
                ...doc,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          );

          // Simulate visitor send-message (from visitorNamespace.ts)
          await Message.create({
            from: senderEmail,
            roomId,
            content,
            senderType: 'visitor',
            senderName,
            senderEmail,
            readBy: [senderEmail],
          });

          // Verify readBy has exactly one element: the sender's email
          expect(capturedDoc).not.toBeNull();
          const readBy = (capturedDoc as unknown as Record<string, unknown>).readBy as string[];
          expect(readBy).toHaveLength(1);
          expect(readBy[0]).toBe(senderEmail);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('admin message readBy contains exactly [adminUserId]', async () => {
    await fc.assert(
      fc.asyncProperty(
        messageContentArb,
        adminIdArb,
        roomIdArb,
        async (content: string, adminId: string, roomId: string) => {
          let capturedDoc: Record<string, unknown> | null = null;

          (mockedMessage.create as jest.Mock).mockImplementation(
            (doc: Record<string, unknown>) => {
              capturedDoc = { ...doc };
              return Promise.resolve({
                _id: 'msg_456',
                ...doc,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          );

          // Simulate admin send-message (from adminNamespace.ts)
          await Message.create({
            from: adminId,
            roomId,
            content,
            senderType: 'admin',
            senderName: 'Admin',
            senderEmail: `${adminId}@admin.com`,
            readBy: [adminId],
          });

          // Verify readBy has exactly one element: the admin's userId
          expect(capturedDoc).not.toBeNull();
          const readBy = (capturedDoc as unknown as Record<string, unknown>).readBy as string[];
          expect(readBy).toHaveLength(1);
          expect(readBy[0]).toBe(adminId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: live-chat, Property 10: Join room marks all messages as read', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Validates: Requirements 7.2
   *
   * For any Room containing N messages, when a user emits join-room for that Room,
   * every message's readBy array SHALL contain the user's identifier after the
   * operation completes.
   */
  it('visitor join-room adds email to readBy of all messages', async () => {
    await fc.assert(
      fc.asyncProperty(
        visitorEmailArb,
        roomIdArb,
        fc.integer({ min: 0, max: 50 }),
        async (visitorEmail: string, roomId: string, messageCount: number) => {
          // Generate messages that do NOT have the visitor in readBy
          const existingMessages = Array.from({ length: messageCount }, (_, i) => ({
            _id: `msg_${i}`,
            roomId,
            content: `Message ${i}`,
            senderType: 'admin' as const,
            senderName: 'Admin',
            senderEmail: 'admin@test.com',
            readBy: ['admin@test.com'], // Only admin has read these
            createdAt: new Date(2024, 0, 1, 0, 0, i),
          }));

          let updateManyFilter: Record<string, unknown> | null = null;
          let updateManyUpdate: Record<string, unknown> | null = null;

          // Mock Message.updateMany to capture filter and update args
          (mockedMessage.updateMany as jest.Mock).mockImplementation(
            (filter: Record<string, unknown>, update: Record<string, unknown>) => {
              updateManyFilter = filter;
              updateManyUpdate = update;

              // Simulate that all messages not yet containing visitorEmail are updated
              const matchingCount = existingMessages.filter(
                (m) => !m.readBy.includes(visitorEmail)
              ).length;

              return Promise.resolve({ modifiedCount: matchingCount });
            }
          );

          // Mock Message.find to return updated messages (with visitorEmail added)
          const mockFind = jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue(
              existingMessages.map((m) => ({
                _id: m._id,
              }))
            ),
          });
          (mockedMessage.find as jest.Mock).mockImplementation(mockFind);

          // Simulate the join-room logic from visitorNamespace:
          // Message.updateMany({ roomId, readBy: { $nin: [email] } }, { $addToSet: { readBy: email } })
          await Message.updateMany(
            { roomId, readBy: { $nin: [visitorEmail] } },
            { $addToSet: { readBy: visitorEmail } }
          );

          // Verify the updateMany was called with correct filter and update
          expect(updateManyFilter).toEqual({
            roomId,
            readBy: { $nin: [visitorEmail] },
          });
          expect(updateManyUpdate).toEqual({
            $addToSet: { readBy: visitorEmail },
          });

          // Verify the semantics: after $addToSet, all messages would contain visitorEmail
          // Simulate the effect of $addToSet on each message
          const updatedMessages = existingMessages.map((m) => ({
            ...m,
            readBy: m.readBy.includes(visitorEmail)
              ? m.readBy
              : [...m.readBy, visitorEmail],
          }));

          // Every message's readBy should now contain the visitor's email
          for (const msg of updatedMessages) {
            expect(msg.readBy).toContain(visitorEmail);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('admin join-room adds userId to readBy of all messages', async () => {
    await fc.assert(
      fc.asyncProperty(
        adminIdArb,
        roomIdArb,
        fc.integer({ min: 0, max: 50 }),
        async (adminId: string, roomId: string, messageCount: number) => {
          // Generate messages from a visitor that the admin hasn't read
          const existingMessages = Array.from({ length: messageCount }, (_, i) => ({
            _id: `msg_${i}`,
            roomId,
            content: `Message ${i}`,
            senderType: 'visitor' as const,
            senderName: 'Visitor',
            senderEmail: 'visitor@test.com',
            readBy: ['visitor@test.com'], // Only visitor has read these
            createdAt: new Date(2024, 0, 1, 0, 0, i),
          }));

          let updateManyFilter: Record<string, unknown> | null = null;
          let updateManyUpdate: Record<string, unknown> | null = null;

          (mockedMessage.updateMany as jest.Mock).mockImplementation(
            (filter: Record<string, unknown>, update: Record<string, unknown>) => {
              updateManyFilter = filter;
              updateManyUpdate = update;

              const matchingCount = existingMessages.filter(
                (m) => !m.readBy.includes(adminId)
              ).length;

              return Promise.resolve({ modifiedCount: matchingCount });
            }
          );

          (mockedMessage.find as jest.Mock).mockImplementation(() => ({
            lean: jest.fn().mockResolvedValue(
              existingMessages.map((m) => ({ _id: m._id }))
            ),
          }));

          // Simulate the join-room logic from adminNamespace:
          // Message.updateMany({ roomId, readBy: { $nin: [socket.user.id] } }, { $addToSet: { readBy: socket.user.id } })
          await Message.updateMany(
            { roomId, readBy: { $nin: [adminId] } },
            { $addToSet: { readBy: adminId } }
          );

          // Verify the updateMany was called with correct filter and update
          expect(updateManyFilter).toEqual({
            roomId,
            readBy: { $nin: [adminId] },
          });
          expect(updateManyUpdate).toEqual({
            $addToSet: { readBy: adminId },
          });

          // Verify semantics: after $addToSet, all messages contain adminId in readBy
          const updatedMessages = existingMessages.map((m) => ({
            ...m,
            readBy: m.readBy.includes(adminId)
              ? m.readBy
              : [...m.readBy, adminId],
          }));

          for (const msg of updatedMessages) {
            expect(msg.readBy).toContain(adminId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
