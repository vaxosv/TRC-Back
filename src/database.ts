import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import type {StravaActivity, StravaTokens, StravaUserData, UserData} from "./types";

/**
 * Thin wrapper around Firebase Realtime Database.
 * All paths are centralised here so callers never hard-code ref strings.
 */
export class DatabaseService {
  // ── Paths ────────────────────────────────────────────────────────────────

  private stravaUserRef(athleteId: number) {
    return this.db.ref(`stravaUsers/${athleteId}`);
  }

  private userRef(uid: string) {
    return this.db.ref(`users/${uid}`);
  }

  private activitiesRef(athleteId: number) {
    return this.db.ref(`activities/${athleteId}`);
  }

  // ── User queries ─────────────────────────────────────────────────────────

  async getStravaUser(athleteId: number): Promise<StravaUserData | null> {
    try {
      const snapshot = await this.stravaUserRef(athleteId).once("value");

      if (!snapshot.exists()) {
        logger.warn("Strava user not found", {athleteId});
        return null;
      }

      return snapshot.val() as StravaUserData;
    } catch (error) {
      logger.error("Failed to read Strava user", {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async getUser(uid: string): Promise<UserData | null> {
    try {
      const snapshot = await this.userRef(uid).once("value");

      if (!snapshot.exists()) {
        logger.warn("App user not found", {uid});
        return null;
      }

      return snapshot.val() as UserData;
    } catch (error) {
      logger.error("Failed to read app user", {
        uid,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async getAllStravaUsers(): Promise<Record<number, StravaUserData>> {
    try {
      const snapshot = await this.db.ref("stravaUsers").once("value");

      if (!snapshot.exists()) {
        logger.warn("No Strava users found in database");
        return {};
      }

      return snapshot.val() as Record<number, StravaUserData>;
    } catch (error) {
      logger.error("Failed to read Strava users", {error: toMessage(error)});
      throw error;
    }
  }

  // ── Activity queries ─────────────────────────────────────────────────────

  async getActivities(athleteId: number): Promise<StravaActivity[]> {
    try {
      const snapshot = await this.activitiesRef(athleteId).once("value");

      if (!snapshot.exists()) return [];

      return Object.values(snapshot.val() as Record<string, StravaActivity>);
    } catch (error) {
      logger.error("Failed to read activities", {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async updateStravaTokens(athleteId: number, tokens: StravaTokens): Promise<void> {
    try {
      const updateData = {
        ...tokens,
        updatedAt: new Date().toISOString(),
      };
      await this.stravaUserRef(athleteId).update(updateData);
      logger.info("Strava tokens updated", {athleteId});
    } catch (error) {
      logger.error("Failed to update Strava tokens", {
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

      logger.info("Activities saved", {athleteId, count: activities.length});
    } catch (error) {
      logger.error("Failed to save activities", {
        athleteId,
        error: toMessage(error),
      });
      throw error;
    }
  }

  async deleteActivity(athleteId: number, activityId: number): Promise<void> {
    try {
      await this.activitiesRef(athleteId).child(activityId.toString()).remove();
      logger.info("Activity deleted", {athleteId, activityId});
    } catch (error) {
      logger.error("Failed to delete activity", {
        athleteId,
        activityId,
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
