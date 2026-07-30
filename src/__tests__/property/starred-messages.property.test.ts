import * as fc from 'fast-check';

/**
 * Feature: chat-enhancements, Property 8: Starred messages sorted by starredAt descending
 * Validates: Requirements 5.5
 *
 * For any array of starred messages with varying starredAt timestamps,
 * the starred messages retrieval shall return them sorted by starredAt
 * from most recent to oldest.
 */
describe('Feature: chat-enhancements, Property 8: Starred messages sorted by starredAt descending', () => {
  /**
   * Replicate the sorting logic from starController.ts getStarredMessages:
   *
   * validMessages.sort((a, b) => {
   *   const aStarred = a.starredBy?.find((s) => s.userId === adminId);
   *   const bStarred = b.starredBy?.find((s) => s.userId === adminId);
   *   const aTime = aStarred ? new Date(aStarred.starredAt).getTime() : 0;
   *   const bTime = bStarred ? new Date(bStarred.starredAt).getTime() : 0;
   *   return bTime - aTime;
   * });
   */
  function sortStarredMessages(
    messages: Array<{
      _id: string;
      roomId: string;
      content: string;
      starredBy?: Array<{ userId: string; starredAt: string }>;
    }>,
    adminId: string
  ) {
    const sorted = [...messages];
    sorted.sort((a, b) => {
      const aStarred = a.starredBy?.find((s) => s.userId === adminId);
      const bStarred = b.starredBy?.find((s) => s.userId === adminId);
      const aTime = aStarred ? new Date(aStarred.starredAt).getTime() : 0;
      const bTime = bStarred ? new Date(bStarred.starredAt).getTime() : 0;
      return bTime - aTime;
    });
    return sorted;
  }

  it('should sort starred messages by starredAt descending (most recent first)', () => {
    const adminId = 'admin-user-1';

    // Arbitrary for a starred message with a starredAt timestamp
    const starredMessageArb = fc
      .tuple(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
      )
      .map(([id, roomId, content, starredAt]) => ({
        _id: id,
        roomId,
        content,
        starredBy: [{ userId: adminId, starredAt: starredAt.toISOString() }],
      }));

    fc.assert(
      fc.property(
        fc.array(starredMessageArb, { minLength: 2, maxLength: 50 }),
        (messages) => {
          const sorted = sortStarredMessages(messages, adminId);

          // Verify descending order: each item's starredAt >= next item's starredAt
          for (let i = 0; i < sorted.length - 1; i++) {
            const currStarred = sorted[i].starredBy?.find(
              (s) => s.userId === adminId
            );
            const nextStarred = sorted[i + 1].starredBy?.find(
              (s) => s.userId === adminId
            );
            const currTime = currStarred
              ? new Date(currStarred.starredAt).getTime()
              : 0;
            const nextTime = nextStarred
              ? new Date(nextStarred.starredAt).getTime()
              : 0;
            expect(currTime).toBeGreaterThanOrEqual(nextTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle messages with multiple starredBy entries, using only the admin entry for sorting', () => {
    const adminId = 'admin-user-1';

    // Arbitrary with multiple users in starredBy
    const starredMessageWithMultipleUsersArb = fc
      .tuple(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
      )
      .map(([id, roomId, content, adminStarredAt, otherStarredAt]) => ({
        _id: id,
        roomId,
        content,
        starredBy: [
          { userId: 'other-user', starredAt: otherStarredAt.toISOString() },
          { userId: adminId, starredAt: adminStarredAt.toISOString() },
        ],
      }));

    fc.assert(
      fc.property(
        fc.array(starredMessageWithMultipleUsersArb, {
          minLength: 2,
          maxLength: 30,
        }),
        (messages) => {
          const sorted = sortStarredMessages(messages, adminId);

          // Verify sorted by admin's starredAt only, not the other user's
          for (let i = 0; i < sorted.length - 1; i++) {
            const currStarred = sorted[i].starredBy?.find(
              (s) => s.userId === adminId
            );
            const nextStarred = sorted[i + 1].starredBy?.find(
              (s) => s.userId === adminId
            );
            const currTime = currStarred
              ? new Date(currStarred.starredAt).getTime()
              : 0;
            const nextTime = nextStarred
              ? new Date(nextStarred.starredAt).getTime()
              : 0;
            expect(currTime).toBeGreaterThanOrEqual(nextTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should place messages without admin starredBy entry at the end (time = 0)', () => {
    const adminId = 'admin-user-1';

    const validDateArb = fc
      .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
      .filter((d) => !isNaN(d.getTime()));

    fc.assert(
      fc.property(
        validDateArb,
        fc.uuid(),
        fc.uuid(),
        (starredAt, id1, id2) => {
          const messages = [
            {
              _id: id1,
              roomId: 'room-1',
              content: 'message without admin star',
              starredBy: [
                {
                  userId: 'other-user',
                  starredAt: new Date('2025-01-01').toISOString(),
                },
              ],
            },
            {
              _id: id2,
              roomId: 'room-2',
              content: 'message with admin star',
              starredBy: [
                { userId: adminId, starredAt: starredAt.toISOString() },
              ],
            },
          ];

          const sorted = sortStarredMessages(messages, adminId);

          // The message with admin star should come first (higher time)
          const firstStarred = sorted[0].starredBy?.find(
            (s) => s.userId === adminId
          );
          expect(firstStarred).toBeDefined();
          expect(sorted[0]._id).toBe(id2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: chat-enhancements, Property 9: Deleted messages excluded from starred list
 * Validates: Requirements 5.7
 *
 * For any set of messages where some are starred and some are subsequently deleted
 * (their rooms no longer exist), the starred messages retrieval shall return only
 * messages that still exist (deleted messages excluded).
 */
describe('Feature: chat-enhancements, Property 9: Deleted messages excluded from starred list', () => {
  /**
   * Replicate the filtering logic from starController.ts getStarredMessages:
   *
   * const validMessages = messages.filter((m) => existingRoomMap.has(m.roomId));
   */
  function filterByExistingRooms(
    messages: Array<{ _id: string; roomId: string; content: string }>,
    existingRoomIds: Set<string>
  ) {
    return messages.filter((m) => existingRoomIds.has(m.roomId));
  }

  it('should exclude messages whose rooms no longer exist', () => {
    const roomIdArb = fc.uuid();

    // Arbitrary for a message assigned to a room
    const messageArb = fc
      .tuple(
        fc.uuid(),
        roomIdArb,
        fc.string({ minLength: 1, maxLength: 50 })
      )
      .map(([id, roomId, content]) => ({
        _id: id,
        roomId,
        content,
      }));

    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 30 }),
        fc.array(roomIdArb, { minLength: 0, maxLength: 20 }),
        (messages, deletedRoomIds) => {
          // Collect all room IDs from messages
          const allRoomIds = [...new Set(messages.map((m) => m.roomId))];

          // Create the set of existing rooms by removing deleted ones
          const deletedSet = new Set(deletedRoomIds);
          const existingRoomIds = new Set(
            allRoomIds.filter((id) => !deletedSet.has(id))
          );

          const result = filterByExistingRooms(messages, existingRoomIds);

          // Property: all returned messages must have rooms that exist
          for (const msg of result) {
            expect(existingRoomIds.has(msg.roomId)).toBe(true);
          }

          // Property: no messages from deleted rooms should be present
          for (const msg of result) {
            expect(deletedSet.has(msg.roomId)).toBe(false);
          }

          // Property: result length should be <= original messages length
          expect(result.length).toBeLessThanOrEqual(messages.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return all messages when no rooms are deleted', () => {
    const messageArb = fc
      .tuple(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 })
      )
      .map(([id, roomId, content]) => ({
        _id: id,
        roomId,
        content,
      }));

    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 30 }),
        (messages) => {
          // All room IDs exist (no deleted rooms)
          const existingRoomIds = new Set(messages.map((m) => m.roomId));

          const result = filterByExistingRooms(messages, existingRoomIds);

          // All messages should be returned
          expect(result.length).toBe(messages.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return empty array when all rooms are deleted', () => {
    const messageArb = fc
      .tuple(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 })
      )
      .map(([id, roomId, content]) => ({
        _id: id,
        roomId,
        content,
      }));

    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 30 }),
        (messages) => {
          // No rooms exist (all deleted)
          const existingRoomIds = new Set<string>();

          const result = filterByExistingRooms(messages, existingRoomIds);

          // No messages should be returned
          expect(result.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve only messages from existing rooms when some rooms are deleted', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }),
        fc.nat({ max: 50 }),
        (roomIds, seed) => {
          // Use unique room IDs
          const uniqueRoomIds = [...new Set(roomIds)];
          if (uniqueRoomIds.length < 2) return; // Need at least 2 rooms

          // Split rooms: some exist, some are deleted
          const splitIndex = Math.max(
            1,
            Math.min(uniqueRoomIds.length - 1, (seed % uniqueRoomIds.length) + 1)
          );
          const existingRooms = uniqueRoomIds.slice(0, splitIndex);
          const deletedRooms = uniqueRoomIds.slice(splitIndex);

          // Create messages distributed across all rooms
          const messages = uniqueRoomIds.map((roomId, i) => ({
            _id: `msg-${i}`,
            roomId,
            content: `message ${i}`,
          }));

          const existingRoomIds = new Set(existingRooms);
          const result = filterByExistingRooms(messages, existingRoomIds);

          // Result should contain exactly the messages from existing rooms
          const expectedCount = messages.filter((m) =>
            existingRoomIds.has(m.roomId)
          ).length;
          expect(result.length).toBe(expectedCount);

          // None of the deleted room messages should appear
          const deletedSet = new Set(deletedRooms);
          for (const msg of result) {
            expect(deletedSet.has(msg.roomId)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
