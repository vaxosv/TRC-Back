import * as admin from "firebase-admin";
import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {stravaClient} from "./strava";
import {dbService} from "./database";
import {WebhookEvent} from "./types";

export const STRAVA_WEBHOOK_TOKEN = "strava_webhook_token";

admin.initializeApp();

const httpFunctionOptions = {region: "europe-north1" as const};

export const stravaWebhookHandlerNew = onRequest(
  httpFunctionOptions,
  async (request, response): Promise<void> => {
    // ── 1) VERIFICATION (GET) ──────────────────────────────────────────────
    if (request.method === "GET") {
      const mode = request.query["hub.mode"] as string;
      const token = request.query["hub.verify_token"] as string;
      const challenge = request.query["hub.challenge"] as string;

      logger.info("Strava verification request", {mode, token, challenge});

      if (mode === "subscribe" && token === STRAVA_WEBHOOK_TOKEN) {
        response.status(200).json({"hub.challenge": challenge});
      } else {
        logger.warn("Verification failed - invalid token", {token});
        response.status(403).json({error: "Invalid token"});
      }
      return;
    }

    // ── 2) ONLY POST BEYOND THIS POINT ────────────────────────────────────
    if (request.method !== "POST") {
      response.status(405).json({error: "Method not allowed"});
      return;
    }

    // ── 3) PROCESS WEBHOOK EVENT ──────────────────────────────────────────
    try {
      const event = request.body as WebhookEvent;

      logger.info("Strava webhook event received", {
        objectType: event.object_type,
        objectId: event.object_id,
        aspectType: event.aspect_type,
        ownerId: event.owner_id,
        time: event.event_time,
        full: event,
      });

      // Only handle activity.created and activity.updated
      if (
        event.object_type === "athlete"
      ) {
        logger.info("Event not relevant, skipping", {
          objectType: event.object_type,
          aspectType: event.aspect_type,
          full: event,
        });
        response.status(200).json({status: "ok"});
        return;
      }

      const athleteId = event.owner_id;

      const athlete = await dbService.getAthlete(athleteId);
      if (!athlete) {
        logger.warn(`Athlete not found: ${athleteId}`);
        response.status(404).json({error: "Athlete not found"});
        logger.error("Athlete not found", {
          athleteId,
        });
        return;
      }

      logger.info("Athlete found, fetching activities", {
        athleteId,
        athleteName: `${athlete.firstname} ${athlete.lastname}`,
      });


      const recentActivities = await stravaClient.getRecentActivities(
        {
          access_token: athlete.access_token,
          refresh_token: athlete.refresh_token,
          expires_at: athlete.expires_at,
        },
        2,
      );

      if (recentActivities.activities.length === 0) {
        logger.info("No recent activities found", {athleteId});
        response.status(200).json({
          status: "ok",
          message: "No activities to save",
        });
        return;
      }

      await dbService.saveActivities(athleteId, recentActivities.activities);

      logger.info("Webhook processed successfully", {
        athleteId,
        activitiesCount: recentActivities.activities.length,
      });

      response.status(200).json({
        status: "ok",
        activitiesSaved: recentActivities.activities.length,
        activities: recentActivities,
      });
      return;
    } catch (error) {
      logger.error("Error processing Strava webhook", {
        error: error instanceof Error ? error.message : String(error),
        body: request.body,
      });
      response.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  },
);

/**
 * Manual trigger to fetch activities for a specific athlete
 */
export const fetchAthleteActivitiesNew = onRequest(
  httpFunctionOptions,
  async (request, response): Promise<void> => {
    try {
      const athleteId = parseInt(request.query.athleteId as string, 10);

      if (!athleteId || isNaN(athleteId)) {
        response.status(400).json({error: "Invalid athleteId"});
        return;
      }

      const athlete = await dbService.getAthlete(athleteId);
      if (!athlete) {
        response.status(404).json({error: "Athlete not found"});
        return;
      }

      const {activities} = await stravaClient.getRecentActivities({
        access_token: athlete.access_token,
        refresh_token: athlete.refresh_token,
        expires_at: athlete.expires_at,
      }, 2);
      await dbService.saveActivities(athleteId, activities);

      response.status(200).json({
        athleteId,
        activitiesSaved: activities.length,
        activities,
      });
      return;
    } catch (error) {
      logger.error("Error in fetchAthleteActivitiesNew", {
        error: error instanceof Error ? error.message : String(error),
      });
      response.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return;
    }
  },
);
