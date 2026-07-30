import mongoose from 'mongoose';

/**
 * Fetches the admin profile name and contact email from the shared MongoDB.
 * These come from the Profile and Contact singleton collections
 * managed by admin-service.
 */
export async function getAdminProfile(): Promise<{ name: string; email: string }> {
  const db = mongoose.connection.db;
  if (!db) {
    return { name: 'Admin', email: '' };
  }

  try {
    const [profile, contact] = await Promise.all([
      db.collection('profiles').findOne({}),
      db.collection('contacts').findOne({}),
    ]);

    return {
      name: profile?.name || 'Admin',
      email: contact?.email || '',
    };
  } catch {
    return { name: 'Admin', email: '' };
  }
}
