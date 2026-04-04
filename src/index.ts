import {onRequest} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import type {Request, Response} from "express";
import {REGION} from "./constants";
import {ALLOWED_ORIGINS} from "./config";
import {webhookHandler} from "./handlers/webhook.handler";
import {activitiesHandler} from "./handlers/activities.handler";
import {authHandler} from "./handlers/auth.handler";
import {withCors} from "./middleware/cors.middleware";
import {verifyFirebaseToken} from "./middleware/auth.middleware";
import {toMessage} from "./utils";
import {ValidationError} from "./errors";

// ── Secrets ────────────────────────────────────────────────────────────────

const STRAVA_CLIENT_ID_SECRET = defineSecret("213881");
const STRAVA_CLIENT_SECRET_SECRET = defineSecret("STRAVA_CLIENT_SECRET");

const secrets = {
  clientId: STRAVA_CLIENT_ID_SECRET,
  clientSecret: STRAVA_CLIENT_SECRET_SECRET,
};

// ── Webhook ───────────────────────────────────────────────────────────────

export const stravaWebhookHandlerNew = onRequest(
  {
    region: REGION,
    secrets: [STRAVA_CLIENT_ID_SECRET, STRAVA_CLIENT_SECRET_SECRET],
  },
  (req, res) => {
    withCors(req, res);
    webhookHandler.handle(req, res, {
      clientId: secrets.clientId.value(),
      clientSecret: secrets.clientSecret.value(),
    });
  }
);

// ── Token exchange ────────────────────────────────────────────────────────

export const exchangeStravaTokenHTTP = onRequest(
  {
    region: REGION,
    secrets: [STRAVA_CLIENT_ID_SECRET, STRAVA_CLIENT_SECRET_SECRET],
  },
  async (req: Request, res: Response) => {
    withCors(req, res);

    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    try {
      const decoded = await verifyFirebaseToken(req);
      (res.locals as Record<string, unknown>).uid = decoded.uid;

      await authHandler.exchangeToken(req, res, {
        clientId: secrets.clientId.value(),
        clientSecret: secrets.clientSecret.value(),
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(401).json({error: error.message});
        return;
      }
      res.status(500).json({error: "Internal server error", message: toMessage(error)});
    }
  }
);

// ── Fetch activities ──────────────────────────────────────────────────────

export const fetchActivitiesByGoogleUId = onRequest(
  {region: REGION},
  async (req: Request, res: Response) => {
    withCors(req, res);

    if (req.method !== "GET") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({error: "Origin not allowed"});
      return;
    }

    await activitiesHandler.fetchByGoogleUid(req, res, {
      clientId: secrets.clientId.value(),
      clientSecret: secrets.clientSecret.value(),
    });
  }
);

export const fetchAthleteActivitiesNew = onRequest(
  {region: REGION},
  async (req: Request, res: Response) => {
    withCors(req, res);

    if (req.method !== "GET") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    await activitiesHandler.fetchByAthleteId(req, res, {
      clientId: secrets.clientId.value(),
      clientSecret: secrets.clientSecret.value(),
    });
  }
);
