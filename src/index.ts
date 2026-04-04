import * as admin from "firebase-admin";
import {
  onRequest,
  Request,
} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import type {Response} from "express";
import * as logger from "firebase-functions/logger";
import {stravaClient} from "./strava";
import {dbService} from "./database";
import type {WebhookEvent} from "./types";

admin.initializeApp();

export const STRAVA_WEBHOOK_TOKEN = "strava_webhook_token";

const REGION = "europe-north1" as const;
const RECENT_ACTIVITY_LIMIT = 2;
const FRONTEND_ACTIVITY_LIMIT = 10;

const STRAVA_CLIENT_ID_SECRET = defineSecret("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET_SECRET = defineSecret("STRAVA_CLIENT_SECRET");
const ALLOWED_ORIGINS = new Set([
  "http://localhost:4200",
  "http://192.168.1.11:4200",
  "https://trc--telavirc-8373e.europe-west4.hosted.app",
]);

// ── Webhook handler class ──────────────────────────────────────────────────

class WebhookHandler {
  async handle(req: Request, res: Response): Promise<void> {
    switch (req.method) {
    case "GET":
      return this.handleVerification(req, res);
    case "POST":
      return this.handleEvent(req, res);
    default:
      res.status(405).json({error: "Method not allowed"});
    }
  }

  // ── Strava subscription verification ──────────────────────────────────

  private handleVerification(req: Request, res: Response): void {
    const mode = req.query["hub.mode"] as string;
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"] as string;

    logger.info("Strava verification request", {mode, token, challenge});

    if (mode === "subscribe" && token === STRAVA_WEBHOOK_TOKEN) {
      res.status(200).json({"hub.challenge": challenge});
    } else {
      logger.warn("Verification failed — invalid token", {token});
      res.status(403).json({error: "Invalid token"});
    }
  }

  // ── Incoming webhook event ─────────────────────────────────────────────

  private async handleEvent(req: Request, res: Response): Promise<void> {
    res.status(200).json({status: "ok"});

    const event = req.body as WebhookEvent;

    logger.info("Webhook event received", {
      objectType: event.object_type,
      aspectType: event.aspect_type,
      objectId: event.object_id,
      ownerId: event.owner_id,
    });

    try {
      if (event.object_type === "athlete") {
        return;
      }

      if (event.object_type === "activity") {
        await this.handleActivityEvent(event);
        return;
      }

      logger.warn("Unknown webhook object_type", {objectType: event.object_type});
    } catch (error) {
      // Response already sent — just log the failure
      logger.error("Error processing webhook event", {
        error: toMessage(error),
        objectType: event.object_type,
        aspectType: event.aspect_type,
        objectId: event.object_id,
        ownerId: event.owner_id,
      });
    }
  }

  // ── Activity event routing ─────────────────────────────────────────────

  private async handleActivityEvent(event: WebhookEvent): Promise<void> {
    const aspectType = event.aspect_type;
    const {object_id: activityId, owner_id: athleteId} = event;

    switch (aspectType) {
    case "create":
    case "update":
      await this.fetchAndSaveActivities(athleteId);
      logger.info(`Activity ${aspectType} handled`, {activityId, athleteId});
      break;

    case "delete":
      await dbService.deleteActivity(athleteId, activityId);
      logger.info("Activity deleted", {activityId, athleteId});
      break;

    default:
      logger.warn("Unknown activity aspect_type", {aspectType, activityId});
    }
  }

  // ── Shared logic ───────────────────────────────────────────────────────

  async fetchAndSaveActivities(athleteId: number) {
    const stravaUser = await dbService.getStravaUser(athleteId);

    if (!stravaUser) {
      logger.error("Strava user not found", {athleteId});
      throw new AthleteNotFoundError(athleteId);
    }

    logger.info("Strava user found", {
      athleteId,
      stravaUserId: stravaUser.stravaUserId,
    });

    const {activities, refreshedTokens} = await stravaClient.getRecentActivities(
      {
        accessToken: stravaUser.accessToken,
        refreshToken: stravaUser.refreshToken,
        expiresAt: stravaUser.expiresAt,
      },
      RECENT_ACTIVITY_LIMIT
    );

    if (activities.length > 0) {
      await dbService.saveActivities(athleteId, activities);
      logger.info("Activities saved", {athleteId, count: activities.length});
    }

    // Persist refreshed tokens when Strava rotated them
    if (refreshedTokens) {
      await dbService.updateStravaTokens(athleteId, refreshedTokens);
      logger.info("Tokens refreshed and persisted", {athleteId});
    }

    return {activities};
  }
}

// ── Custom errors ──────────────────────────────────────────────────────────

class AthleteNotFoundError extends Error {
  constructor(public readonly athleteId: number) {
    super(`Athlete not found: ${athleteId}`);
    this.name = "AthleteNotFoundError";
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

const webhookHandler = new WebhookHandler();

// ── Cloud Functions ────────────────────────────────────────────────────────

export const stravaWebhookHandlerNew = onRequest({region: REGION}, (req, res) =>
  webhookHandler.handle(req, res)
);

export const exchangeStravaTokenHTTP = onRequest(
  {
    region: REGION,
    secrets: [STRAVA_CLIENT_ID_SECRET, STRAVA_CLIENT_SECRET_SECRET],
  },
  async (req, res) => {
    const origin = req.headers.origin;

    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({error: "Origin not allowed"});
      return;
    }

    try {
      const authHeader = req.header("Authorization") || "";
      const bearerPrefix = "Bearer ";

      if (!authHeader.startsWith(bearerPrefix)) {
        res.status(401).json({error: "Missing or invalid Authorization header"});
        return;
      }

      const idToken = authHeader.slice(bearerPrefix.length).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";

      if (!code) {
        res.status(400).json({error: "Missing Strava authorization code"});
        return;
      }

      const athleteId = await exchangeStravaTokenForUid(decoded.uid, code);
      res.status(200).json({athleteId});
    } catch (error) {
      logger.error("Error in exchangeStravaTokenHttp", {
        error: toMessage(error),
      });
      res.status(500).json({error: "Internal server error", message: toMessage(error)});
    }
  }
);

export const fetchActivitiesByGoogleUId = onRequest({region: REGION}, async (req, res) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({error: "Origin not allowed"});
    return;
  }

  try {
    const googleUId = req.query.googleUId;

    if (typeof googleUId !== "string" || !googleUId.trim()) {
      res.status(400).json({error: "Missing or invalid query param: googleUId"});
      return;
    }

    let activityQuantity = FRONTEND_ACTIVITY_LIMIT;
    if (req.query.activityQuantity) {
      const parsed = parseInt(req.query.activityQuantity as string, 10);
      if (isNaN(parsed) || parsed < 1) {
        res.status(400).json({
          error: "activityQuantity must be a positive integer",
        });
        return;
      }
      activityQuantity = parsed;
    }

    const user = await dbService.getUserByGoogleUid(googleUId);

    if (!user || !user.stravaAthleteId) {
      res.status(404).json({error: "User not found or stravaAthleteId is missing"});
      return;
    }

    const stravaUser = await dbService.getStravaUser(user.stravaAthleteId);

    if (!stravaUser) {
      res.status(404).json({
        error: "stravaUsers object not found",
        stravaAthleteId: user.stravaAthleteId,
      });
      return;
    }

    const {activities, refreshedTokens} = await stravaClient.getRecentActivities(
      {
        accessToken: stravaUser.accessToken,
        refreshToken: stravaUser.refreshToken,
        expiresAt: stravaUser.expiresAt,
      },
      activityQuantity
    );

    if (refreshedTokens) {
      await dbService.updateStravaTokens(user.stravaAthleteId, refreshedTokens);
    }

    res.status(200).json({
      googleUId,
      stravaAthleteId: user.stravaAthleteId,
      count: activities.length,
      activities,
    });
  } catch (error) {
    logger.error("Error in fetchActivitiesByGoogleUId", {
      error: toMessage(error),
    });
    res.status(500).json({error: "Internal server error", message: toMessage(error)});
  }
});


export const fetchAthleteActivitiesNew = onRequest({region: REGION}, async (req, res) => {
  try {
    const athleteId = parseInt(req.query.athleteId as string, 10);

    if (!athleteId || isNaN(athleteId)) {
      res.status(400).json({error: "Invalid athleteId"});
      return;
    }

    const {activities} = await webhookHandler.fetchAndSaveActivities(athleteId);

    res.status(200).json({athleteId, activitiesSaved: activities.length, activities});
  } catch (error) {
    if (error instanceof AthleteNotFoundError) {
      res.status(404).json({error: "Athlete not found", athleteId: error.athleteId});
      return;
    }

    logger.error("Error in fetchAthleteActivities", {
      error: toMessage(error),
    });
    res.status(500).json({error: "Internal server error", message: toMessage(error)});
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exchangeStravaTokenForUid(uid: string, code: string): Promise<number> {
  const tokenData = await stravaClient.exchangeAuthCode(
    code,
    STRAVA_CLIENT_ID_SECRET.value(),
    STRAVA_CLIENT_SECRET_SECRET.value()
  );

  const athlete = await stravaClient.getAthleteByAccessToken(tokenData.accessToken);
  const athleteId = athlete.id;

  await dbService.linkUserWithStravaAuth({
    uid,
    athleteId,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresAt: tokenData.expiresAt,
    tokenType: tokenData.tokenType,
  });

  return athleteId;
}
