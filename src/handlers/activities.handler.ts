import type {Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {AthleteNotFoundError} from "../errors";
import {toMessage, parseIntOrThrow} from "../utils";
import {dbService} from "../services/database.service";
import {stravaService} from "../services/strava.service";
import {webhookHandler} from "./webhook.handler";
import {FRONTEND_ACTIVITY_LIMIT} from "../constants";

export interface Secrets {
  clientId: string;
  clientSecret: string;
}

export class ActivitiesHandler {
  async fetchByGoogleUid(req: Request, res: Response, secrets: Secrets): Promise<void> {
    const googleUId = req.query.googleUId;

    if (typeof googleUId !== "string" || !googleUId.trim()) {
      res.status(400).json({error: "Missing or invalid query param: googleUId"});
      return;
    }

    let activityQuantity = FRONTEND_ACTIVITY_LIMIT;
    if (req.query.activityQuantity) {
      const parsed = parseIntOrThrow(req.query.activityQuantity as string, "activityQuantity");
      if (parsed < 1) {
        res.status(400).json({
          error: "activityQuantity must be a positive integer",
        });
        return;
      }
      activityQuantity = parsed;
    }

    try {
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

      const {activities, refreshedTokens} = await stravaService.getRecentActivities(
        {
          accessToken: stravaUser.accessToken,
          refreshToken: stravaUser.refreshToken,
          expiresAt: stravaUser.expiresAt,
        },
        activityQuantity,
        secrets.clientId,
        secrets.clientSecret
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
  }

  async fetchByAthleteId(req: Request, res: Response, secrets: Secrets): Promise<void> {
    let athleteId: number;
    try {
      athleteId = parseIntOrThrow(req.query.athleteId as string, "athleteId");
    } catch {
      res.status(400).json({error: "Invalid athleteId"});
      return;
    }

    try {
      const {activities} = await webhookHandler.fetchAndSaveActivities(
        athleteId,
        secrets.clientId,
        secrets.clientSecret
      );

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
  }
}

export const activitiesHandler = new ActivitiesHandler();
