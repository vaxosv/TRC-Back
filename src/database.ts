import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import type { StravaActivity, StravaAthlete } from './types';

/**
 * Thin wrapper around Firebase Realtime Database.
 * All paths are centralised here so callers never hard-code ref strings.
 */
export class DatabaseService {
  // ── Paths ────────────────────────────────────────────────────────────────

  private athleteRef(athleteId: number) {
    return this.db.ref(`athletes/${athleteId}`);
  }

  private activitiesRef(athleteId: number) {
    return this.db.ref(`activities/${athleteId}`);
  }

  // ── Athlete queries ──────────────────────────────────────────────────────

  async getAthlete(athleteId: number): Promise<StravaAthlete | null> {
    try {
      const snapshot = await this.athleteRef(athleteId).once('value');

      if (!snapshot.exists()) {
        logger.warn('Athlete not found', { athleteId });
        return null;
      }

      return snapshot.val() as StravaAthlete;
    } catch (error) {
      logger.error('Failed to read athlete', {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async getAllAthletes(): Promise<Record<number, StravaAthlete>> {
    try {
      const snapshot = await this.db.ref('athletes').once('value');

      if (!snapshot.exists()) {
        logger.warn('No athletes found in database');
        return {};
      }

      return snapshot.val() as Record<number, StravaAthlete>;
    } catch (error) {
      logger.error('Failed to read athletes', { error: toMessage(error) });
      throw error;
    }
  }

  // ── Activity queries ─────────────────────────────────────────────────────

  async getActivities(athleteId: number): Promise<StravaActivity[]> {
    try {
      const snapshot = await this.activitiesRef(athleteId).once('value');

      if (!snapshot.exists()) return [];

      return Object.values(snapshot.val() as Record<string, StravaActivity>);
    } catch (error) {
      logger.error('Failed to read activities', {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async updateAthleteTokens(
    athleteId: number,
    tokens: Pick<StravaAthlete, 'access_token' | 'refresh_token' | 'expires_at'>
  ): Promise<void> {
    try {
      await this.athleteRef(athleteId).update(tokens);
      logger.info('Athlete tokens updated', { athleteId });
    } catch (error) {
      logger.error('Failed to update athlete tokens', {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async saveActivities(athleteId: number, activities: StravaActivity[]): Promise<void> {
    try {
      const updates = Object.fromEntries(activities.map((a) => [a.id.toString(), a]));

      await this.activitiesRef(athleteId).update(updates);

      logger.info('Activities saved', { athleteId, count: activities.length });
    } catch (error) {
      logger.error('Failed to save activities', {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private get db(): admin.database.Database {
    return admin.database();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const dbService = new DatabaseService();
