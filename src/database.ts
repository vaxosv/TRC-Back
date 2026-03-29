import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import type {StravaActivity, StravaAthlete, StravaTokens} from "./types";

/**
 * Database service for Firebase Realtime Database operations
 */
export class DatabaseService {
  private db: admin.database.Database | null = null;

  /**
   * Get athlete by Strava athlete ID
   * @param {number} athleteId - Strava athlete ID
   */
  async getAthlete(athleteId: number): Promise<StravaAthlete | null> {
    try {
      const snapshot = await this.getDatabase()
        .ref(`athletes/${athleteId}`)
        .once("value");

      if (!snapshot.exists()) {
        logger.warn(`Athlete not found: ${athleteId}`);
        return null;
      }

      return snapshot.val() as StravaAthlete;
    } catch (error) {
      logger.error("Error reading athlete from database", {
        athleteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all athletes from Realtime Database
   */
  async getAllAthletes(): Promise<Record<number, StravaAthlete>> {
    try {
      const snapshot = await this.getDatabase().ref("athletes").once("value");

      if (!snapshot.exists()) {
        logger.warn("No athletes found in database");
        return {};
      }

      return snapshot.val() as Record<number, StravaAthlete>;
    } catch (error) {
      logger.error("Error reading athletes from database", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update athlete tokens after Strava token refresh
   * @param {number} athleteId - Strava athlete ID
   * @param {StravaTokens} tokens - Refreshed tokens to persist
   */
  async updateAthleteTokens(
    athleteId: number,
    tokens: StravaTokens,
  ): Promise<void> {
    try {
      await this.getDatabase().ref(`athletes/${athleteId}`).update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      });
      logger.info("Athlete tokens updated", {athleteId});
    } catch (error) {
      logger.error("Error updating athlete tokens", {
        athleteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Save activities for an athlete
   * @param {number} athleteId - Strava athlete ID
   * @param {StravaActivity[]} activities - Array of activities to save
   */
  async saveActivities(
    athleteId: number,
    activities: StravaActivity[],
  ): Promise<void> {
    try {
      const activitiesRef = this.getDatabase().ref(`activities/${athleteId}`);

      const updates: Record<string, StravaActivity> = {};
      activities.forEach((activity) => {
        updates[activity.id.toString()] = activity;
      });

      await activitiesRef.update(updates);

      logger.info("Activities saved successfully", {
        athleteId,
        count: activities.length,
      });
    } catch (error) {
      logger.error("Error saving activities to database", {
        athleteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get activities for an athlete
   * @param {number} athleteId - Strava athlete ID
   */
  async getActivities(athleteId: number): Promise<StravaActivity[]> {
    try {
      const snapshot = await this.getDatabase()
        .ref(`activities/${athleteId}`)
        .once("value");

      if (!snapshot.exists()) {
        return [];
      }

      const activitiesObj = snapshot.val() as Record<string, StravaActivity>;
      return Object.values(activitiesObj);
    } catch (error) {
      logger.error("Error reading activities from database", {
        athleteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Initialize Firebase Realtime Database connection
   * @return {admin.database.Database} The Firebase database instance
   */
  private getDatabase(): admin.database.Database {
    if (!this.db) {
      this.db = admin.database();
    }
    return this.db;
  }
}

export const dbService = new DatabaseService();
