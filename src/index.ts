import * as admin from "firebase-admin";
import {onRequest, Request} from "firebase-functions/v2/https";
import type {Response} from "express";
import * as logger from "firebase-functions/logger";
import {stravaClient} from "./strava";
import {dbService} from "./database";
import type {WebhookEvent} from "./types";

admin.initializeApp();

export const STRAVA_WEBHOOK_TOKEN = "strava_webhook_token";

const REGION = "europe-north1" as const;
const RECENT_ACTIVITY_LIMIT = 2;

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
