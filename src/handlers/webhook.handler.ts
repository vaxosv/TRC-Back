import * as logger from "firebase-functions/logger";
import type {Request, Response} from "express";
import type {WebhookEvent} from "../models";
import {STRAVA_WEBHOOK_TOKEN, RECENT_ACTIVITY_LIMIT} from "../constants";
import {AthleteNotFoundError} from "../errors";
import {toMessage} from "../utils";
import {dbService} from "../services/database.service";
import {stravaService} from "../services/strava.service";

export interface Secrets {
  clientId: string;
  clientSecret: string;
}

export class WebhookHandler {
  async handle(req: Request, res: Response, secrets?: Secrets): Promise<void> {
    switch (req.method) {
    case "GET":
      return this.handleVerification(req, res);
    case "POST":
      return this.handleEvent(req, res, secrets);
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

  private async handleEvent(req: Request, res: Response, secrets?: Secrets): Promise<void> {
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
        await this.handleActivityEvent(event, secrets);
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

  private async handleActivityEvent(event: WebhookEvent, secrets?: Secrets): Promise<void> {
    const aspectType = event.aspect_type;
    const {object_id: activityId, owner_id: athleteId} = event;

    switch (aspectType) {
    case "create":
    case "update":
      if (!secrets) {
        logger.error("Secrets not provided for activity fetch", {activityId, athleteId});
        return;
      }
      await this.fetchAndSaveActivities(
        athleteId,
        secrets.clientId,
        secrets.clientSecret
      );
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

  async fetchAndSaveActivities(
    athleteId: number,
    clientId: string,
    clientSecret: string,
    limit = RECENT_ACTIVITY_LIMIT
  ) {
    const stravaUser = await dbService.getStravaUser(athleteId);

    if (!stravaUser) {
      logger.error("Strava user not found", {athleteId});
      throw new AthleteNotFoundError(athleteId);
    }

    logger.info("Strava user found", {
      athleteId,
      stravaAthleteId: stravaUser.athleteId,
    });

    const {activities, refreshedTokens} = await stravaService.getRecentActivities(
      {
        accessToken: stravaUser.accessToken,
        refreshToken: stravaUser.refreshToken,
        expiresAt: stravaUser.expiresAt,
      },
      limit,
      clientId,
      clientSecret
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

export const webhookHandler = new WebhookHandler();
