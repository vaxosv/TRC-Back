import * as logger from "firebase-functions/logger";
import axios, {AxiosInstance} from "axios";
import type {
  ActivityResult,
  StravaActivity,
  StravaApiActivity,
  StravaTokens,
} from "./types";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;

export class StravaClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: STRAVA_API_BASE,
      timeout: 10000,
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<StravaTokens> {
    const {data} = await axios.post("https://www.strava.com/oauth/token", {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
    };
  }

  private async getValidToken(
    tokens: StravaTokens,
  ): Promise<{accessToken: string; refreshedTokens?: StravaTokens}> {
    return {accessToken: tokens.access_token};
  }

  async getRecentActivities(
    tokens: StravaTokens,
    limit = 2,
  ): Promise<ActivityResult> {
    try {
      const {accessToken, refreshedTokens} = await this.getValidToken(tokens);

      const {data} = await this.axiosInstance.get("/athlete/activities", {
        params: {per_page: limit, page: 1},
        headers: {Authorization: `Bearer ${accessToken}`},
      });

      logger.info("Fetched recent activities from Strava", {
        activitiesCount: data.length,
      });

      const apiActivities = data as StravaApiActivity[];
      const activities: StravaActivity[] = apiActivities.map((a) => ({
        id: a.id,
        name: a.name,
        distance: a.distance,
        movingTime: a.moving_time,
        elapsedTime: a.elapsed_time,
        type: a.type,
        startDate: a.start_date,
        averageSpeed: a.average_speed,
        maxSpeed: a.max_speed,
        totalElevationGain: a.total_elevation_gain,
        stravaUrl: `https://www.strava.com/activities/${a.id}`,
        fetchedAt: Date.now(),
      }));

      return {activities, refreshedTokens};
    } catch (error) {
      logger.error("Error fetching Strava activities", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getAthleteDetails(tokens: StravaTokens) {
    try {
      const {accessToken} = await this.getValidToken(tokens);
      const {data} = await this.axiosInstance.get("/athlete", {
        headers: {Authorization: `Bearer ${accessToken}`},
      });
      return data;
    } catch (error) {
      logger.error("Error fetching athlete details", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const stravaClient = new StravaClient();
