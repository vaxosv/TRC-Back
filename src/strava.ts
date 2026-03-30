import * as logger from "firebase-functions/logger";
import axios, {AxiosInstance} from "axios";
import type {ActivityResult, StravaActivity, StravaApiActivity, StravaTokens} from "./types";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

const CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;

export class StravaClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({baseURL: STRAVA_API_BASE, timeout: 10_000});
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async getRecentActivities(tokens: StravaTokens, limit = 2): Promise<ActivityResult> {
    try {
      const {accessToken, refreshedTokens} = await this.getValidToken(tokens);

      const {data} = await this.http.get<StravaApiActivity[]>("/athlete/activities", {
        params: {per_page: limit, page: 1},
        headers: this.authHeader(accessToken),
      });

      logger.info("Fetched activities from Strava", {count: data.length});

      return {activities: data.map(this.mapActivity), refreshedTokens};
    } catch (error) {
      logger.error("Failed to fetch Strava activities", {
        error: toMessage(error),
      });
      throw error;
    }
  }

  async getAthleteDetails(tokens: StravaTokens): Promise<unknown> {
    try {
      const {accessToken} = await this.getValidToken(tokens);

      const {data} = await this.http.get("/athlete", {
        headers: this.authHeader(accessToken),
      });

      return data;
    } catch (error) {
      logger.error("Failed to fetch athlete details", {
        error: toMessage(error),
      });
      throw error;
    }
  }

  // ── Token management ─────────────────────────────────────────────────────

  async refreshAccessToken(refreshToken: string): Promise<StravaTokens> {
    const {data} = await axios.post(STRAVA_TOKEN_URL, {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
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
    tokens: StravaTokens
  ): Promise<{accessToken: string; refreshedTokens?: StravaTokens}> {
    const expiresAt = Number(tokens.expires_at);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER_SECONDS = 5 * 60;
    const needsRefresh =
      !expiresAt || !tokens.access_token || expiresAt - nowSeconds <= REFRESH_BUFFER_SECONDS;

    if (!needsRefresh) {
      logger.info("Strava access token is still valid", {
        expiresIn: expiresAt - nowSeconds,
        expiresAt,
      });
      return {accessToken: tokens.access_token};
    }

    logger.info("Strava access token needs refresh", {
      reason: !tokens.access_token
        ? "missing_access_token"
        : !expiresAt
          ? "invalid_expires_at"
          : "expired_or_expiring_soon",
      expiresAt,
      nowSeconds,
      secondsRemaining: expiresAt ? expiresAt - nowSeconds : null,
    });

    const refreshedTokens = await this.refreshAccessToken(tokens.refresh_token);

    logger.info("Strava access token refreshed successfully", {
      newExpiresAt: refreshedTokens.expires_at,
      expiresIn: refreshedTokens.expires_at - nowSeconds,
    });

    return {accessToken: refreshedTokens.access_token, refreshedTokens};
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private mapActivity(a: StravaApiActivity): StravaActivity {
    return {
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
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private authHeader(token: string) {
    return {Authorization: `Bearer ${token}`};
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const stravaClient = new StravaClient();
