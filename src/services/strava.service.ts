import * as logger from "firebase-functions/logger";
import axios, {AxiosInstance} from "axios";
import type {
  ActivityResult,
  StravaActivity,
  StravaApiActivity,
  StravaTokens,
} from "../models";
import {toMessage} from "../utils";
import {StravaApiError} from "../errors";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

export class StravaService {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({baseURL: STRAVA_API_BASE, timeout: 10_000});
  }

  async getRecentActivities(
    tokens: StravaTokens,
    limit = 2,
    clientId: string,
    clientSecret: string
  ): Promise<ActivityResult> {
    try {
      const {accessToken, refreshedTokens} = await this.getValidToken(
        tokens,
        clientId,
        clientSecret
      );

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

  async getAthleteDetails(
    tokens: StravaTokens,
    clientId: string,
    clientSecret: string
  ): Promise<unknown> {
    try {
      const {accessToken} = await this.getValidToken(tokens, clientId, clientSecret);

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

  async exchangeAuthCode(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    tokenType: string;
  }> {
    try {
      const {data} = await axios.post(STRAVA_TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      });

      if (!data.access_token) {
        throw new StravaApiError("Strava token response is missing access token");
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: data.expires_at ?? null,
        tokenType: data.token_type ?? "Bearer",
      };
    } catch (error) {
      if (error instanceof StravaApiError) throw error;
      logger.error("Failed to exchange Strava authorization code", {
        error: toMessage(error),
      });
      throw new StravaApiError(`Token exchange failed: ${toMessage(error)}`, error);
    }
  }

  async getAthleteByAccessToken(accessToken: string): Promise<{id: number}> {
    try {
      const {data} = await this.http.get<{id?: number}>("/athlete", {
        headers: this.authHeader(accessToken),
      });

      if (!data.id) {
        throw new StravaApiError("Strava athlete id is missing");
      }

      return {id: data.id};
    } catch (error) {
      if (error instanceof StravaApiError) throw error;
      logger.error("Failed to fetch Strava athlete profile", {
        error: toMessage(error),
      });
      throw new StravaApiError(`Failed to fetch athlete: ${toMessage(error)}`, error);
    }
  }

  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<StravaTokens> {
    const {data} = await axios.post(STRAVA_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    logger.info("Access token refreshed", {
      expiresAt: data.expires_at,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };
  }

  private async getValidToken(
    tokens: StravaTokens,
    clientId: string,
    clientSecret: string
  ): Promise<{accessToken: string; refreshedTokens?: StravaTokens}> {
    const expiresAt = Number(tokens.expiresAt);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER_SECONDS = 5 * 60;
    const needsRefresh
      = !expiresAt
      || !tokens.accessToken
      || expiresAt - nowSeconds <= REFRESH_BUFFER_SECONDS;

    if (!needsRefresh) {
      logger.info("Strava access token is still valid", {
        expiresIn: expiresAt - nowSeconds,
        expiresAt,
      });
      return {accessToken: tokens.accessToken};
    }

    logger.info("Strava access token needs refresh", {
      reason: !tokens.accessToken ?
        "missing_access_token" :
        !expiresAt ?
          "invalid_expires_at" :
          "expired_or_expiring_soon",
      expiresAt,
      nowSeconds,
      secondsRemaining: expiresAt ? expiresAt - nowSeconds : null,
    });

    const refreshedTokens = await this.refreshAccessToken(
      tokens.refreshToken,
      clientId,
      clientSecret
    );

    logger.info("Strava access token refreshed successfully", {
      newExpiresAt: refreshedTokens.expiresAt,
      expiresIn: refreshedTokens.expiresAt - nowSeconds,
    });

    return {accessToken: refreshedTokens.accessToken, refreshedTokens};
  }

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

  private authHeader(token: string) {
    return {Authorization: `Bearer ${token}`};
  }
}

export const stravaService = new StravaService();
